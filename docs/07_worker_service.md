# Step 7: Distributed Worker Service Engine

## Overview

The **Worker Service** ([`Worker.ts`](file:///d:/Job%20Scheduler/backend/worker/src/Worker.ts)) is an autonomous, horizontally scalable process engine that polls queues, claims jobs atomically, runs handlers concurrently, reports periodic heartbeats, and supports graceful draining on shutdown.

---

## 1. Worker Lifecycle State Machine

```
              ┌─────────────────────────┐
              │     Worker.start()      │
              └────────────┬────────────┘
                           │ 1. Self-register in DB ('active')
                           │ 2. Start heartbeat timer
                           │ 3. Start polling loop
                           ▼
              ┌─────────────────────────┐
        ┌────►│       ACTIVE State      │
        │     │  • Polling queues       │
        │     │  • Executing handlers   │
        │     │  • Emitting heartbeats  │
        │     └────────────┬────────────┘
        │                  │
        │                  │ SIGTERM / SIGINT / worker.stop()
        │                  ▼
        │     ┌─────────────────────────┐
        │     │      DRAINING State     │
        │     │  • Stop polling loop    │
        │     │  • Await in-flight jobs │
        │     └────────────┬────────────┘
        │                  │
        │                  │ In-flight jobs finished (or drain timeout)
        │                  ▼
        │     ┌─────────────────────────┐
        │     │      OFFLINE State      │
        │     │  • Stop heartbeats      │
        │     │  • Deregister in DB     │
        │     │  • Close connections    │
        │     └─────────────────────────┘
```

---

## 2. Real Execution Loop & Concurrency Slot Management

In each polling iteration:

1. **Compute Available Capacity**:
   $$\text{availableSlots} = \text{concurrency} - \text{activeJobCount}$$
2. **Atomic Claim**:
   If $\text{availableSlots} > 0$, calls `JobClaimService.claimJobs(workerId, availableSlots, queueId)` using `FOR UPDATE SKIP LOCKED`.
3. **Async Dispatch**:
   Each claimed job is added to the worker's `activeJobs` Promise set and dispatched to the matching handler.
4. **Adaptive Scheduling**:
   If jobs were claimed and capacity remains, the next poll fires immediately ($50\text{ ms}$) to drain high-volume queues rapidly. Otherwise, waits for `pollIntervalMs`.

---

## 3. Job Handlers & Extensibility

Custom handlers are registered via [`JobHandlerRegistry`](file:///d:/Job%20Scheduler/backend/worker/src/handlers/index.ts):

```typescript
import { Worker } from '@job-scheduler/worker';
import { getPool } from '@job-scheduler/backend-shared';

const worker = new Worker(getPool(), {
  projectId: '00000000-0000-0000-0000-000000000000',
  concurrency: 10,
  pollIntervalMs: 1000,
  heartbeatIntervalMs: 10000,
});

// Register a custom job handler
worker.registerHandler('send-email', async (ctx) => {
  await ctx.log('info', `Sending email to ${ctx.payload.to}`);

  // Custom business logic
  const result = await emailService.send(ctx.payload);

  return { messageId: result.id };
});

await worker.start();
```

---

## 4. Periodic Heartbeats & Liveness Monitoring

- The worker sends database heartbeats every `WORKER_HEARTBEAT_INTERVAL_MS` (default: $10\text{ s}$).
- Updates `workers.last_heartbeat_at = NOW()` and `workers.current_job_count = activeJobCount`.
- If a worker crashes ungracefully (e.g. OOM or hardware failure), the scheduler identifies missing heartbeats and resets orphaned running jobs back to `pending`.

---

## 5. Graceful Shutdown & Draining

When receiving `SIGTERM` or `SIGINT`:

1. Worker state updates to `WorkerStatus.DRAINING` (and updates DB).
2. Polling loop is cancelled immediately — **no new jobs are accepted**.
3. The process awaits all active in-flight jobs up to `WORKER_DRAIN_TIMEOUT_MS` (default: $30\text{ s}$).
4. Heartbeat timer is cleared.
5. Worker status updates to `WorkerStatus.OFFLINE`, stamps `stoppedAt = NOW()`, and deregisters in DB.
6. Database connection pool and Redis connections are closed cleanly.
