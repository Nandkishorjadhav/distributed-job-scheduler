# Step 6: Distributed Atomic Job-Claiming Mechanism

## Overview

In a distributed cluster with multiple competing worker processes, job claiming is the most critical reliability point. The claiming mechanism uses PostgreSQL transactions and row-level locking with **`SELECT ... FOR UPDATE SKIP LOCKED`** to ensure that jobs are executed **at most once per attempt** with zero worker lock contention.

---

## 1. The Core Atomic Claim Query

Implemented in [`JobClaimService.ts`](file:///d:/Job%20Scheduler/backend/shared/src/services/JobClaimService.ts):

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

---

## 2. Why This Strategy Guarantees Reliability

### 1. Row-Level Exclusive Lock (`FOR UPDATE`)

- When a worker's transaction selects a row with `FOR UPDATE OF j`, PostgreSQL places an **Exclusive Lock** (`ExclusiveLock` in `pg_locks`) on that row.
- No other transaction can modify or lock the same row until the first transaction commits or rolls back.

### 2. Lock Skipping (`SKIP LOCKED`)

- Under standard `FOR UPDATE`, competing workers block and wait on locked rows, creating high serialization latency and deadlock risks.
- `SKIP LOCKED` instructs PostgreSQL's query planner to **skip over any rows that are currently locked by other transactions**.
- If Worker A locks Job 1, Worker B executing the exact same query in the same millisecond skips Job 1 and immediately claims Job 2 without delay.

### 3. Single-Statement Atomicity

- By combining the row selection (`WITH eligible_jobs AS (...)`) and `UPDATE` into a single SQL execution plan, there is **zero time window** between choosing a job, locking it, and updating its state to `running` with the assigned `worker_id`.

### 4. ACID Rollback Guarantee

- If a worker crashes, loses power, or disconnects before issuing `COMMIT`, PostgreSQL's transaction manager automatically executes a `ROLLBACK`.
- The row lock is released immediately, and the job status remains safely in `pending` with `worker_id = NULL`.

---

## 3. Reliability & Isolation Guards

1. **Priority Ordering**: `ORDER BY j.priority DESC, j.enqueued_at ASC` guarantees that higher-priority jobs (e.g. priority 10) are claimed before lower-priority jobs (e.g. priority 1), using FIFO for ties.
2. **Paused Queue Isolation**: `JOIN queues q ON q.id = j.queue_id WHERE q.status = 'active'` prevents claims from paused or archived queues.
3. **Concurrency Limit Enforcement**: `(SELECT COUNT(*) FROM jobs r WHERE r.queue_id = q.id AND r.status = 'running') < q.concurrency_limit` ensures a queue's configured concurrency limit is never exceeded.
4. **Scheduled & Retry Eligibility**:
   - `scheduled_at IS NULL OR scheduled_at <= NOW()`
   - `next_attempt_at IS NULL OR next_attempt_at <= NOW()`
