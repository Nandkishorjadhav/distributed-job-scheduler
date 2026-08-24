# Scheduler Service Engine

## Overview

The **Scheduler Service** ([`Scheduler.ts`](file:///d:/Job%20Scheduler/backend/scheduler/src/Scheduler.ts)) is an autonomous engine responsible for managing time-based job transitions. It identifies delayed jobs, one-off scheduled jobs, and recurring cron job definitions whose execution time has arrived, safely promotes them to `QUEUED` (`status = 'pending'`), and updates scheduling metadata.

> [!IMPORTANT]
> The scheduler **never executes jobs directly**. It only makes due jobs eligible in the database (`status = 'pending'`) for distributed worker nodes to claim and execute concurrently.

---

## 1. Supported Time-Based Job Types

| Type                       | Source Table     | Transition / Action                 | Trigger Condition                |
| :------------------------- | :--------------- | :---------------------------------- | :------------------------------- |
| **Delayed Jobs**           | `jobs`           | `SCHEDULED` $\rightarrow$ `PENDING` | `scheduled_at <= NOW()`          |
| **One-off Scheduled Jobs** | `jobs`           | `SCHEDULED` $\rightarrow$ `PENDING` | `scheduled_at <= NOW()`          |
| **Recurring Cron Jobs**    | `scheduled_jobs` | Spawns child job in `PENDING` state | `next_run_at <= NOW()` or `NULL` |

---

## 2. Delayed & Scheduled Job Promotion

The scheduler periodically runs `promoteDueJobs()`:

```sql
WITH due_jobs AS (
  SELECT j.id
  FROM jobs j
  JOIN queues q ON q.id = j.queue_id
  WHERE j.status = 'scheduled'
    AND j.scheduled_at <= NOW()
    AND q.status != 'archived'
  ORDER BY j.scheduled_at ASC
  LIMIT $1
  FOR UPDATE OF j SKIP LOCKED
)
UPDATE jobs
SET status = 'pending',
    enqueued_at = NOW(),
    updated_at = NOW()
FROM due_jobs
WHERE jobs.id = due_jobs.id
RETURNING jobs.id, jobs.name, jobs.queue_id, jobs.scheduled_at;
```

- Transitions job state from `SCHEDULED` to `PENDING` (`QUEUED`).
- Stamped with `enqueued_at = NOW()`.
- Records audit log entry into `job_logs`: `"Job promoted from scheduled to queued (pending) for worker execution"`.

---

## 3. Recurring Cron Jobs & Overlap Prevention

The scheduler runs `dispatchDueRecurringJobs()`:

1. **Locking**: Selects due templates with `SELECT ... FROM scheduled_jobs ... FOR UPDATE SKIP LOCKED`.
2. **Overlap Avoidance (`skip_if_running`)**:
   - If `skip_if_running = true` and `last_job_id` is currently `pending` or `running`:
   - Skips spawning a duplicate run for this tick.
   - Advances `next_run_at` to the next future occurrence.
3. **Missed Schedule Handling**:
   - If `next_run_at` is in the past (e.g. following maintenance or downtime), the scheduler catches up by firing the **single latest execution instance** and immediately advances `next_run_at` to the next upcoming future occurrence relative to `NOW()`. This prevents thundering backfill storms.
4. **Child Job Spawning**:
   - Creates a new child job row in `jobs` with `type = 'recurring'`, `status = 'pending'`, and `scheduled_job_id` linked to the template.
5. **Metadata Update**:
   - Updates `scheduled_jobs.last_fired_at = NOW()`, `scheduled_jobs.last_job_id = newJob.id`, `scheduled_jobs.next_run_at = nextRunDate`, and increments `run_count`.

---

## 4. Multi-Instance Scheduler Concurrency Safety

- Both `promoteDueJobs()` and `dispatchDueRecurringJobs()` utilize PostgreSQL row-level exclusive locks with `SKIP LOCKED` inside transactions.
- When multiple scheduler instances run simultaneously:
  - Instance 1 locks and processes batch 1.
  - Instance 2 instantly skips locked rows without blocking and processes subsequent batches.
  - **Zero duplicate job promotions** and **zero duplicate child jobs created**.

---

## 5. Automated Test Results

Ran `npx vitest run scheduler/scheduler.test.ts`:

```text
✓ scheduler/scheduler.test.ts (8 tests)
  ✓ 1. Delayed Jobs Promotion > promotes delayed jobs from SCHEDULED to PENDING (QUEUED) when execution time arrives
  ✓ 1. Delayed Jobs Promotion > does NOT promote future delayed jobs whose execution time has not arrived
  ✓ 2. One-off Scheduled Jobs Promotion > identifies and promotes due one-off scheduled jobs
  ✓ 3. Recurring Cron Jobs Dispatching > dispatches due recurring cron jobs by creating child job instances in PENDING state
  ✓ 3. Recurring Cron Jobs Dispatching > prevents overlapping runs when skip_if_running is enabled and previous run is active
  ✓ 4. Duplicate Scheduler Instances & High-Concurrency Safety > ensures multiple concurrent scheduler instances promote delayed jobs with zero duplicates
  ✓ 4. Duplicate Scheduler Instances & High-Concurrency Safety > ensures multiple concurrent scheduler instances dispatch cron templates without duplicate child jobs
  ✓ 5. Missed Schedule Handling > handles severely missed schedules by firing once and advancing next_run_at to the future

Test Files  1 passed (1)
     Tests  8 passed (8)
```
