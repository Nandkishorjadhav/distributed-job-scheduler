# Distributed Job Scheduler

A production-inspired, multi-tenant platform for scheduling and executing
asynchronous background jobs across a distributed group of workers.

The project demonstrates how a job processing system can combine an HTTP API,
durable storage, distributed coordination, and horizontally scalable workers
while remaining observable and resilient to failures.

## Core Concepts

- **Jobs** represent units of asynchronous work and may run immediately, after
  a delay, on a recurring schedule, or as part of a batch.
- **Queues** organize jobs and provide control over processing, including pause,
  resume, retry, and dead-letter handling.
- **Workers** claim available jobs and execute them concurrently. They are
  stateless, so additional instances can be added to increase throughput.
- **The scheduler** promotes delayed jobs, evaluates recurring job definitions,
  and coordinates scheduling work through leader election.
- **Organizations and projects** provide tenant and resource boundaries for
  users, queues, jobs, and metrics.

## Architecture

```text
                         React Dashboard
                                |
                         REST API (Express)
                           /            \\
                          /              \\
                 PostgreSQL              Redis
                durable state       locks and events
                          \\              /
                           \\            /
                    Scheduler and Workers
```

### API service

The API is the main entry point for clients. It handles authentication,
authorization, tenant-aware resource management, job submission, queue
controls, and access to execution status and metrics.

### PostgreSQL

PostgreSQL is the durable source of truth for organizations, projects, queues,
jobs, workers, schedules, execution state, and related metadata. Keeping job
state in a relational database makes transitions and ownership changes
transactional and queryable.

### Redis

Redis provides coordination that should not be implemented through application
process memory. It is used for scheduler leader-election locks and for
publishing real-time events to interested consumers such as the dashboard.

### Scheduler

The scheduler discovers work that has become eligible, including delayed and
recurring jobs. Leader election ensures that only one scheduler instance
performs scheduling duties at a time, preventing duplicate promotion of the
same scheduled work.

### Workers

Workers continuously look for executable jobs, claim them, and report their
progress. A worker heartbeat makes worker liveness visible, while concurrency
limits prevent one process from consuming unlimited resources.

## Job Lifecycle

1. A client submits a job to a queue through the API.
2. The job is stored with its scheduling information and an initial state.
3. The scheduler makes delayed or recurring work available when its schedule
   is due.
4. A worker atomically claims an available job so competing workers cannot
   execute the same job at the same time.
5. The worker records success or failure and emits relevant state changes.
6. Failed jobs can be retried according to queue policy or moved to a dead-letter queue for inspection and later reprocessing.

## Role-Based Access Control (RBAC) Matrix

The system implements a 4-tier hierarchy: `OWNER (4) > ADMIN (3) > MEMBER (2) > VIEWER (1)`.

| Action / Capability | Minimum Required Role | Allowed Roles | Description |
| :--- | :---: | :--- | :--- |
| **Create Organization** | *Authenticated User* | All registered users | Any authenticated user can create an Organization and becomes its **`OWNER`**. |
| **Delete Organization** | **`OWNER`** | `OWNER` | Permanent deletion of the tenant boundary and all child resources. |
| **Manage Org Members** | **`ADMIN`** | `OWNER`, `ADMIN` | Invite users, remove members, or adjust member roles. |
| **Create Project** | **`ADMIN`** | `OWNER`, `ADMIN` | Create a new project within the organization. |
| **Delete Project** | **`ADMIN`** | `OWNER`, `ADMIN` | Delete empty projects (blocked if active queues exist). |
| **Create Queue** | **`ADMIN`** | `OWNER`, `ADMIN` | Create new queues with priority, concurrency limits, and retry policies. |
| **Configure Queue Settings** | **`ADMIN`** | `OWNER`, `ADMIN` | Edit concurrency limits, priority, retry backoff strategies, or DLQ toggles. |
| **Pause / Resume Queue** | **`ADMIN`** | `OWNER`, `ADMIN` | Temporarily halt or restart job claiming on a queue. |
| **Delete Queue** | **`ADMIN`** | `OWNER`, `ADMIN` | Safe deletion of queues with no running in-flight jobs. |
| **Submit Job** | **`MEMBER`** | `OWNER`, `ADMIN`, `MEMBER` | Enqueue immediate, delayed, scheduled, recurring cron, or batch jobs. |
| **Retry / Cancel Job** | **`MEMBER`** | `OWNER`, `ADMIN`, `MEMBER` | Re-queue failed/dead jobs or cancel pending/scheduled jobs. |
| **Manage DLQ (Retry/Archive/Delete)** | **`ADMIN`** | `OWNER`, `ADMIN` | Quarantine maintenance and dead job re-queuing. |
| **View Jobs & Execution History** | **`VIEWER`** | `OWNER`, `ADMIN`, `MEMBER`, `VIEWER` | Inspect job payloads, statuses, attempt breakdowns, and execution log streams. |
| **View Queues & Telemetry** | **`VIEWER`** | `OWNER`, `ADMIN`, `MEMBER`, `VIEWER` | Read-only access to queue depths, worker status, and system metrics. |

## Reliability and Scaling

- PostgreSQL transactions protect state transitions and preserve a durable
  history of job ownership and status.
- `SELECT ... FOR UPDATE SKIP LOCKED` supports safe concurrent job claiming
  without forcing workers to wait on jobs already being processed.
- Redis locks provide distributed scheduler coordination.
- Worker heartbeats help identify unavailable processes.
- Retry policies and dead-letter queues prevent transient failures from
  silently losing work.
- Stateless workers can be scaled horizontally without changing the job model.
- Queue and project metrics expose throughput, latency, failures, and worker
  activity for operational visibility.

## Repository Structure

```text
packages/shared/       Shared types, enums, and validation schemas
backend/shared/        Database, Redis, logging, and repository infrastructure
backend/api/           Express REST API and request middleware
backend/scheduler/     Delayed and recurring job scheduling
backend/worker/        Job claiming, execution, and worker heartbeats
frontend/              React and Vite dashboard
database/              SQL migrations and development seed data
tests/                 Unit and integration tests
docs/                  Database and architecture documentation
```

## Technology

- **TypeScript** for shared contracts and service implementation
- **Node.js and Express** for the API and backend services
- **PostgreSQL** for durable relational state
- **Redis** for distributed locks and event publication
- **React and Vite** for the dashboard
- **Docker Compose** for local infrastructure and service orchestration
- **Vitest** for automated testing

## Further Documentation

- **Master Documentation Index**: [docs/README.md](docs/README.md)
- **Errors & Troubleshooting Guide**: [errors.md](errors.md)
- **Web UI Step-by-Step User Guide**: [uiguide.md](uiguide.md)
- **Complete Run & Operations Runbook**: [run.md](run.md)
- **Database Architecture**: [docs/01_database_architecture.md](docs/01_database_architecture.md)
- **Authentication & RBAC**: [docs/02_auth_and_authorization.md](docs/02_auth_and_authorization.md)
- **Organization & Project Management**: [docs/03_organizations_and_projects.md](docs/03_organizations_and_projects.md)
- **Queue Management**: [docs/04_queue_management.md](docs/04_queue_management.md)
- **Job Domain Model & Lifecycle**: [docs/05_job_domain_and_lifecycle.md](docs/05_job_domain_and_lifecycle.md)
- **Distributed Atomic Job Claiming**: [docs/06_distributed_job_claiming.md](docs/06_distributed_job_claiming.md)
- **Worker Service Engine**: [docs/07_worker_service.md](docs/07_worker_service.md)
- **Retry Policy System**: [docs/08_retry_policy_system.md](docs/08_retry_policy_system.md)
- **Dead Letter Queue (DLQ)**: [docs/09_dead_letter_queue.md](docs/09_dead_letter_queue.md)
- **System Overview & Verification Playbook**: [docs/10_system_overview_and_verification.md](docs/10_system_overview_and_verification.md)
- **Scheduler Service Engine**: [docs/11_scheduler_service.md](docs/11_scheduler_service.md)
- **Worker Heartbeat Monitoring**: [docs/12_worker_heartbeat_monitoring.md](docs/12_worker_heartbeat_monitoring.md)
- **REST API Standards & OpenAPI Specification**: [docs/13_api_standards_and_openapi.md](docs/13_api_standards_and_openapi.md)
- **Production Observability & Metrics**: [docs/14_production_observability_and_metrics.md](docs/14_production_observability_and_metrics.md)
- **React Operations Dashboard**: [docs/15_react_dashboard_application.md](docs/15_react_dashboard_application.md)


