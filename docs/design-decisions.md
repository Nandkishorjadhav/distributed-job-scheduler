# Distributed Job Scheduler — Design Decisions & Engineering Trade-offs

This document details the architectural, algorithmic, and data modeling decisions made in the **Distributed Job Scheduler** platform, along with honest evaluations of trade-offs, edge-case handling, and current system limitations.

---

## Table of Contents

1. [Why PostgreSQL?](#1-why-postgresql)
2. [Why Redis?](#2-why-redis)
3. [Why Modular Architecture (Monorepo)?](#3-why-modular-architecture-monorepo)
4. [Why Row-Level Locking?](#4-why-row-level-locking)
5. [Why SELECT FOR UPDATE SKIP LOCKED?](#5-why-select-for-update-skip-locked)
6. [How Duplicate Job Claims are Prevented](#6-how-duplicate-job-claims-are-prevented)
7. [How Queue Concurrency is Enforced](#7-how-queue-concurrency-is-enforced)
8. [How Retries Work](#8-how-retries-work)
9. [Why Exponential Backoff is Useful](#9-why-exponential-backoff-is-useful)
10. [How the Dead Letter Queue (DLQ) Works](#10-how-the-dead-letter-queue-dlq-works)
11. [How Worker Failure is Detected](#11-how-worker-failure-is-detected)
12. [Graceful Shutdown Strategy](#12-graceful-shutdown-strategy)
13. [Idempotency Strategy](#13-idempotency-strategy)
14. [Scheduler Design & Leader Election](#14-scheduler-design--leader-election)
15. [Pagination Strategy](#15-pagination-strategy)
16. [Indexing Strategy](#16-indexing-strategy)
17. [Logging & Telemetry Strategy](#17-logging--telemetry-strategy)
18. [Testing Strategy](#18-testing-strategy)
19. [Architectural Trade-offs](#19-architectural-trade-offs)
20. [Known Limitations & Future Roadmap](#20-known-limitations--future-roadmap)

---

## 1. Why PostgreSQL?

Many job queues (e.g. BullMQ, Celery with Redis) store active queues entirely in memory. While Redis offers microsecond latencies, using **PostgreSQL as the primary source of truth** provides critical benefits for enterprise workflows:

- **Strict ACID Guarantees**: Enqueuing a job can be part of the same database transaction as a business domain operation (e.g. inserting an order and creating an fulfillment job atomically).
- **Rich Relational Queries & Auditing**: Complex filtering across tenants, organizations, projects, priority ranges, execution durations, and error messages without maintaining dual databases.
- **Durable State Machine**: PostgreSQL enforces job state integrity via enums, check constraints, foreign keys, and cascading rules. Jobs are never lost if a node crashes or loses power.
- **Operational Simplicity**: Teams already operating PostgreSQL do not need to operate and backup a secondary message broker like RabbitMQ or Kafka for background job workloads.

---

## 2. Why Redis?

While PostgreSQL handles state persistence and queue storage, Redis is used selectively for distributed coordination tasks where relational databases are less suited:

- **Distributed Leader Election (Redlock)**: Schedulers run across multiple instances for high availability. Redis provides sub-millisecond distributed mutexes (`redlock:scheduler:leader`) with automatic expiration keys and renewal loops, ensuring that only one scheduler instance evaluates cron schedules at a time.
- **Fast Ephemeral Caching & Rate Limiting**: In-memory counters for IP-level rate limiting and volatile session tokens benefit from Redis's atomic increment commands without placing load on the PostgreSQL connection pool.

---

## 3. Why Modular Architecture (Monorepo)?

The project is structured into modular packages:

- `packages/shared`: Pure domain types, enums, and Zod schemas shared across frontend and backend.
- `backend/shared`: Database repositories, connection pools, state machines, and logging utilities.
- `backend/api`: Stateless Express REST API Gateway.
- `backend/scheduler`: Standalone cron and delayed job promotion daemon.
- `backend/worker`: Standalone multi-threaded/multi-process worker execution engine.
- `frontend`: React 18 / Tailwind CSS client dashboard.

### Rationale:

- **Independent Scalability**: In production, the API Gateway, Worker Fleet, and Scheduler can scale independently. Workers can scale to 100+ CPU-heavy instances while the Scheduler runs as a lightweight 2-node HA pair.
- **Type Safety End-to-End**: A change in a job schema or status enum in `packages/shared` immediately updates TypeScript types across the React frontend and backend services at build time.

---

## 4. Why Row-Level Locking?

In a multi-worker environment, if workers use standard `SELECT` statements, multiple workers would read the same available jobs simultaneously, leading to duplicate execution or write-write conflicts.

- Explicit row-level locking (`FOR UPDATE`) locks specific rows at the storage layer for the duration of the claiming transaction.
- When paired with transactions, row locks guarantee that intermediate state transitions (`pending` $\rightarrow$ `running`) are invisible to other connections until committed.

---

## 5. Why SELECT FOR UPDATE SKIP LOCKED?

Standard `SELECT ... FOR UPDATE` causes concurrent transactions to **block and wait** in a queue until the first transaction releases its lock on the selected rows.

- **Contention Bottleneck**: If 10 workers query the top 5 jobs simultaneously with `FOR UPDATE`, 9 workers will block until Worker 1 commits.
- **The `SKIP LOCKED` Solution**: `SKIP LOCKED` instructs PostgreSQL to skip any rows currently locked by other concurrent transactions and immediately return the next available unlocked rows.
- **Result**: Completely lockless-like throughput for worker claiming. Workers never wait on each other; each claims its own non-overlapping batch of pending jobs.

---

## 6. How Duplicate Job Claims are Prevented

Duplicate execution of the same attempt is prevented by a multi-layered barrier:

1. **Atomic CTE Query**: The claim operation executes as a single atomic SQL Common Table Expression (CTE):
   ```sql
   WITH eligible_jobs AS (
     SELECT j.id FROM jobs j
     JOIN queues q ON q.id = j.queue_id
     WHERE j.status = 'pending' AND q.status = 'active'
     ORDER BY j.priority DESC, j.enqueued_at ASC
     LIMIT $limit
     FOR UPDATE OF j SKIP LOCKED
   )
   UPDATE jobs
   SET status = 'running', worker_id = $workerId, attempt_count = attempt_count + 1
   FROM eligible_jobs WHERE jobs.id = eligible_jobs.id
   RETURNING jobs.*;
   ```
2. **PostgreSQL Statement Atomicity**: The row selection, locking, and status update happen in the exact same statement snapshot.
3. **Worker Fencing**: When a worker completes or fails a job, it executes `WHERE id = $1 AND worker_id = $2`. If the job was re-assigned due to a heartbeat timeout, the stale worker's write is rejected.

---

## 7. How Queue Concurrency is Enforced

Each queue has an optional `concurrency_limit` (e.g. max 10 active running jobs). Enforcing this in PostgreSQL under high worker concurrency requires avoiding `READ COMMITTED` snapshot race conditions:

1. **Explicit Two-Statement Sequential Locking**:
   ```ts
   // 1. Lock the queue row exclusively
   const lockRes = await client.query(
     `SELECT id, concurrency_limit FROM queues WHERE id = $1 AND status = 'active' FOR UPDATE`,
     [queueId]
   );
   // 2. Count active running jobs with a fresh statement snapshot strictly after lock acquisition
   const countRes = await client.query(
     `SELECT COUNT(*) FROM jobs WHERE queue_id = $1 AND status = 'running'`,
     [queueId]
   );
   const availableSlots = Math.max(0, concurrencyLimit - runningCount);
   ```
2. **Why Sequential Queries?**: In PostgreSQL `READ COMMITTED` mode, correlated subqueries inside a single `SELECT ... FOR UPDATE` statement may evaluate against the snapshot taken before the lock was granted. Executing the count _after_ obtaining the queue lock guarantees an up-to-the-millisecond accurate running count.

---

## 8. How Retries Work

When a worker catches an unhandled error or execution timeout:

1. It records the attempt outcome in `job_executions` (`status = 'failed'`, `duration_ms`, `error_message`).
2. If `attempt_count < max_attempts`:
   - Calculates the delay according to the queue's retry strategy (`exponential`, `linear`, or `fixed`).
   - Updates `jobs` with `status = 'failed'` and `next_attempt_at = NOW() + delay`.
3. The job remains quarantined in `status = 'failed'` so workers skip it until `next_attempt_at` has passed.
4. When `next_attempt_at <= NOW()`, the scheduler (or worker claim loop) promotes the job back to `status = 'pending'`, making it eligible for claiming.

---

## 9. Why Exponential Backoff is Useful

If a downstream service (database, third-party API, payment gateway) crashes or rate-limits requests, retrying immediately at full speed creates a **thundering herd problem** that prevents the downstream service from recovering.

- **Formula**:
  $$\text{delay} = \min\left(\text{maxDelayMs}, \text{initialDelayMs} \times (\text{backoffMultiplier})^{\text{attempt} - 1} + \text{random}(\text{jitterMs})\right)$$
- **Exponential Curve**: Spreads out retries over increasingly larger intervals (e.g. 1s $\rightarrow$ 2s $\rightarrow$ 4s $\rightarrow$ 8s $\rightarrow$ 16s).
- **Jitter Addition**: Adding random millisecond variance prevents all failed batch jobs from retrying at the exact same millisecond.

---

## 10. How the Dead Letter Queue (DLQ) Works

When a job fails its terminal attempt (`attempt_count >= max_attempts`):

1. **Atomic Quarantine**: An atomic database transaction inserts a comprehensive snapshot of the job into `dead_letter_jobs`:
   - Original `job_id`, `queue_id`, and `project_id`
   - Initial JSON payload and parameters
   - Total attempts executed
   - Final error message and error code
   - Hostname of the worker that executed the terminal attempt
2. **Job Death**: The source job in `jobs` is updated to `status = 'dead'`.
3. **Non-Blocking Guarantee**: Quarantining permanently failed jobs prevents "poison-pill" payloads from endlessly cycling through workers and starving healthy jobs.
4. **Replay Capabilities**: Administrators can inspect quarantined payloads in the UI and invoke `POST /api/v1/dlq/:dlqId/retry` to replay the job as a clean execution.

---

## 11. How Worker Failure is Detected

Workers are physical or virtual processes that can crash, get OOM-killed, or lose network connectivity without notifying the scheduler.

1. **Heartbeat Loop**: Every running worker node executes a background timer every 5 seconds calling `POST /api/v1/workers/:workerId/heartbeat` to update its `last_heartbeat_at` timestamp in the database.
2. **Stale Worker Scanner**: A background maintenance routine runs periodically:
   ```sql
   UPDATE workers
   SET status = 'unhealthy'
   WHERE status IN ('online', 'busy')
     AND last_heartbeat_at < NOW() - INTERVAL '30 seconds';
   ```
3. **Orphaned Job Recovery**: When a worker is marked `unhealthy`, any jobs left in `status = 'running'` assigned to that worker are reset to `status = 'failed'` (or `pending`) so other healthy workers can claim and recover them.

---

## 12. Graceful Shutdown Strategy

When a worker process receives an OS termination signal (`SIGTERM`, `SIGINT`):

1. **State Transition**: Sets `status = 'draining'` and stops polling for new jobs immediately (`availableSlots = 0`).
2. **In-Flight Completion**: Waits for active promise handles in `this.activeJobs` to resolve cleanly within a configurable grace period (default: 15 seconds).
3. **Database Deregistration**: Sends a final `status = 'stopped'` update to PostgreSQL.
4. **Clean Exit**: Exits with code `0`, ensuring zero jobs are aborted mid-flight during normal rolling deployments or autoscaling events.

---

## 13. Idempotency Strategy

In distributed systems, the network guarantee for job dispatching is **at-least-once**. A worker might complete a task, but crash right before stamping `status = 'completed'` in PostgreSQL.

- **Client-Side Deduplication**: Jobs can be submitted with a unique name or payload signature per queue.
- **Batch Group Identifiers**: Batches are grouped by unique `batchGroupId` UUIDs to ensure batch tracking atomicity.
- **Worker Handler Recommendations**: Job handlers should design state changes to be idempotent (e.g. using database `ON CONFLICT DO NOTHING`, idempotent payment keys, or checking if target records already exist before creating).

---

## 14. Scheduler Design & Leader Election

The Scheduler daemon performs two distinct tasks:

1. **Delayed Job Promotion**: Periodic polling for scheduled jobs whose `scheduled_at <= NOW()`.
2. **Cron Schedule Generation**: Parsing 5-field cron strings (e.g. `*/10 * * * *`) and calculating `next_run_at`.

### Distributed Leader Election (Redlock):

If 3 scheduler containers run in a Kubernetes cluster, only **one** instance must evaluate schedules to prevent duplicate job generation.

- The active scheduler acquires a distributed lock in Redis: `SET redlock:scheduler:leader <instanceId> NX PX 10000`.
- The leader renews the lock every 5 seconds.
- If the leader fails to renew within 10 seconds, secondary schedulers compete to acquire the lock and seamlessly take over leadership.

---

## 15. Pagination Strategy

All listing endpoints (`/jobs`, `/queues`, `/workers`, `/dlq`, `/orgs`, `/projects`) support deterministic pagination:

- **Standard Envelope**: Returns `{ data: [...], pagination: { page, pageSize, total, totalPages } }`.
- **Query Optimization**: Counts and queries are scoped to the user's authorized tenant organizations.
- **Frontend Backlog Chunking**: The dashboard UI slices high-volume queues into 20-item pages with Next/Previous boundary controls to ensure rapid rendering and low memory consumption.

---

## 16. Indexing Strategy

PostgreSQL performance on high-volume tables depends strictly on partial and composite indexes:

- `idx_jobs_claim_composite`: `(queue_id, status, priority DESC, enqueued_at ASC) WHERE status = 'pending'` — Used by the atomic claim CTE for immediate index scans.
- `idx_jobs_scheduled_lookup`: `(scheduled_at, status) WHERE status = 'scheduled'` — Used by the scheduler to promote delayed jobs in $O(\log N)$ time.
- `idx_jobs_retry_lookup`: `(next_attempt_at, status) WHERE status = 'failed'` — Used by retry loops.
- `idx_jobs_running_per_queue`: `(queue_id, status) WHERE status = 'running'` — Optimizes concurrency count queries.
- `idx_org_members_user`: `(user_id, organization_id)` — Accelerates tenant authorization checks on every API request.

---

## 17. Logging & Telemetry Strategy

- **Structured JSON Logging**: Winston logger emits structured JSON in production with correlation `requestId`, `jobId`, `workerId`, and `durationMs`.
- **Automatic Sensitive Data Redaction**: Recursive `sanitizeInPlace` formatter automatically masks sensitive fields (`password`, `token`, `secret`, `apiKey`, `cookie`, `jwt`) as `[REDACTED]`.
- **Prometheus Metric Exposition**: Real-time export endpoint (`/api/v1/metrics/prometheus`) exposes gauges for queue depth, worker count, and true execution duration percentiles ($p50, p95, p99$).

---

## 18. Testing Strategy

The test suite covers unit, integration, concurrency, and stress test scenarios:

- **18 Test Files / 149 Automated Tests (100% Pass Rate)**.
- **Concurrency Verification**: Tests 2 workers claiming a single job (`FOR UPDATE SKIP LOCKED`), 10 workers competing for 40 jobs, queue concurrency limits, transaction rollbacks, Redlock leader failover, and cancellation races.
- **Flagship 100-Job Fleet Stress Test**: Verifies zero duplicate claims, exact retry attempt boundaries, and terminal DLQ snapshots across 5 parallel worker processes.

---

## 19. Architectural Trade-offs

| Decision                              | Upside                                                                       | Downside / Trade-off                                                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **PostgreSQL as Queue Store**         | Full ACID transactions, rich querying, persistent auditing, no extra broker. | Throughput capped by PostgreSQL write IOPS (typically ~5,000–20,000 jobs/sec per primary node vs. 100,000+ for Kafka/Redis). |
| **SKIP LOCKED Claiming**              | Zero lock contention between workers, simple polling.                        | Polling-based claiming incurs database queries even when queues are idle (mitigated by exponential backoff on empty polls).  |
| **Worker Local Concurrency Pool**     | Fast in-memory dispatching within worker Node.js event loop.                 | Worker crashes abort in-flight promises that must wait for the 30-second heartbeat timeout to be recovered.                  |
| **Relational Schema vs. JSONB Blobs** | Strict check constraints, indexability, clean relational integrity.          | Schema migrations required when altering job core columns.                                                                   |

---

## 20. Known Limitations & Future Roadmap

_An honest engineering appraisal of current limitations and planned enhancements:_

1. **Horizontal Scaling of PostgreSQL Primary**:
   - _Current State_: All write operations (`INSERT jobs`, `UPDATE status`) hit the primary PostgreSQL node.
   - _Limitation_: Extreme write workloads ($>50,000\text{ jobs/sec}$) will eventually saturate database write IOPS.
   - _Roadmap_: Implement table partitioning by date/project or shard queues across multiple database instances.

2. **Long-Running Job Heartbeat Extension**:
   - _Current State_: Worker processes emit process-level heartbeats. If a single job takes 10 minutes, the worker remains healthy, but the specific job execution duration must be guarded by `timeoutMs`.
   - _Roadmap_: Implement per-job heartbeat renewal for long-running batch/ML tasks.

3. **WebSocket Live Push for Dashboard**:
   - _Current State_: The dashboard uses 5-second polling intervals to refresh metrics and queue depths.
   - _Roadmap_: Add WebSocket / SSE (Server-Sent Events) push gateway using Redis Pub/Sub for real-time live graph updates.

4. **Dynamic Rate Limiting per Project**:
   - _Current State_: API rate limits are applied globally per IP.
   - _Roadmap_: Implement tenant-level token bucket rate limiting stored in Redis to enforce tier-based subscription limits.
