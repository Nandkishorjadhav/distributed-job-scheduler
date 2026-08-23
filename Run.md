# Distributed Job Scheduler — Complete Execution & Operations Runbook (`run.md`)

This guide provides the complete set of commands and environment configurations needed to run, scale, test, and manage all features of the **Distributed Job Scheduler** platform.

---

## 1. System Architecture Overview

The system consists of four primary runtime components:

```
                           ┌─────────────────────────────────────────┐
                           │   React Operations Dashboard (Vite UI)  │
                           │         http://localhost:5173           │
                           └────────────────────┬────────────────────┘
                                                │ REST API (X-Request-Id)
                                                ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              Express REST API Gateway                                  │
│                      http://localhost:3000 · OpenAPI 3.0.3 Spec                        │
└───────────────────┬─────────────────────────────────────────────────┬──────────────────┘
                    │                                                 │
                    ▼                                                 ▼
┌───────────────────────────────────────┐         ┌───────────────────────────────────────┐
│        Scheduler Service Engine       │         │        Distributed Worker Engine      │
│  - Delayed Job Promotion              │         │  - Atomic Job Claiming (SKIP LOCKED)  │
│  - Scheduled Time Triggers            │         │  - Handler Execution & Heartbeats     │
│  - Recurring Cron Parser              │         │  - Exponential Backoff & DLQ Movement │
└───────────────────┬───────────────────┘         └───────────────────┬───────────────────┘
                    │                                                 │
                    ▼                                                 ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        PostgreSQL 17 Primary Database Cluster                          │
│                Relational State, Row-Level Locks, Time-Series Heartbeats               │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Prerequisites & Environment Requirements

| Dependency | Minimum Version | Default Port | Description |
| :--- | :--- | :--- | :--- |
| **Node.js** | `v20.0.0+` (LTS) | — | JavaScript/TypeScript runtime |
| **npm** | `v10.0.0+` | — | Package manager & monorepo orchestration |
| **PostgreSQL**| `v16.0+` (17 recommended)| `5432` | Relational storage & row-level locking (`SKIP LOCKED`) |
| **Redis** *(Optional)* | `v7.0+` | `6379` | Fast caching & distributed pub/sub |
| **Docker** *(Optional)*| `v24.0+` | — | Containerized multi-service deployment |

---

## 3. Environment Configuration (`.env`)

A default `.env` file is located at the project root. You can customize the variables below as needed:

```bash
# Node Environment
NODE_ENV=development

# Database Configuration (PostgreSQL)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=job_scheduler
DB_USER=postgres
DB_PASSWORD=password
DB_POOL_MIN=2
DB_POOL_MAX=20

# Redis Cache & Pub/Sub
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# Backend REST API
API_PORT=3000
API_HOST=0.0.0.0
CORS_ORIGIN=http://localhost:5173

# JWT Authentication
JWT_SECRET=dev_secret_key_change_in_production_at_least_32_chars_long
JWT_EXPIRES_IN=7d
BCRYPT_ROUNDS=12

# Scheduler Engine
SCHEDULER_POLL_INTERVAL_MS=1000
SCHEDULER_BATCH_SIZE=100

# Worker Service
WORKER_CONCURRENCY=5
WORKER_POLL_INTERVAL_MS=500
WORKER_HEARTBEAT_INTERVAL_MS=5000
WORKER_STALE_THRESHOLD_SECONDS=30

# Observability & Structured Logging
LOG_LEVEL=info
ENABLE_CORRELATION_LOGGING=true

# Frontend Dashboard
VITE_API_URL=http://localhost:3000/api/v1
```

---

## 4. Database Setup & Applying Migrations

Make sure your PostgreSQL instance is running on `localhost:5432`. Create the database if it doesn't already exist:

```sql
CREATE DATABASE job_scheduler;
```

Apply all 5 SQL migrations in chronological order:

### Option A: Using PostgreSQL Client (`psql`)
```powershell
psql -U postgres -d job_scheduler -f "d:\Job Scheduler\database\migrations\001_initial_schema.sql"
psql -U postgres -d job_scheduler -f "d:\Job Scheduler\database\migrations\002_complete_schema.sql"
psql -U postgres -d job_scheduler -f "d:\Job Scheduler\database\migrations\003_dlq_enhancements.sql"
psql -U postgres -d job_scheduler -f "d:\Job Scheduler\database\migrations\004_worker_heartbeat_states.sql"
psql -U postgres -d job_scheduler -f "d:\Job Scheduler\database\migrations\005_fix_batch_counts_trigger.sql"
```

### Option B: Using Node Script
```powershell
cd "d:\Job Scheduler\backend\shared"
node -e "
const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({ host: 'localhost', port: 5432, user: 'postgres', password: 'password', database: 'job_scheduler' });
async function run() {
  for (const f of ['001_initial_schema.sql','002_complete_schema.sql','003_dlq_enhancements.sql','004_worker_heartbeat_states.sql','005_fix_batch_counts_trigger.sql']) {
    const sql = fs.readFileSync('../../database/migrations/' + f, 'utf8');
    await pool.query(sql);
    console.log('Applied migration: ' + f);
  }
  pool.end();
}
run();"
```

---

## 5. Quick Start: Running Services Locally

Open **4 separate PowerShell terminals** in `d:\Job Scheduler`:

### Terminal 1: Backend REST API Gateway
```powershell
cd "d:\Job Scheduler"
npm run dev --prefix backend/api
```
- **Listening on**: [http://localhost:3000](http://localhost:3000)
- **Interactive Swagger UI**: [http://localhost:3000/api/v1/docs](http://localhost:3000/api/v1/docs)
- **OpenAPI 3.0.3 Spec**: [http://localhost:3000/api/v1/openapi.json](http://localhost:3000/api/v1/openapi.json)

---

### Terminal 2: Distributed Scheduler Engine
```powershell
cd "d:\Job Scheduler"
npm run dev --prefix backend/scheduler
```
- Automatically promotes delayed jobs (`DELAYED` $\rightarrow$ `QUEUED`), triggers scheduled executions, and parses recurring cron expressions.

---

### Terminal 3: Distributed Worker Node
```powershell
cd "d:\Job Scheduler"
npm run dev --prefix backend/worker
```
- Registers worker node in database (`ONLINE`), polls eligible queues using `SELECT ... FOR UPDATE SKIP LOCKED`, executes job handlers, records heartbeats, and triggers exponential backoff retries or DLQ movements.

---

### Terminal 4: React Operations Dashboard
```powershell
cd "d:\Job Scheduler"
npm run dev --prefix frontend
```
- **Dashboard Web UI**: [http://localhost:5173](http://localhost:5173)

---

## 6. Running with Docker Compose

To spin up the entire cluster (PostgreSQL, Redis, API, Scheduler, Worker, and React Dashboard) inside Docker:

```powershell
# 1. Start all containers in the background
docker-compose up --build -d

# 2. Scale Worker nodes horizontally to 4 concurrent worker processes
docker-compose up --scale worker=4 -d

# 3. View live cluster logs
docker-compose logs -f

# 4. Stop and tear down cluster
docker-compose down
```

---

## 7. Running the Automated Test Suite

To run all **129 tests across all 15 test suites**:

```powershell
cd "d:\Job Scheduler\tests"
npx vitest run --reporter=verbose
```

### Verified Test Suites:
1. `shared/enums.test.ts` — Enum integrity and mapping tests
2. `api/health.test.ts` — API health check and route authentication guards
3. `api/auth.test.ts` — User registration, login, JWT validation, and RBAC
4. `api/orgs_projects.test.ts` — Multi-tenant organization and project management
5. `api/queues.test.ts` — Queue CRUD, priority, concurrency limits, and pause/resume
6. `api/jobs.test.ts` — Job domain model, batch dispatching, and state transitions
7. `concurrency/job_claiming.test.ts` — Atomic `SELECT FOR UPDATE SKIP LOCKED` verification
8. `worker/worker_lifecycle.test.ts` — Worker registration, heartbeats, and graceful draining
9. `domain/retry_policy.test.ts` — Fixed, linear, and exponential backoff calculations
10. `integration/retry_lifecycle.test.ts` — End-to-end failure backoff to DLQ progression
11. `api/dlq.test.ts` — Dead letter queue quarantine, inspect, retry, archive, and delete
12. `scheduler/scheduler.test.ts` — Delayed, scheduled, recurring cron, and overlap avoidance
13. `api/workers.test.ts` — Worker heartbeat monitoring, states, and stale detection
14. `api/api_standards.test.ts` — `X-Request-Id` correlation, OpenAPI spec, and error formats
15. `api/metrics_observability.test.ts` — Real-time telemetry, percentiles, and Prometheus export

---

## 8. Feature Walkthrough & API Verification Commands

### 1. Authentication (`/api/v1/auth`)

#### Register a New User:
```powershell
curl -X POST http://localhost:3000/api/v1/auth/register `
  -H "Content-Type: application/json" `
  -d '{"name": "Dev Admin", "email": "admin@example.com", "password": "Password123!"}'
```

#### Log In:
```powershell
$res = Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/v1/auth/login" `
  -ContentType "application/json" `
  -Body '{"email": "admin@example.com", "password": "Password123!"}'

$TOKEN = $res.data.token
Write-Host "JWT Token: $TOKEN"
```

---

### 2. Organizations & Projects (`/api/v1/orgs`, `/api/v1/projects`)

#### Create Organization:
```powershell
$org = Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/v1/orgs" `
  -Headers @{ Authorization = "Bearer $TOKEN" } `
  -ContentType "application/json" `
  -Body '{"name": "Acme Corp", "slug": "acme-corp"}'

$ORG_ID = $org.data.organization.id
```

#### Create Project:
```powershell
$proj = Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/v1/projects" `
  -Headers @{ Authorization = "Bearer $TOKEN" } `
  -ContentType "application/json" `
  -Body (@{ organizationId = $ORG_ID; name = "Payments System"; slug = "payments" } | ConvertTo-Json)

$PROJ_ID = $proj.data.project.id
```

---

### 3. Queues Management (`/api/v1/queues`)

#### Create a Queue with Exponential Backoff Retry Policy:
```powershell
$queueBody = @{
  projectId = $PROJ_ID
  name = "payouts-queue"
  priority = 8
  concurrencyLimit = 10
  dlqEnabled = $true
  retryPolicy = @{
    strategy = "exponential"
    maxAttempts = 3
    initialDelayMs = 1000
    maxDelayMs = 30000
    jitterMs = 500
  }
} | ConvertTo-Json

$queue = Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/v1/queues" `
  -Headers @{ Authorization = "Bearer $TOKEN" } `
  -ContentType "application/json" `
  -Body $queueBody

$QUEUE_ID = $queue.data.queue.id
```

#### Pause and Resume Queue:
```powershell
# Pause Queue
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/v1/queues/$QUEUE_ID/pause" `
  -Headers @{ Authorization = "Bearer $TOKEN" }

# Resume Queue
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/v1/queues/$QUEUE_ID/resume" `
  -Headers @{ Authorization = "Bearer $TOKEN" }
```

---

### 4. Job Submission & Workflows (`/api/v1/queues/:id/jobs`)

#### Submit Immediate Job:
```powershell
$jobBody = @{
  name = "process-payout-101"
  type = "immediate"
  priority = 8
  payload = @{ recipient = "user_456"; amount = 1500; currency = "USD" }
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/v1/queues/$QUEUE_ID/jobs" `
  -Headers @{ Authorization = "Bearer $TOKEN" } `
  -ContentType "application/json" `
  -Body $jobBody
```

#### Submit Delayed Job (Executes in 30 Seconds):
```powershell
$delayTime = (Get-Date).ToUniversalTime().AddSeconds(30).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$delayedBody = @{
  name = "delayed-invoice-send"
  type = "delayed"
  scheduledAt = $delayTime
  payload = @{ invoiceId = "INV-9988" }
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/v1/queues/$QUEUE_ID/jobs" `
  -Headers @{ Authorization = "Bearer $TOKEN" } `
  -ContentType "application/json" `
  -Body $delayedBody
```

#### Submit Batch of Jobs:
```powershell
$batchBody = @{
  name = "nightly-settlement-batch"
  jobs = @(
    @{ name = "task-1"; type = "immediate"; payload = @{ item = 1 } },
    @{ name = "task-2"; type = "immediate"; payload = @{ item = 2 } },
    @{ name = "task-3"; type = "immediate"; payload = @{ item = 3 } }
  )
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/v1/queues/$QUEUE_ID/batch" `
  -Headers @{ Authorization = "Bearer $TOKEN" } `
  -ContentType "application/json" `
  -Body $batchBody
```

---

### 5. Worker Telemetry & Stale Detection (`/api/v1/workers`)

#### List Registered Workers with Dynamic Health Status:
```powershell
Invoke-RestMethod -Method Get -Uri "http://localhost:3000/api/v1/workers" `
  -Headers @{ Authorization = "Bearer $TOKEN" }
```

#### Trigger Stale Worker Scanner:
```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/v1/workers/stale/scan?timeoutSeconds=30" `
  -Headers @{ Authorization = "Bearer $TOKEN" }
```

---

### 6. Dead Letter Queue (`/api/v1/dlq`)

#### Inspect DLQ Quarantined Jobs:
```powershell
Invoke-RestMethod -Method Get -Uri "http://localhost:3000/api/v1/dlq" `
  -Headers @{ Authorization = "Bearer $TOKEN" }
```

#### Re-queue (Retry) a Dead Job:
```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/v1/dlq/<DLQ_ID>/retry" `
  -Headers @{ Authorization = "Bearer $TOKEN" }
```

---

### 7. Observability & Metrics (`/api/v1/metrics`)

#### Fetch Live JSON Telemetry (Counters, Latency Percentiles, Queue Depths):
```powershell
Invoke-RestMethod -Method Get -Uri "http://localhost:3000/api/v1/metrics" `
  -Headers @{ Authorization = "Bearer $TOKEN" }
```

#### Fetch Prometheus Exposition Format:
```powershell
curl -X GET http://localhost:3000/api/v1/metrics/prometheus `
  -H "Authorization: Bearer $TOKEN"
```

---

## 9. Production Compilation & Packaging

To compile all packages for production deployment:

```powershell
cd "d:\Job Scheduler"

# Build all monorepo packages
npm run build:all

# Or build individual packages:
npm run build --prefix packages/shared
npm run build --prefix backend/shared
npm run build --prefix backend/api
npm run build --prefix backend/scheduler
npm run build --prefix backend/worker
npm run build --prefix frontend
```

---

## 10. Summary of Key URLs & Ports

| Resource | URL | Description |
| :--- | :--- | :--- |
| **React Dashboard** | [http://localhost:5173](http://localhost:5173) | Web operations console |
| **REST API Server** | [http://localhost:3000/api/v1](http://localhost:3000/api/v1) | Backend API root |
| **Interactive Swagger Docs** | [http://localhost:3000/api/v1/docs](http://localhost:3000/api/v1/docs) | Interactive API exploration |
| **OpenAPI Specification** | [http://localhost:3000/api/v1/openapi.json](http://localhost:3000/api/v1/openapi.json) | OpenAPI 3.0.3 JSON schema |
| **System Health Check** | [http://localhost:3000/api/v1/health](http://localhost:3000/api/v1/health) | Uptime & database status |
| **Prometheus Metrics** | [http://localhost:3000/api/v1/metrics/prometheus](http://localhost:3000/api/v1/metrics/prometheus) | Prometheus scrape endpoint |
