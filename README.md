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
6. Failed jobs can be retried according to queue policy or moved to a
   dead-letter queue for inspection and later reprocessing.

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

For local setup and execution instructions, see [Run.md](Run.md). Database
details are documented in [docs/database.md](docs/database.md).
