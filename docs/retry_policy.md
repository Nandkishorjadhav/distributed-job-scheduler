# Retry Policy System

## Overview

In a distributed job scheduler, transient failures (such as temporary network glitches, rate limits, downstream timeouts, or momentary database deadlocks) are common. The **Retry Policy System** provides configurable, resilient retry mechanisms to automatically retry failed jobs according to mathematical backoff models, avoid retry storms (thundering herds), preserve complete execution histories, and safely quarantine permanently failed jobs in a Dead-Letter Queue (DLQ).

---

## 1. Retry Strategies Supported

| Strategy                | Enum Key      | Formula                                                                              | Example Delays (`initialDelayMs = 1000`) |
| :---------------------- | :------------ | :----------------------------------------------------------------------------------- | :--------------------------------------- |
| **Fixed Delay**         | `fixed`       | $\text{delay} = \text{initialDelay}$                                                 | `1000ms, 1000ms, 1000ms, 1000ms`         |
| **Linear Backoff**      | `linear`      | $\text{delay} = \text{initialDelay} \times \text{attempt}$                           | `1000ms, 2000ms, 3000ms, 4000ms`         |
| **Exponential Backoff** | `exponential` | $\text{delay} = \text{initialDelay} \times (\text{multiplier})^{\text{attempt} - 1}$ | `1000ms, 2000ms, 4000ms, 8000ms`         |

---

## 2. Retry Policy Configuration Parameters

Each policy configuration supports the following parameters:

```typescript
interface RetryPolicyConfig {
  maxAttempts: number; // Total allowed execution attempts (1 - 100, default: 3)
  strategy: RetryStrategy; // 'fixed' | 'linear' | 'exponential' (default: 'exponential')
  initialDelayMs: number; // Base delay in milliseconds (default: 1000)
  maxDelayMs: number; // Hard ceiling capping the maximum computed delay (default: 30000)
  backoffMultiplier?: number; // Multiplier for exponential backoff (default: 2.0)
  jitterMs?: number; // Jitter range [0, jitterMs] added to avoid retry storms (default: 500)
}
```

---

## 3. Retry Storm Prevention (Jitter)

### The Problem (Thundering Herd)

When a shared dependency (such as an external API or relational database) experiences an outage, hundreds or thousands of jobs may fail simultaneously at timestamp $T$. Without jitter, all failed jobs calculate the exact same exponential retry delay $\Delta t$ and retry simultaneously at $T + \Delta t$. This **retry storm** immediately overwhelms and crashes the recovering downstream service again.

### The Solution: Jitter Dispersion

The [`RetryPolicyCalculator`](file:///d:/Job%20Scheduler/backend/shared/src/domain/RetryPolicyCalculator.ts) adds randomized full jitter to the computed backoff delay:

$$\text{FinalDelay} = \min(\text{RawDelay},\, \text{maxDelayMs}) + \text{Random}(0,\, \text{jitterMs})$$

- **Dispersion Guarantee**: 100 jobs failing at the same millisecond are randomly dispersed across the $[0, \text{jitterMs}]$ window, smoothing throughput and preventing synchronized spikes.
- **Deterministic Testing**: `calculateDelayMs(policy, attempt, randomFn?)` accepts an optional `randomFn` returning $[0, 1]$, allowing unit tests to verify exact millisecond precision without randomness flakiness.

---

## 4. End-to-End Failure Lifecycle

```
                  ┌───────────────────────────────┐
                  │    Job Execution Fails        │
                  │   (Worker catches error)      │
                  └──────────────┬────────────────┘
                                 │
                                 ▼
                  ┌───────────────────────────────┐
                  │  1. Record Failure in DB      │
                  │  • Attempt row in             │
                  │    job_executions             │
                  │  • Error log in job_logs      │
                  └──────────────┬────────────────┘
                                 │
                                 ▼
                  ┌───────────────────────────────┐
                  │  2. Evaluate Retry Allowance  │
                  │    (attemptCount < max)       │
                  └──────┬─────────────────┬──────┘
             Yes         │                 │ No (Max attempts reached)
                         ▼                 ▼
          ┌───────────────────────────┐   ┌───────────────────────────┐
          │  3. Calculate Next Retry  │   │  3. Quarantine to DLQ     │
          │  • Backoff + Jitter       │   │  • status = 'dead'        │
          │  • status = 'failed'      │   │  • Snapshot row in        │
          │  • next_attempt_at = NOW()│   │    dead_letter_jobs       │
          │    + delayMs              │   │  • finished_at = NOW()    │
          └───────────────────────────┘   └───────────────────────────┘
```

### Steps Executed Atomically on Failure:

1. **Record Execution Attempt**: An entry is upserted into `job_executions` containing:
   - `attempt_number`
   - `status = 'failed'`
   - `error_message` & `error_code`
   - `started_at` & `finished_at`
   - `duration_ms` (calculated duration)
   - `next_retry_at` & `retry_delay_ms`
2. **State Transition**:
   - If retry is allowed: `status = 'failed'`, `next_attempt_at` stamped with future backoff date.
   - If retry exhausted: `status = 'dead'`, `finished_at` stamped.
3. **Dead-Letter Snapshot**:
   - When moving to `dead`, if `dlq_enabled` is true on the queue, an immutable snapshot is inserted into `dead_letter_jobs` with failure metadata, total attempts, and first/last failed timestamps.
4. **Audit Log**:
   - Structured JSON logs appended to `job_logs` recording attempt count, error code, and retry decision.

---

## 5. Automated Verification Results

Ran `npx vitest run domain/retry_policy.test.ts integration/retry_lifecycle.test.ts`:

```text
✓ domain/retry_policy.test.ts (9 tests)
  ✓ Fixed Delay Strategy > returns the same initial delay for all attempts
  ✓ Linear Backoff Strategy > multiplies initial delay by attempt count linearly
  ✓ Exponential Backoff Strategy > doubles delay on each subsequent attempt
  ✓ Exponential Backoff Strategy > supports custom backoff multiplier (e.g. 3.0)
  ✓ Maximum Delay Ceiling Capping > strictly caps delay at maxDelayMs
  ✓ Deterministic Random Injection for Unit Tests > adds exact predictable jitter when randomFn is supplied
  ✓ Deterministic Random Injection for Unit Tests > calculates deterministic next attempt date
  ✓ Retry Storm Prevention (Jitter Dispersion) > disperses 100 simultaneous failures across the jitter window
  ✓ isRetryAllowed Boundary Evaluation > correctly evaluates remaining attempts

✓ integration/retry_lifecycle.test.ts (1 test)
  ✓ End-to-End Retry Lifecycle & DLQ Integration Tests > progresses job through retry lifecycle: Attempt 1 -> Attempt 2 -> Attempt 3 -> DLQ
```

All **88 tests across 10 test suites in the monorepo passed with 0 errors**.
