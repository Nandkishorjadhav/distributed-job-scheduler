# Step 8: Retry Policy System & Backoff Engine

## Overview

The **Retry Policy System** provides configurable mathematical backoff strategies to retry failed jobs automatically, eliminate retry storms (thundering herds) via full randomized jitter, preserve complete execution histories, and quarantine permanently failed jobs in the Dead Letter Queue.

---

## 1. Supported Mathematical Backoff Models

Implemented in [`RetryPolicyCalculator.ts`](file:///d:/Job%20Scheduler/backend/shared/src/domain/RetryPolicyCalculator.ts):

| Strategy                | Enum Key      | Mathematical Formula                                                                 | Example Delays (`initial = 1000ms`, `multiplier = 2.0`) |
| :---------------------- | :------------ | :----------------------------------------------------------------------------------- | :------------------------------------------------------ |
| **Fixed Delay**         | `fixed`       | $\text{delay} = \text{initialDelay}$                                                 | `1000ms, 1000ms, 1000ms, 1000ms`                        |
| **Linear Backoff**      | `linear`      | $\text{delay} = \text{initialDelay} \times \text{attempt}$                           | `1000ms, 2000ms, 3000ms, 4000ms`                        |
| **Exponential Backoff** | `exponential` | $\text{delay} = \text{initialDelay} \times (\text{multiplier})^{\text{attempt} - 1}$ | `1000ms, 2000ms, 4000ms, 8000ms`                        |

---

## 2. Configuration Parameters

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

## 3. Retry Storm Prevention (Jitter Dispersion)

### The Thundering Herd Problem

When an external dependency or database experiences an outage, hundreds of jobs may fail in the exact same second. Without jitter, all failed jobs compute the exact same delay and retry in lockstep, immediately crashing the recovering service again.

### Jitter Formula & Dispersion

The calculator adds randomized full jitter to the computed backoff delay:

$$\text{FinalDelay} = \min(\text{BaseDelay},\, \text{maxDelayMs}) + \text{Random}(0,\, \text{jitterMs})$$

- **Dispersion Guarantee**: 100 simultaneous failures are smoothly distributed across the $[0, \text{jitterMs}]$ time window.
- **Deterministic Unit Testing**: `RetryPolicyCalculator.calculateDelayMs(policy, attempt, randomFn?)` accepts an optional `randomFn` returning $[0, 1]$, enabling exact millisecond assertions in unit tests without randomness flakiness.

---

## 4. End-to-End Failure Lifecycle

When a worker catches a job execution error:

1. **Upsert `job_executions`**:
   - `attempt_number`, `status = 'failed'`, `duration_ms`, `error_message`, `error_code`, `next_retry_at`, and `retry_delay_ms`.
2. **Evaluate Attempt Allowance**:
   - If `attempt_count < max_attempts`: Transitions job `status = 'failed'`, stamps `next_attempt_at` with the computed backoff timestamp.
   - If `attempt_count >= max_attempts`: Transitions job `status = 'dead'`, stamps `finished_at = NOW()`, and moves to DLQ.
3. **Dead-Letter Snapshot**:
   - If `dlq_enabled` is true, an immutable failure summary is upserted into `dead_letter_jobs` with total attempts and first/last failure timestamps.
4. **Structured Audit Logs**:
   - Appends contextual log entries into `job_logs` recording attempt count, error code, and retry decision.
