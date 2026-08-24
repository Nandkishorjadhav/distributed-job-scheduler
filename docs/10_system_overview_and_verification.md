# Step 10: System Overview, API Reference & Verification Playbook

## Overview

This guide provides the master architecture overview, complete API endpoints catalog, configuration reference, and step-by-step verification instructions (both automated test suites and interactive scripts) for the entire **Distributed Job Scheduler** platform.

---

## 1. Complete System Architecture

```
                          ┌───────────────────────────┐
                          │   React & Vite Dashboard  │
                          │   (frontend: port 5173)   │
                          └─────────────┬─────────────┘
                                        │
                                        ▼
                          ┌───────────────────────────┐
                          │     Express REST API      │
                          │     (backend: port 3000)  │
                          └──────┬─────────────┬──────┘
                                 │             │
                    ┌────────────┴──┐       ┌──┴────────────┐
                    ▼               ▼       ▼               ▼
           ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
           │ PostgreSQL 17   │ │ Redis           │ │ Rate Limiter    │
           │ (Durable State) │ │ (Locks & Pub/Sub)│ │ & Auth Guards  │
           └────────┬────────┘ └────────┬────────┘ └─────────────────┘
                    │                   │
         ┌──────────┴───────────────────┴──────────┐
         │                                         │
         ▼                                         ▼
┌─────────────────────────┐               ┌─────────────────────────┐
│     Worker Nodes        │               │    Scheduler Engine     │
│ (Claim via FOR UPDATE   │               │ (Promotes delayed jobs, │
│  SKIP LOCKED, execute   │               │  evaluates recurring    │
│  handlers concurrently) │               │  cron schedules)        │
└─────────────────────────┘               └─────────────────────────┘
```

---

## 2. Master REST API Catalog

### Authentication

| Method | Endpoint                | Description                         | Auth Required |
| :----- | :---------------------- | :---------------------------------- | :-----------: |
| `POST` | `/api/v1/auth/register` | Register new user and receive JWT   |      No       |
| `POST` | `/api/v1/auth/login`    | Login user and receive JWT          |      No       |
| `GET`  | `/api/v1/auth/me`       | Retrieve authenticated user profile |      Yes      |
| `POST` | `/api/v1/auth/logout`   | Logout user                         |      Yes      |

### Organizations & Projects

| Method   | Endpoint                      | Description                     | Min Role |
| :------- | :---------------------------- | :------------------------------ | :------: |
| `POST`   | `/api/v1/orgs`                | Create organization             |   User   |
| `GET`    | `/api/v1/orgs/:orgId`         | Get organization details        | `VIEWER` |
| `PATCH`  | `/api/v1/orgs/:orgId`         | Update organization details     | `ADMIN`  |
| `POST`   | `/api/v1/projects`            | Create project                  | `ADMIN`  |
| `GET`    | `/api/v1/projects`            | List projects (with pagination) | `VIEWER` |
| `GET`    | `/api/v1/projects/:projectId` | Get project details             | `VIEWER` |
| `PATCH`  | `/api/v1/projects/:projectId` | Update project details          | `ADMIN`  |
| `DELETE` | `/api/v1/projects/:projectId` | Safely delete project           | `ADMIN`  |

### Queues

| Method   | Endpoint                         | Description                               | Min Role |
| :------- | :------------------------------- | :---------------------------------------- | :------: |
| `POST`   | `/api/v1/queues`                 | Create queue (priority, concurrency, DLQ) | `MEMBER` |
| `GET`    | `/api/v1/queues`                 | List queues (optional `?projectId=`)      | `VIEWER` |
| `GET`    | `/api/v1/queues/:queueId`        | Get queue details                         | `VIEWER` |
| `PATCH`  | `/api/v1/queues/:queueId`        | Update queue configuration                | `MEMBER` |
| `POST`   | `/api/v1/queues/:queueId/pause`  | Pause job processing on queue             | `MEMBER` |
| `POST`   | `/api/v1/queues/:queueId/resume` | Resume job processing on queue            | `MEMBER` |
| `DELETE` | `/api/v1/queues/:queueId`        | Safely delete queue                       | `ADMIN`  |
| `GET`    | `/api/v1/queues/:queueId/stats`  | Real-time queue statistics                | `VIEWER` |

### Jobs

| Method | Endpoint                            | Description                                | Min Role |
| :----- | :---------------------------------- | :----------------------------------------- | :------: |
| `POST` | `/api/v1/queues/:queueId/jobs`      | Submit job (immediate, delayed, scheduled) | `MEMBER` |
| `POST` | `/api/v1/jobs`                      | Direct job submission                      | `MEMBER` |
| `POST` | `/api/v1/queues/:queueId/batch`     | Submit batch group of child jobs           | `MEMBER` |
| `POST` | `/api/v1/queues/:queueId/recurring` | Create recurring cron schedule             | `MEMBER` |
| `GET`  | `/api/v1/jobs` / `/queues/:id/jobs` | List jobs with filtering and pagination    | `VIEWER` |
| `GET`  | `/api/v1/jobs/:jobId`               | Get single job details                     | `VIEWER` |
| `POST` | `/api/v1/jobs/:jobId/cancel`        | Cancel pending/scheduled job               | `MEMBER` |
| `POST` | `/api/v1/jobs/:jobId/retry`         | Retry failed/dead job                      | `MEMBER` |
| `GET`  | `/api/v1/jobs/:jobId/executions`    | Get execution attempt history              | `VIEWER` |
| `GET`  | `/api/v1/jobs/:jobId/logs`          | Stream execution logs (`?level=`)          | `VIEWER` |
| `GET`  | `/api/v1/jobs/:jobId/history`       | Full audit trail (job + executions + logs) | `VIEWER` |

### Dead Letter Queue (DLQ)

| Method   | Endpoint                                      | Description                                 | Min Role |
| :------- | :-------------------------------------------- | :------------------------------------------ | :------: |
| `GET`    | `/api/v1/dlq` / `/queues/:id/dlq`             | List DLQ jobs with search & filters         | `VIEWER` |
| `GET`    | `/api/v1/dlq/stats` / `/queues/:id/dlq/stats` | Dashboard DLQ statistics & breakdown        | `VIEWER` |
| `GET`    | `/api/v1/dlq/:dlqId`                          | Inspect DLQ job with attempt history & logs | `VIEWER` |
| `POST`   | `/api/v1/dlq/:dlqId/retry`                    | Re-queue dead job back to pending           | `MEMBER` |
| `POST`   | `/api/v1/dlq/:dlqId/archive`                  | Mark DLQ job as archived                    | `MEMBER` |
| `DELETE` | `/api/v1/dlq/:dlqId`                          | Permanently delete DLQ entry                | `ADMIN`  |

---

## 3. Configuration & Environment Variables

| Variable                       | Default                                                       | Purpose                                    |
| :----------------------------- | :------------------------------------------------------------ | :----------------------------------------- |
| `DATABASE_URL`                 | `postgresql://postgres:password@localhost:5432/job_scheduler` | PostgreSQL connection string               |
| `REDIS_URL`                    | `redis://localhost:6379`                                      | Redis connection string                    |
| `JWT_SECRET`                   | `dev_secret_key_change_in_production`                         | HMAC-SHA256 JWT signature key              |
| `JWT_EXPIRES_IN`               | `7d`                                                          | JWT token lifetime                         |
| `API_PORT`                     | `3000`                                                        | Port for Express REST API                  |
| `WORKER_CONCURRENCY`           | `5`                                                           | Maximum concurrent jobs per worker node    |
| `WORKER_POLL_INTERVAL_MS`      | `1000`                                                        | Polling interval when queues are idle      |
| `WORKER_HEARTBEAT_INTERVAL_MS` | `10000`                                                       | Worker liveness heartbeat interval         |
| `WORKER_DRAIN_TIMEOUT_MS`      | `30000`                                                       | Maximum wait time during graceful draining |

---

## 4. Verification Methods

### Method A: Automated Test Suite (All 99 Tests)

Run the full automated test suite from the `tests/` directory:

```powershell
cd "d:\Job Scheduler\tests"
npx vitest run --reporter=verbose
```

#### Test Suite Breakdown:

1. `shared/enums.test.ts` (3 tests): Shared enums integrity.
2. `api/health.test.ts` (3 tests): Health check and route guards.
3. `api/auth.test.ts` (15 tests): User registration, login, logout, password hashing, JWT validation.
4. `api/orgs_projects.test.ts` (16 tests): Tenant isolation, project CRUD, RBAC, safe deletion.
5. `api/queues.test.ts` (12 tests): Queue management, concurrency, pause/resume, live statistics.
6. `api/jobs.test.ts` (16 tests): 5 job types, 8 lifecycle states, FSM guards, history, logs.
7. `concurrency/job_claiming.test.ts` (7 tests): High-concurrency claiming with `FOR UPDATE SKIP LOCKED`.
8. `worker/worker_lifecycle.test.ts` (6 tests): Worker execution loop, heartbeats, draining shutdown.
9. `domain/retry_policy.test.ts` (9 tests): Backoff calculations, jitter dispersion, deterministic testing.
10. `integration/retry_lifecycle.test.ts` (1 test): Multi-attempt failure progression to DLQ.
11. `api/dlq.test.ts` (11 tests): DLQ listing, inspection, statistics, retry, archive, deletion.

---

### Method B: Interactive End-to-End PowerShell Script

Start the API server in Terminal 1:

```powershell
cd "d:\Job Scheduler"
npm run dev --prefix backend/api
```

Execute the full interactive verification script in Terminal 2:

```powershell
$baseUrl = "http://localhost:3000/api/v1"
$time = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

Write-Host "=== 1. Registering User ===" -ForegroundColor Cyan
$regRes = Invoke-RestMethod "$baseUrl/auth/register" -Method POST -ContentType "application/json" -Body (@{
    name = "Platform Admin"
    email = "admin_$time@example.com"
    password = "password123"
} | ConvertTo-Json)
$token = $regRes.data.token
$headers = @{ Authorization = "Bearer $token" }
Write-Host "User registered: $($regRes.data.user.email)" -ForegroundColor Green

Write-Host "`n=== 2. Creating Organization & Project ===" -ForegroundColor Cyan
$orgRes = Invoke-RestMethod "$baseUrl/orgs" -Method POST -Headers $headers -ContentType "application/json" -Body (@{
    name = "Enterprise Org"
    slug = "enterprise-org-$time"
} | ConvertTo-Json)
$orgId = $orgRes.data.organization.id

$projRes = Invoke-RestMethod "$baseUrl/projects" -Method POST -Headers $headers -ContentType "application/json" -Body (@{
    organizationId = $orgId
    name = "Production Core"
    slug = "prod-core-$time"
} | ConvertTo-Json)
$projId = $projRes.data.project.id
Write-Host "Project created ID: $projId" -ForegroundColor Green

Write-Host "`n=== 3. Creating Queue ===" -ForegroundColor Cyan
$queueRes = Invoke-RestMethod "$baseUrl/queues" -Method POST -Headers $headers -ContentType "application/json" -Body (@{
    projectId = $projId
    name = "payment-queue-$time"
    priority = 5
    concurrencyLimit = 10
    dlqEnabled = $true
} | ConvertTo-Json)
$queueId = $queueRes.data.queue.id
Write-Host "Queue created ID: $queueId" -ForegroundColor Green

Write-Host "`n=== 4. Submitting Immediate Job ===" -ForegroundColor Cyan
$immJobRes = Invoke-RestMethod "$baseUrl/queues/$queueId/jobs" -Method POST -Headers $headers -ContentType "application/json" -Body (@{
    name = "charge-credit-card"
    type = "immediate"
    payload = @{ amount = 99.99; currency = "USD" }
    priority = 8
} | ConvertTo-Json)
$jobId = $immJobRes.data.job.id
Write-Host "Job Submitted ID: $jobId, Status: $($immJobRes.data.job.status)" -ForegroundColor Green

Write-Host "`n=== 5. Submitting Batch Jobs ===" -ForegroundColor Cyan
$batchBody = @{
    name = "batch-invoices"
    jobs = @(
        @{ name = "inv-1"; payload = @{ id = 101 } },
        @{ name = "inv-2"; payload = @{ id = 102 } }
    )
} | ConvertTo-Json -Depth 5
$batchRes = Invoke-RestMethod "$baseUrl/queues/$queueId/batch" -Method POST -Headers $headers -ContentType "application/json" -Body $batchBody
Write-Host "Batch created: $($batchRes.data.totalJobs) jobs in group $($batchRes.data.batchGroupId)" -ForegroundColor Green

Write-Host "`n=== 6. Querying Dead Letter Queue (DLQ) Stats ===" -ForegroundColor Cyan
$dlqStats = Invoke-RestMethod "$baseUrl/dlq/stats" -Method GET -Headers $headers
Write-Host "DLQ Total Jobs: $($dlqStats.data.totalDlqJobs), Unhandled: $($dlqStats.data.unhandledCount)" -ForegroundColor Green

Write-Host "`n=== 7. Fetching Full Job History Audit Trail ===" -ForegroundColor Cyan
$history = Invoke-RestMethod "$baseUrl/jobs/$jobId/history" -Method GET -Headers $headers
Write-Host "Job History retrieved for '$($history.data.job.name)' (Status: $($history.data.job.status))" -ForegroundColor Green
```
