# Distributed Worker Service (`@job-scheduler/worker`)

The **Worker Service** is a production-grade, horizontally scalable background worker engine. It autonomously discovers, claims, and executes asynchronous jobs across distributed queues using PostgreSQL row-level locking (`FOR UPDATE SKIP LOCKED`), concurrency slot management, structured execution logging, periodic heartbeat telemetry, automated retry backoff, and graceful draining shutdown.

---

## Table of Contents

- [Key Features](#key-features)
- [Architecture & Execution Flow](#architecture--execution-flow)
- [Atomic Job Claiming Mechanism](#atomic-job-claiming-mechanism)
- [Worker Lifecycle States](#worker-lifecycle-states)
- [Job Handlers & Extensibility](#job-handlers--extensibility)
- [Heartbeat & Liveness Monitoring](#heartbeat--liveness-monitoring)
- [Error Handling & Retry Backoff](#error-handling--retry-backoff)
- [Graceful Shutdown & Draining](#graceful-shutdown--draining)
- [Configuration & Environment Variables](#configuration--environment-variables)
- [Running & Testing](#running--testing)

---

## Key Features

1. **Self-Registration**: Automatically registers in the `workers` table with machine hostname, process ID (`pid`), and concurrency capacity.
2. **Zero Duplicate Claims**: Uses PostgreSQL `FOR UPDATE SKIP LOCKED` inside atomic transactions to guarantee that competing workers never claim or execute the same job twice.
3. **Queue Concurrency Limits**: Dynamically queries active running jobs per queue and enforces queue-level concurrency limits.
4. **Paused Queue Isolation**: Ignores jobs residing in paused (`status = 'paused'`) or archived queues.
5. **Configurable Concurrency & Polling**: Manages in-flight async job execution up to a configured concurrency ceiling.
6. **Execution Audit History**: Records per-attempt execution timing (`duration_ms`, `attempt_number`, `started_at`, `finished_at`) into `job_executions`.
7. **Structured Log Streaming**: Captures contextual application logs into `job_logs` with severity levels (`debug`, `info`, `warn`, `error`).
8. **Heartbeat Telemetry**: Sends periodic database heartbeats updating worker liveness and active job count.
9. **Dead-Letter Queue (DLQ)**: Moves jobs to `dead_letter_jobs` upon exhausting `max_attempts`.
10. **Graceful Shutdown**: Intercepts `SIGTERM` / `SIGINT` to drain active in-flight jobs without dropping work before disconnecting.

---

## Architecture & Execution Flow

```
                               ┌─────────────────────────┐
                               │     Worker.start()      │
                               └────────────┬────────────┘
                                            │
                                            ▼
                               ┌─────────────────────────┐
                               │  1. DB Self-Register    │  INSERT INTO workers (hostname, pid, status='active')
                               │  2. Start Heartbeat     │  Timer fires every WORKER_HEARTBEAT_INTERVAL_MS
                               └────────────┬────────────┘
                                            │
                                            ▼
                               ┌─────────────────────────┐
                         ┌────►│      Polling Loop       │
                         │     └────────────┬────────────┘
                         │                  │
                         │                  ▼
                         │     ┌─────────────────────────┐
                         │     │  Compute Available Slots│  slots = concurrency - activeJobCount
                         │     └────────────┬────────────┘
                         │                  │
                         │                  ▼
                         │     ┌─────────────────────────┐
                         │     │    Atomic Job Claim     │  SELECT ... FOR UPDATE OF j SKIP LOCKED
                         │     │    (JobClaimService)    │  UPDATE jobs SET status='running', worker_id=$1
                         │     └────────────┬────────────┘
                         │                  │
                         │                  ▼
                         │     ┌─────────────────────────┐
                         │     │  Execute Handler Async  │  JobHandlerRegistry.getHandler(job.name)
                         │     └──────┬───────────┬──────┘
                         │    Success │           │ Threw Error
                         │            ▼           ▼
                         │   ┌──────────────┐   ┌──────────────┐
                         │   │ completeJob  │   │   failJob    │
                         │   │ • 'completed'│   │ • 'failed'   │
                         │   │ • duration_ms│   │ • retry delay│
                         │   │ • job_logs   │   │ • or DLQ     │
                         │   └────────┬─────┘   └────────┬─────┘
                         │            │                  │
                         └────────────┴──────────────────┘
                                      │
                                      │ On SIGTERM / SIGINT / worker.stop()
                                      ▼
                         ┌─────────────────────────┐
                         │    Graceful Draining    │
                         │ • Stop polling loop     │
                         │ • Await in-flight jobs  │
                         │ • Stop heartbeat        │
                         │ • status = 'offline'    │
                         └─────────────────────────┘
```

---

## Atomic Job Claiming Mechanism

When a worker queries for work, it executes the following atomic CTE query in [`JobClaimService.ts`](file:///d:/Job%20Scheduler/backend/shared/src/services/JobClaimService.ts):

```sql
WITH eligible_jobs AS (
  SELECT j.id
  FROM jobs j
  JOIN queues q ON q.id = j.queue_id
  WHERE j.status = 'pending'
    AND (j.scheduled_at IS NULL OR j.scheduled_at <= NOW())
    AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= NOW())
    AND j.attempt_count < j.max_attempts
    AND q.status = 'active'
    AND ($1::UUID IS NULL OR j.queue_id = $1::UUID)
    AND (
      SELECT COUNT(*)
      FROM jobs r
      WHERE r.queue_id = q.id AND r.status = 'running'
    ) < q.concurrency_limit
  ORDER BY j.priority DESC, j.enqueued_at ASC
  LIMIT $2
  FOR UPDATE OF j SKIP LOCKED
)
UPDATE jobs
SET status = 'running',
    worker_id = $3::UUID,
    attempt_count = jobs.attempt_count + 1,
    started_at = NOW(),
    run_at = COALESCE(jobs.run_at, NOW()),
    updated_at = NOW()
FROM eligible_jobs
WHERE jobs.id = eligible_jobs.id
RETURNING jobs.*;
```

### Why this prevents duplicate claims:

1. **`FOR UPDATE` Exclusive Row Lock**: PostgreSQL locks selected row(s). No other transaction can read with `FOR UPDATE` or modify the row until `COMMIT`.
2. **`SKIP LOCKED` Zero Contention**: Other workers concurrently running the same query skip all locked rows instantly without blocking.
3. **Atomic Selection & Update**: Row selection, worker assignment, and transition to `status = 'running'` occur in a single atomic database statement.
4. **Rollback Resilience**: If a worker crashes before `COMMIT`, PostgreSQL's transaction manager rolls back the update, restoring the job to `pending` with `worker_id = null`.

---

## Worker Lifecycle States

| State          | Enum Value | Description                                                                                |
| :------------- | :--------- | :----------------------------------------------------------------------------------------- |
| **`ACTIVE`**   | `active`   | Worker is actively sending heartbeats, polling queues, and executing jobs.                 |
| **`DRAINING`** | `draining` | Polling has ceased. Worker is waiting for in-flight jobs to complete before shutting down. |
| **`OFFLINE`**  | `offline`  | Worker has cleanly stopped all execution, deregistered in DB, and stopped heartbeats.      |

---

## Job Handlers & Extensibility

Workers use [`JobHandlerRegistry`](file:///d:/Job%20Scheduler/backend/worker/src/handlers/index.ts) to route job execution by `job.name`.

### Registering Custom Handlers

```typescript
import { Worker } from '@job-scheduler/worker';
import { getPool } from '@job-scheduler/backend-shared';

const worker = new Worker(getPool(), {
  projectId: '00000000-0000-0000-0000-000000000000',
  concurrency: 10,
});

// Register a custom email handler
worker.registerHandler('send-email', async (ctx) => {
  await ctx.log('info', `Sending email to ${ctx.payload.to}`);

  // Perform actual work (e.g. SMTP call, API call)
  const result = await emailProvider.send({
    to: ctx.payload.to as string,
    body: ctx.payload.body as string,
  });

  return { messageId: result.id };
});

await worker.start();
```

### Execution Context API (`JobExecutionContext`)

- **`ctx.jobId`**: Unique UUID of the job.
- **`ctx.name`**: Name of the job.
- **`ctx.payload`**: JSON payload object submitted by client.
- **`ctx.attemptCount`**: Current attempt number (1-based).
- **`ctx.maxAttempts`**: Maximum configured retry attempts.
- **`ctx.log(level, message, metadata?)`**: Streams structured log entries directly into `job_logs`.

---

## Heartbeat & Liveness Monitoring

While running, the worker executes periodic heartbeats:

- Heartbeat interval configured by `WORKER_HEARTBEAT_INTERVAL_MS` (default: `10000ms`).
- Updates `workers.last_heartbeat_at = NOW()` and `workers.current_job_count = activeJobs.size`.
- If a worker dies ungracefully (e.g. OOM or host crash), the scheduler detects missing heartbeats and resets its orphaned running jobs back to `pending`.

---

## Error Handling & Retry Backoff

When a job handler throws an error:

1. The error message and error code are captured.
2. The worker increments `attempt_count` and checks against `max_attempts`.
3. **If retry attempts remain (`attempt_count < max_attempts`)**:
   - Job transitions to `status = 'failed'`.
   - `next_attempt_at` is set using exponential backoff:
     $$\text{delayMs} = \min(1000 \times 2^{\text{attemptCount} - 1},\, 60000)$$
   - Recorded as a failed attempt in `job_executions`.
4. **If attempts exhausted (`attempt_count >= max_attempts`)**:
   - Job transitions to `status = 'dead'`.
   - A snapshot is inserted into `dead_letter_jobs` for dead-letter queue analysis.

---

## Graceful Shutdown & Draining

When receiving `SIGTERM` or `SIGINT` (or calling `worker.stop(drainTimeoutMs)`):

1. Worker state transitions to `WorkerStatus.DRAINING` (updated in DB).
2. Polling loop is **cancelled immediately** — no new jobs are claimed.
3. Worker awaits all active in-flight promises in `activeJobs` up to `WORKER_DRAIN_TIMEOUT_MS`.
4. Heartbeat interval timer is cleared.
5. Worker state transitions to `WorkerStatus.OFFLINE` and marks status `offline` in DB.
6. Database connection pool and Redis clients are cleanly closed.

---

## Configuration & Environment Variables

| Variable                       | Type     | Default           | Description                                                   |
| :----------------------------- | :------- | :---------------- | :------------------------------------------------------------ |
| `WORKER_CONCURRENCY`           | `number` | `5`               | Maximum number of concurrent jobs processed simultaneously.   |
| `WORKER_POLL_INTERVAL_MS`      | `number` | `1000`            | Polling delay in milliseconds when queues are idle.           |
| `WORKER_HEARTBEAT_INTERVAL_MS` | `number` | `10000`           | Interval between worker liveness heartbeats in ms.            |
| `WORKER_DRAIN_TIMEOUT_MS`      | `number` | `30000`           | Maximum time to wait for active jobs to finish on shutdown.   |
| `WORKER_PROJECT_ID`            | `string` | _(Auto-detected)_ | Project UUID to which this worker instance belongs.           |
| `WORKER_QUEUE_ID`              | `string` | _(All queues)_    | Optional queue UUID to restrict claiming to a specific queue. |
| `DATABASE_URL`                 | `string` | `postgres://...`  | PostgreSQL connection string.                                 |
| `REDIS_URL`                    | `string` | `redis://...`     | Redis connection string.                                      |

---

## Running & Testing

### Build the Worker Package

```powershell
npm run build --prefix backend/worker
```

### Start the Worker in Development Mode

```powershell
npm run dev --prefix backend/worker
```

### Start the Worker in Production Mode

```powershell
npm start --prefix backend/worker
```

### Run Concurrency & Lifecycle Test Suites

```powershell
cd tests
npx vitest run worker/worker_lifecycle.test.ts concurrency/job_claiming.test.ts
```

All 78 unit, integration, concurrency, and worker lifecycle tests will execute against the live database with zero mock dependencies.
