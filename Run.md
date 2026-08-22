# 🚀 Distributed Job Scheduler

A production-inspired distributed job scheduling platform designed to reliably execute asynchronous background jobs across multiple workers.

The project demonstrates backend engineering concepts including:

* REST API design
* PostgreSQL database management
* Redis-based coordination
* Distributed job scheduling
* Worker processes
* Concurrency
* Job queues
* Authentication
* Reliability and fault tolerance
* Full-stack integration
* Automated testing

---

## 🏗️ Architecture

```text
                    ┌─────────────────────┐
                    │      Frontend       │
                    │   React + Vite      │
                    │   Port: 5173        │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │       API Server    │
                    │    Node.js/Express  │
                    │      Port: 3000     │
                    └───────┬───────┬─────┘
                            │       │
                ┌───────────┘       └────────────┐
                ▼                                ▼
       ┌─────────────────┐              ┌─────────────────┐
       │   PostgreSQL    │              │      Redis      │
       │   Port: 5432    │              │    Port: 6379   │
       └────────┬────────┘              └────────┬────────┘
                │                                │
                └──────────────┬─────────────────┘
                               │
                ┌──────────────┴──────────────┐
                │                             │
                ▼                             ▼
       ┌─────────────────┐           ┌─────────────────┐
       │    Scheduler    │           │     Workers     │
       │  Polls for Jobs │           │ Execute Jobs    │
       └─────────────────┘           └─────────────────┘
```

---

# 📋 Prerequisites

Make sure the following are installed before starting:

* [Docker Desktop](https://www.docker.com/products/docker-desktop/)
* Node.js
* npm
* Git
* PowerShell

Verify Node.js and npm:

```powershell
node --version
npm --version
```

Verify Docker:

```powershell
docker --version
docker-compose --version
```

---

# 🚀 Getting Started

Follow the steps below to start the complete project.

---

## 🐳 Step 1 — Start Docker Desktop

Open **Docker Desktop** from the Windows Start menu.

Wait until Docker shows:

```text
Engine running
```

Once Docker is running, open a new PowerShell terminal.

---

## 🗄️ Step 2 — Start PostgreSQL and Redis

Open **Terminal 1**.

Navigate to the project directory:

```powershell
cd "d:\Job Scheduler"
```

Start PostgreSQL and Redis:

```powershell
docker-compose up -d postgres redis
```

Wait approximately 10–15 seconds.

Then verify the containers:

```powershell
docker-compose ps
```

You should see containers similar to:

```text
js_postgres
js_redis
```

Both services should show a healthy/running status.

---

# 🗄️ Step 3 — Initialize the Database

### First-time setup

If PostgreSQL was created fresh, the database initialization script should run automatically because the migration is mounted into:

```text
/docker-entrypoint-initdb.d/
```

The schema file is:

```text
001_initial_schema.sql
```

If you need to manually execute the schema, run:

```powershell
docker exec -i js_postgres psql -U postgres -d job_scheduler -f /docker-entrypoint-initdb.d/001_initial_schema.sql
```

You can verify that PostgreSQL is working with:

```powershell
docker exec js_postgres psql -U postgres -d job_scheduler -c "\copy (SELECT 1) TO STDOUT"
```

> **Note:** You normally do not need to run the migration manually when PostgreSQL is started for the first time with Docker Compose.

---

# ⚙️ Step 4 — Configure Environment Variables

For the first setup, copy the example environment file:

```powershell
cd "d:\Job Scheduler"
```

```powershell
Copy-Item .env.example .env
```

You can modify `.env` later if required.

---

# 🚀 Step 5 — Start the API Server

Open **Terminal 2**.

Navigate to the API directory:

```powershell
cd "d:\Job Scheduler\backend\api"
```

Set the development environment variables:

```powershell
$env:NODE_ENV="development"
$env:DATABASE_URL="postgresql://postgres:password@localhost:5432/job_scheduler"
$env:REDIS_URL="redis://localhost:6379"
$env:JWT_SECRET="dev-secret-key-change-this-in-production-32chars"
$env:API_PORT="3000"
$env:CORS_ORIGINS="http://localhost:5173"
```

Start the API:

```powershell
npm run dev
```

Expected output:

```text
[INFO] PostgreSQL connection verified
[INFO] Redis connected
[INFO] API service listening on http://0.0.0.0:3000
```

---

## 🩺 Test the API

Open another terminal and run:

```powershell
curl http://localhost:3000/api/v1/health
```

Expected response:

```json
{
  "status": "ok",
  "timestamp": "..."
}
```

If you receive this response, the API is running successfully.

---

# 📅 Step 6 — Start the Scheduler

Open **Terminal 3**.

Navigate to the scheduler:

```powershell
cd "d:\Job Scheduler\backend\scheduler"
```

Set the environment variables:

```powershell
$env:NODE_ENV="development"
$env:DATABASE_URL="postgresql://postgres:password@localhost:5432/job_scheduler"
$env:REDIS_URL="redis://localhost:6379"
$env:SCHEDULER_POLL_INTERVAL_MS="5000"
$env:SCHEDULER_CRON_INTERVAL_MS="60000"
```

Start the scheduler:

```powershell
npm run dev
```

Expected output:

```text
[INFO] Scheduler service starting...
[INFO] PostgreSQL connection verified
[INFO] Redis connected
[INFO] Scheduler service running (stubs — business logic pending)
```

> **Note:** The scheduler currently contains stub business logic. Actual job scheduling functionality can be implemented on top of this service.

---

# 👷 Step 7 — Start the Worker

Open **Terminal 4**.

Navigate to the worker:

```powershell
cd "d:\Job Scheduler\backend\worker"
```

Set the environment variables:

```powershell
$env:NODE_ENV="development"
$env:DATABASE_URL="postgresql://postgres:password@localhost:5432/job_scheduler"
$env:REDIS_URL="redis://localhost:6379"
$env:WORKER_CONCURRENCY="5"
$env:WORKER_HEARTBEAT_INTERVAL_MS="10000"
$env:WORKER_POLL_INTERVAL_MS="1000"
```

Start the worker:

```powershell
npm run dev
```

Expected output:

```text
[INFO] Worker service starting...
[INFO] Host: <hostname> | PID: <pid> | Concurrency: 5
[INFO] PostgreSQL connection verified
[INFO] Redis connected
[INFO] Worker service running (stubs — business logic pending)
```

### Worker Configuration

| Variable                       |   Value | Purpose                   |
| ------------------------------ | ------: | ------------------------- |
| `WORKER_CONCURRENCY`           |     `5` | Maximum concurrent jobs   |
| `WORKER_HEARTBEAT_INTERVAL_MS` | `10000` | Worker heartbeat interval |
| `WORKER_POLL_INTERVAL_MS`      |  `1000` | Job polling interval      |

---

# 🌐 Step 8 — Start the Frontend

Open **Terminal 5**.

Navigate to the frontend:

```powershell
cd "d:\Job Scheduler\frontend"
```

Set the API URL:

```powershell
$env:VITE_API_URL="http://localhost:3000/api/v1"
```

Start the frontend:

```powershell
npm run dev
```

Expected output:

```text
VITE v5.x.x ready in 300ms

➜ Local:   http://localhost:5173/
➜ Network: http://192.168.x.x:5173/
```

Open the application in your browser:

**http://localhost:5173**

You should see the:

```text
Distributed Job Scheduler
```

frontend application.

---

# 🧪 Step 9 — Run Tests

Open **Terminal 6**.

Navigate to the tests directory:

```powershell
cd "d:\Job Scheduler\tests"
```

Run the test suite:

```powershell
npx vitest run --reporter=verbose
```

Expected output:

```text
✓ shared/enums.test.ts
  ✓ JobStatus has all expected values

✓ shared/enums.test.ts
  ✓ QueueStatus has expected values

✓ shared/enums.test.ts
  ✓ WorkerStatus has expected values

✓ api/health.test.ts
  ✓ GET /api/v1/health returns 200 with status ok

✓ api/health.test.ts
  ✓ Route and auth behaviour returns 401

✓ api/health.test.ts
  ✓ Route and auth behaviour returns 404

Test Files  2 passed
Tests       6 passed
```

---

# 🔌 Ports

| Service    | Port / URL              | Started By |
| ---------- | ----------------------- | ---------- |
| PostgreSQL | `localhost:5432`        | Docker     |
| Redis      | `localhost:6379`        | Docker     |
| API Server | `http://localhost:3000` | Terminal 2 |
| Scheduler  | No HTTP port            | Terminal 3 |
| Worker     | No HTTP port            | Terminal 4 |
| Frontend   | `http://localhost:5173` | Terminal 5 |

---

# 🔗 API Endpoints

## Health Check

```http
GET /api/v1/health
```

PowerShell:

```powershell
curl http://localhost:3000/api/v1/health
```

Expected:

```json
{
  "status": "ok",
  "timestamp": "..."
}
```

---

## Login

```http
POST /api/v1/auth/login
```

Example:

```powershell
curl -X POST http://localhost:3000/api/v1/auth/login `
  -H "Content-Type: application/json" `
  -d '{"email":"test@test.com","password":"pass"}'
```

> Currently returns `501 Not Implemented` because authentication business logic is still a stub.

---

## Protected Queue Route

```http
GET /api/v1/queues
```

Example:

```powershell
curl http://localhost:3000/api/v1/queues
```

Without an authentication token, the expected response is:

```text
401 Unauthorized
```

This confirms that the authentication middleware is working.

---

# 🛑 Stopping the Project

Stop the frontend, API, scheduler, and worker by pressing:

```text
Ctrl + C
```

in their respective terminals.

Stop PostgreSQL and Redis:

```powershell
cd "d:\Job Scheduler"
docker-compose down
```

---

# 🔄 Restarting the Project

After the initial setup, you normally only need to:

### 1. Start Docker

```powershell
docker-compose up -d postgres redis
```

### 2. Start API

```powershell
cd "d:\Job Scheduler\backend\api"
npm run dev
```

### 3. Start Scheduler

```powershell
cd "d:\Job Scheduler\backend\scheduler"
npm run dev
```

### 4. Start Worker

```powershell
cd "d:\Job Scheduler\backend\worker"
npm run dev
```

### 5. Start Frontend

```powershell
cd "d:\Job Scheduler\frontend"
npm run dev
```

---

# 🧩 Troubleshooting

## Docker is not running

If you see an error such as:

```text
Cannot connect to the Docker daemon
```

Open Docker Desktop and wait until:

```text
Engine running
```

Then retry:

```powershell
docker-compose up -d postgres redis
```

---

## PostgreSQL connection failed

Check the PostgreSQL container:

```powershell
docker-compose ps
```

Check PostgreSQL logs:

```powershell
docker logs js_postgres
```

---

## Redis connection failed

Check Redis:

```powershell
docker logs js_redis
```

You can also verify the container:

```powershell
docker-compose ps
```

---

## Port 3000 already in use

Check which process is using port 3000:

```powershell
netstat -ano | findstr :3000
```

You can either stop the process or change:

```powershell
$env:API_PORT="3001"
```

---

## Frontend cannot connect to API

Verify the API is running:

```powershell
curl http://localhost:3000/api/v1/health
```

Then verify:

```powershell
$env:VITE_API_URL="http://localhost:3000/api/v1"
```

Restart the frontend after changing environment variables.

---

# 📁 Project Structure

```text
Job Scheduler/
│
├── backend/
│   ├── api/
│   │   ├── src/
│   │   ├── package.json
│   │   └── ...
│   │
│   ├── scheduler/
│   │   ├── src/
│   │   ├── package.json
│   │   └── ...
│   │
│   └── worker/
│       ├── src/
│       ├── package.json
│       └── ...
│
├── frontend/
│   ├── src/
│   ├── package.json
│   └── ...
│
├── tests/
│   ├── api/
│   ├── shared/
│   └── ...
│
├── docker-compose.yml
├── .env.example
├── .env
└── README.md
```

---

# 🔐 Environment Variables

| Variable                       | Description                        |
| ------------------------------ | ---------------------------------- |
| `NODE_ENV`                     | Application environment            |
| `DATABASE_URL`                 | PostgreSQL connection URL          |
| `REDIS_URL`                    | Redis connection URL               |
| `JWT_SECRET`                   | Secret used for JWT authentication |
| `API_PORT`                     | API server port                    |
| `CORS_ORIGINS`                 | Allowed frontend origins           |
| `SCHEDULER_POLL_INTERVAL_MS`   | Scheduler polling interval         |
| `SCHEDULER_CRON_INTERVAL_MS`   | Scheduler cron interval            |
| `WORKER_CONCURRENCY`           | Number of concurrent jobs          |
| `WORKER_HEARTBEAT_INTERVAL_MS` | Worker heartbeat interval          |
| `WORKER_POLL_INTERVAL_MS`      | Worker polling interval            |
| `VITE_API_URL`                 | Frontend API base URL              |

> ⚠️ **Never commit `.env` or production secrets to GitHub.** Use `.env.example` for safe configuration examples.

---

# 🧪 Current Project Status

| Component                 | Status               |
| ------------------------- | -------------------- |
| PostgreSQL                | ✅ Running            |
| Redis                     | ✅ Running            |
| API Server                | ✅ Running            |
| Health API                | ✅ Implemented        |
| Authentication Routes     | 🟡 Stub              |
| Scheduler                 | 🟡 Stub              |
| Worker                    | 🟡 Stub              |
| Frontend                  | 🟡 Placeholder       |
| Automated Tests           | ✅ Passing            |
| Distributed Job Execution | 🚧 To be implemented |

---

# 🎯 Future Implementation

The next development phase can include:

1. User registration and authentication
2. Queue creation and management
3. Job creation API
4. Job priority
5. Delayed jobs
6. Scheduled jobs
7. Recurring jobs
8. Redis-based job queue
9. Worker job claiming
10. Concurrent job execution
11. Job retry mechanism
12. Exponential backoff
13. Job timeout handling
14. Dead-letter queues
15. Worker heartbeats
16. Worker failure detection
17. Job status tracking
18. Scheduler persistence
19. Monitoring dashboard
20. Production deployment

---

# 📜 License

This project is developed for educational and engineering evaluation purposes.
