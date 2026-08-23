# Distributed Worker Job Claiming Mechanism

## Overview

In a distributed job processing system, multiple autonomous worker processes running across separate hosts or containers compete to claim and execute pending jobs. Without robust synchronization, race conditions can lead to **duplicate executions**, **lost updates**, or **lock contention bottlenecks**.

This document outlines the architecture, PostgreSQL transaction semantics, and row-level locking strategy implemented in [`JobClaimService.ts`](file:///d:/Job%20Scheduler/backend/shared/src/services/JobClaimService.ts).

---

## 1. The Core Atomic Claim Query

The claim operation is executed as a single, atomic PostgreSQL transaction using Common Table Expressions (CTE) and `FOR UPDATE SKIP LOCKED`:

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

## 2. Why This Locking Strategy Prevents Duplicate Claims

### 1. Row-Level Exclusive Lock (`FOR UPDATE`)
- When a worker's transaction executes `SELECT ... FOR UPDATE OF j`, PostgreSQL places an **Exclusive Row-Level Lock** (`ExclusiveLock` in `pg_locks`) on the selected row(s) in the `jobs` table.
- No other transaction can read that row with `FOR UPDATE` or modify it until the acquiring transaction finishes with `COMMIT` or `ROLLBACK`.

### 2. Lock Skipping (`SKIP LOCKED`)
- Under standard `FOR UPDATE`, a concurrent worker attempting to lock the same row would block and wait until the first transaction commits. This creates high thread contention and serialization bottlenecks.
- `SKIP LOCKED` instructs PostgreSQL's query engine to **ignore and skip any rows that are currently locked by other transactions**.
- If Worker A locks Job 1, Worker B executing the exact same query in the same millisecond automatically skips Job 1 and instantly acquires the lock on Job 2 without blocking.

### 3. Atomicity via CTE + UPDATE in Single Statement
- The CTE (`WITH eligible_jobs AS (...)`) and the enclosing `UPDATE` statement execute in the **same database engine execution plan**.
- There is **zero time window** between selecting the row, locking the row, and updating its state to `running` with the assigned `worker_id`.
- The transition from `status = 'pending'` to `status = 'running'` is atomic and irreversible to other workers.

### 4. ACID Rollback Guarantee
- If a worker process crashes, experiences a network failure, or explicitly aborts before calling `COMMIT`, PostgreSQL's transaction manager automatically issues a `ROLLBACK`.
- The row lock is released immediately, and the row remains in `status = 'pending'` with `worker_id = NULL`, making it safely claimable by other healthy workers.

---

## 3. Reliability & Isolation Guards

### 1. Priority-Based FIFO Claiming
- `ORDER BY j.priority DESC, j.enqueued_at ASC`
- Guarantees that higher-priority jobs (`10` highest, `1` lowest) are always evaluated first by the index scanner.
- Ties are broken by `enqueued_at ASC` (first-in, first-out).

### 2. Paused Queue Guard
- `JOIN queues q ON q.id = j.queue_id WHERE q.status = 'active'`
- Paused (`status = 'paused'`) or archived (`status = 'archived'`) queues are filtered out at the join level. Workers will not claim any jobs from paused queues.

### 3. Queue Concurrency Limit Enforcement
- `(SELECT COUNT(*) FROM jobs r WHERE r.queue_id = q.id AND r.status = 'running') < q.concurrency_limit`
- Before claiming, the database dynamically checks if the queue has reached its configured concurrency limit. If running jobs equal or exceed `concurrency_limit`, the query skips that queue's jobs.

### 4. Scheduled & Retried Job Eligibility
- Immediate jobs run ASAP (`scheduled_at IS NULL`).
- Delayed and scheduled jobs are only eligible once `scheduled_at <= NOW()`.
- Failed jobs with retry backoff are only eligible once `next_attempt_at <= NOW()`.

---

## 4. Verification & Concurrency Test Results

The concurrency guarantees are verified in [`tests/concurrency/job_claiming.test.ts`](file:///d:/Job%20Scheduler/tests/concurrency/job_claiming.test.ts).

### Test Scenarios Covered:
1. **High Concurrency (10 Workers, 30 Jobs)**: 10 concurrent worker tasks running parallel claim loops via `Promise.all`. Verified that **all 30 jobs were claimed exactly once** with zero duplicates (`Set(claimedIds).size === 30`).
2. **Priority Ordering**: Verified priority 10 jobs are claimed before priority 5 and priority 1 jobs.
3. **Paused Queue Isolation**: Verified zero jobs are claimed while a queue is paused, and claims immediately resume when unpaused.
4. **Concurrency Limits**: Verified that a queue with limit = 2 refuses to yield a 3rd job until 1 of the running jobs finishes.
5. **Worker Assignment & State Transition**: Verified every claimed job has `status = 'running'`, `worker_id` recorded, and `attempt_count` incremented.
6. **Failure & DLQ Movement**: Verified retry backoff timestamping and automatic snapshot insertion into `dead_letter_jobs` upon exhausting `max_attempts`.
