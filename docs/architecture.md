# Distributed Job Scheduler — System Architecture & Internals

Comprehensive architectural documentation for the high-throughput, multi-tenant **Distributed Job Scheduler** platform.

---

## 1. High-Level Architecture Diagram

```mermaid
flowchart TD
    classDef clientStyle fill:#1e293b,stroke:#3b82f6,stroke-width:2px,color:#f8fafc;
    classDef apiStyle fill:#0f172a,stroke:#6366f1,stroke-width:2px,color:#f8fafc;
    classDef dbStyle fill:#1e1b4b,stroke:#8b5cf6,stroke-width:2px,color:#f8fafc;
    classDef workerStyle fill:#022c22,stroke:#10b981,stroke-width:2px,color:#f8fafc;
    classDef schedStyle fill:#451a03,stroke:#f59e0b,stroke-width:2px,color:#f8fafc;
    classDef dlqStyle fill:#4c0519,stroke:#f43f5e,stroke-width:2px,color:#f8fafc;

    User["👤 User / External System"]:::clientStyle
    Dashboard["🖥️ React Dashboard (Vite + Tailwind)"]:::clientStyle
    API["⚡ Express REST API (Auth, RBAC, CRUD, Telemetry)"]:::apiStyle
    Redis[("🔴 Redis (Redlock Leader Election & Caching)")]:::apiStyle
    Postgres[("🐘 PostgreSQL (Primary Datastore & State Machine)")]:::dbStyle

    subgraph StorageLayer ["PostgreSQL Database Tables"]
        Queues[("📋 queues")]:::dbStyle
        JobsTable[("📦 jobs")]:::dbStyle
        Executions[("⏱️ job_executions")]:::dbStyle
        WorkerTable[("👷 workers & worker_heartbeats")]:::dbStyle
        DLQTable[("💀 dead_letter_jobs (DLQ)")]:::dlqStyle
    end

    Scheduler["⏰ Distributed Scheduler (Cron & Delayed Dispatch)"]:::schedStyle
    WorkerFleet["👷 Worker Nodes (Concurrent Claim & Execution Fleet)"]:::workerStyle

    User -->|"HTTP / Web UI"| Dashboard
    User -->|"HTTP API (Bearer JWT / x-api-key)"| API
    Dashboard -->|"Axios REST Calls"| API

    API -->|"CRUD, Queries & Ingestion"| Postgres
    API -->|"Rate Limiting & Token Checks"| Redis

    Scheduler -->|"Distributed Leader Lock"| Redis
    Scheduler -->|"Poll Scheduled / Cron & Promote to Pending"| JobsTable

    WorkerFleet -->|"Heartbeat Ping (every 5s)"| WorkerTable
    WorkerFleet -->|"FOR UPDATE SKIP LOCKED (Atomic Claim)"| JobsTable
    WorkerFleet -->|"Record Execution Timeline & Logs"| Executions
    WorkerFleet -->|"Exhausted Max Retries"| DLQTable

    Queues -.->|"Configures Concurrency & Priority"| JobsTable
```

---

## 2. Core Architectural Components

### 2.1 React Web Dashboard (`frontend/`)

- **Technology**: React 18, TypeScript, Vite, Tailwind CSS, Lucide Icons, Recharts.
- **Role**: Provides real-time visibility into queue depths, active worker nodes, running/pending/completed jobs, and quarantined Dead Letter Queue (DLQ) records. Includes interactive job dispatching, log inspection, and 20-item paginated backlog telemetry.

### 2.2 Express REST API Gateway (`backend/api/`)

- **Technology**: Express.js, TypeScript, Zod Schema Validation, Helmet, Morgan, Winston.
- **Role**: Entry point for users, microservices, and external systems. Handles:
  - **Authentication & RBAC**: JWT Bearer validation with `HS256` lockdown and SHA-256 API Key authorization.
  - **Multi-Tenant Isolation**: Enforces tenant-boundary checks across Organizations, Projects, Queues, and Jobs.
  - **Job Ingestion**: Immediate enqueuing, batch submissions (up to 1,000 jobs per transaction), and recurring cron job template registration.
  - **Telemetry & Prometheus Export**: Real-time aggregation of p50/p95/p99 duration percentiles and Prometheus exposition text output (`/api/v1/metrics/prometheus`).

### 2.3 Distributed Scheduler Service (`backend/scheduler/`)

- **Technology**: Node.js, `cron-parser`, Redis Redlock distributed locking.
- **Role**: Runs as a resilient standalone daemon or clustered service:
  - **Delayed Job Promotion**: Periodically queries `jobs WHERE status = 'scheduled' AND scheduled_at <= NOW()` and promotes them to `'pending'`.
  - **Cron Execution Engine**: Evaluates standard 5-field cron schedules, calculates `next_run_at`, and generates concrete pending job instances before scheduled execution windows.
  - **Leader Election**: Uses Redis distributed locks (`redlock:scheduler:leader`) so that only one active scheduler instance evaluates cron intervals at a time, eliminating duplicate job generation.

### 2.4 Worker Fleet (`backend/worker/`)

- **Technology**: Node.js async execution runtime, worker concurrency pools.
- **Role**: Distributed workers that poll active queues, claim batches of jobs atomically, and execute registered handlers:
  - **Concurrency Control**: Enforces worker-level concurrency capacity and queue-level concurrency limits.
  - **Liveness & Heartbeats**: Emits background heartbeats every 5 seconds to `workers` and `worker_heartbeats`.
  - **Graceful Shutdown**: Intercepts `SIGTERM` / `SIGINT` signals, transitions to `draining` status, completes in-flight jobs within a configurable grace period, and cleanly releases resources.

### 2.5 PostgreSQL Persistence & State Machine (`backend/shared/src/db/`)

- **Technology**: PostgreSQL 14+, connection pooling (`pg.Pool`), strict foreign keys, and indexes.
- **Role**: Acts as the single source of truth for all system state. Concurrency is guaranteed at the database engine level via `SELECT ... FOR UPDATE SKIP LOCKED` and row-level locks.

---

## 3. End-to-End Execution Lifecycles

### Flow A: Successful Job Execution (Happy Path)

```mermaid
sequenceDiagram
    autonumber
    actor Client as Client / Dashboard
    participant API as REST API
    participant DB as PostgreSQL
    participant Worker as Worker Process

    Client->>API: POST /api/v1/queues/:queueId/jobs { name, payload, priority }
    API->>DB: INSERT INTO jobs (status = 'pending', attempt_count = 0)
    DB-->>API: 201 Created (jobId: e7b0...)
    API-->>Client: Job Enqueued

    loop Polling Cycle
        Worker->>DB: BEGIN TRANSACTION
        Worker->>DB: SELECT id FROM queues WHERE id = $1 FOR UPDATE
        Worker->>DB: SELECT COUNT(*) FROM jobs WHERE queue_id = $1 AND status = 'running'
        Worker->>DB: SELECT * FROM jobs WHERE status = 'pending' ORDER BY priority DESC FOR UPDATE SKIP LOCKED
        Worker->>DB: UPDATE jobs SET status = 'running', worker_id = $workerId, attempt_count = attempt_count + 1
        Worker->>DB: COMMIT TRANSACTION
    end

    Note over Worker: Worker executes job handler with context.payload

    Worker->>DB: INSERT INTO job_executions (attempt_number, status = 'completed', duration_ms)
    Worker->>DB: UPDATE jobs SET status = 'completed', result = {...}, finished_at = NOW()
    Worker->>DB: UPDATE workers SET current_job_count = current_job_count - 1
```

#### Step-by-Step Explanation:

1. **Creation**: The client submits a job specification to `POST /api/v1/queues/:queueId/jobs`.
2. **Persistence**: The API validates the payload with Zod and inserts a row into `jobs` with `status = 'pending'`, `attempt_count = 0`, and `enqueued_at = NOW()`.
3. **Atomic Claim**:
   - An active worker checks its capacity (`availableSlots = maxConcurrency - currentJobCount`).
   - If slots are available, it starts a transaction, acquires an exclusive lock on the queue row to serialize concurrency limits, and runs `SELECT ... FOR UPDATE SKIP LOCKED`.
   - The claimed job's status atomically transitions to `'running'`, `attempt_count` increments to `1`, and `started_at` is stamped.
4. **Execution**: The worker dispatches the job payload to the registered TypeScript handler function.
5. **Success Stamping**: Upon successful completion, the worker records a `job_executions` record containing duration, updates `jobs` to `status = 'completed'`, and frees the concurrency slot.

---

### Flow B: Job Failure, Exponential Retry & DLQ Transition

```mermaid
sequenceDiagram
    autonumber
    participant Worker as Worker Process
    participant DB as PostgreSQL
    participant Scheduler as Scheduler Engine
    participant DLQ as Dead Letter Queue

    Worker->>DB: Atomically claim job (Attempt 1 / 3)
    Note over Worker: Execution throws Error: "Upstream 503 Timeout"

    Worker->>DB: INSERT INTO job_executions (attempt: 1, status: 'failed', error: 'Upstream 503')
    Worker->>DB: UPDATE jobs SET status = 'failed', next_attempt_at = NOW() + backoffDelay

    Note over Scheduler: Exponential Backoff window elapses (e.g. 2000ms + jitter)

    Scheduler->>DB: UPDATE jobs SET status = 'pending' WHERE status = 'failed' AND next_attempt_at <= NOW()

    Worker->>DB: Atomically claim job (Attempt 2 / 3)
    Note over Worker: Execution throws Error: "Upstream 503 Timeout"
    Worker->>DB: INSERT INTO job_executions (attempt: 2, status: 'failed')
    Worker->>DB: UPDATE jobs SET status = 'failed', next_attempt_at = NOW() + backoffDelay

    Scheduler->>DB: Promote job back to 'pending' (Attempt 3 / 3)

    Worker->>DB: Atomically claim job (Attempt 3 / 3)
    Note over Worker: Final attempt fails (attempt_count >= max_attempts)

    Worker->>DB: BEGIN TRANSACTION
    Worker->>DB: INSERT INTO dead_letter_jobs (job_id, queue_id, payload, total_attempts, final_error)
    Worker->>DB: UPDATE jobs SET status = 'dead', finished_at = NOW()
    Worker->>DB: COMMIT TRANSACTION
```

#### Step-by-Step Explanation:

1. **Initial Failure**: A claimed job throws an unhandled exception or times out.
2. **Attempt Recording**: The worker records the attempt failure in `job_executions` with error message, stack, and execution duration.
3. **Exponential Backoff Calculation**:
   - The retry policy evaluates the delay:
     $$\text{delay} = \min\left(\text{maxDelayMs}, \text{initialDelayMs} \times (\text{backoffMultiplier})^{\text{attempt} - 1} + \text{random}(\text{jitterMs})\right)$$
   - The job is stamped with `next_attempt_at = NOW() + delay` and `status = 'failed'`.
4. **Retry Promotion**: The scheduler or worker daemon checks for failed jobs whose `next_attempt_at <= NOW()` and promotes them back to `'pending'`.
5. **Exhaustion & DLQ Quarantine**:
   - When a job fails on its terminal attempt (`attempt_count >= max_attempts`):
     - An atomic database transaction inserts a comprehensive snapshot of the job definition, arguments, payload, and final stack trace into `dead_letter_jobs`.
     - The job in `jobs` transitions to `status = 'dead'`, quarantining it from further worker execution.
6. **Manual / Programmatic Recovery**: Operators can inspect DLQ entries in the dashboard and trigger `POST /api/v1/dlq/:dlqId/retry` to replay the job into its original queue.

---

## 4. Concurrency, Race Condition & Failure Handling

| Scenario                                | Architectural Mechanism                                                                                               | Guarantee                                                                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Two Workers Claiming Same Job**       | `SELECT ... FOR UPDATE SKIP LOCKED`                                                                                   | Zero duplicate claims. Only one worker acquires the row lock; other workers skip to subsequent jobs without blocking.                        |
| **Queue Concurrency Overflow**          | Two-statement sequential queue row locking (`SELECT id FROM queues FOR UPDATE` followed by fresh running count query) | In-flight jobs on any queue strictly never exceed `concurrency_limit` even under high concurrency.                                           |
| **Duplicate Scheduler Instances**       | Redis Redlock distributed mutex (`redlock:scheduler:leader`) with automatic renewal                                   | Only the active leader instance triggers cron intervals. Secondary schedulers remain in hot-standby mode.                                    |
| **Worker Node Hard Crash / Power Loss** | Background Stale Worker Scanner (`POST /api/v1/workers/stale/scan`)                                                   | Workers missing heartbeats for $>30\text{s}$ are reaped to `unhealthy`. Abandoned running jobs are recovered and rescheduled.                |
| **Worker Stale State Fencing**          | Worker ownership check in `completeJob()` and `failJob()` (`WHERE id = $1 AND worker_id = $2`)                        | If a slow worker resumes after being reaped, its attempt to complete or fail a reassigned job is rejected without corrupting state.          |
| **Transaction Rollback Atomicity**      | PostgreSQL multi-statement atomic transactions (`BEGIN ... COMMIT / ROLLBACK`)                                        | Database operations (job claim + worker slot increment, DLQ insertion + job death) succeed or fail as single atomic units.                   |
| **Job Cancellation Race**               | State Machine Guard (`assertStateTransition`)                                                                         | Cancelling a running or completed job raises a domain exception, preventing race conditions between user cancellation and worker completion. |
| **Priority Inversion**                  | Strict Composite Indexing `(status, priority DESC, enqueued_at ASC)`                                                  | Higher priority jobs (P10) are always claimed and executed before lower priority jobs (P1) regardless of submission time.                    |
| **Poison-Pill / Corrupt Payload**       | Quarantined Dead Letter Queue (`dead_letter_jobs`)                                                                    | Unrecoverable jobs are isolated after $N$ attempts without blocking or degrading processing of healthy jobs in the queue.                    |
| **Credential Stuffing & DoS**           | Dual Rate Limiter (Global 300 req/min + Auth 50 req/15 min) + `1mb` Body Limit                                        | Protects authentication endpoints from brute-force password guessing and server memory from payload exhaustion.                              |
