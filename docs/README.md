# Distributed Job Scheduler Documentation

Welcome to the comprehensive technical documentation for the **Distributed Job Scheduler** platform.

This directory contains the detailed guides, architectural specifications, database schemas, and verification runbooks covering all components of the system.

---

## Documentation Index

| Step | Document | Key Topics Covered |
| :---: | :--- | :--- |
| **01** | [**01. Database Architecture & Relational Schema**](01_database_architecture.md) | PostgreSQL 17 normalized schema, 13 core tables, constraints, cascading rules, and high-performance partial/composite indexes. |
| **02** | [**02. Authentication & Authorization Module**](02_auth_and_authorization.md) | User registration, login, logout, password hashing (Argon2id/Bcrypt), JWT access tokens, rate limiting, and RBAC hierarchy (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`). |
| **03** | [**03. Organization & Project Management**](03_organizations_and_projects.md) | Multi-tenant isolation boundaries, organization lifecycle, project CRUD, member management, pagination, and safe deletion guards. |
| **04** | [**04. Queue Management System**](04_queue_management.md) | Multi-queue management, priority levels, concurrency limits, pause/resume workflows, and real-time status counter aggregation. |
| **05** | [**05. Job Domain Model & Lifecycle (FSM)**](05_job_domain_and_lifecycle.md) | 5 job types (Immediate, Delayed, Scheduled, Recurring cron, Batch), 8 lifecycle states, Finite State Machine transition matrix, execution attempt history, and log streaming. |
| **06** | [**06. Distributed Atomic Job-Claiming Mechanism**](06_distributed_job_claiming.md) | High-concurrency claiming using PostgreSQL `SELECT ... FOR UPDATE SKIP LOCKED`, priority-based FIFO seeking, queue concurrency limits, paused queue isolation, and rollback safety. |
| **07** | [**07. Distributed Worker Service Engine**](07_worker_service.md) | Worker process lifecycle (`register`, `heartbeat`, `poll`, `execute`, `drain`, `deregister`), concurrency slot calculation, extensible `JobHandlerRegistry`, timeouts, and graceful shutdown. |
| **08** | [**08. Retry Policy System & Backoff Engine**](08_retry_policy_system.md) | Mathematical backoff models (Fixed delay, Linear backoff, Exponential backoff), retry storm prevention via randomized full jitter, ceiling capping, and deterministic test calculation. |
| **09** | [**09. Dead Letter Queue (DLQ) & Quarantine**](09_dead_letter_queue.md) | Quarantining exhausted jobs, retained metadata snapshots, list, inspect with full logs, re-queue/retry, archive, delete, and dashboard-ready statistics. |
| **10** | [**10. System Overview & Verification Playbook**](10_system_overview_and_verification.md) | Master architectural topology, complete REST API endpoints catalog, environment variables reference, PowerShell interactive verification script, and automated test runbook (129 tests). |
| **11** | [**11. Scheduler Service Engine**](11_scheduler_service.md) | Time-based job promotions (`SCHEDULED` $\rightarrow$ `QUEUED`), recurring cron dispatcher, `skip_if_running` overlap protection, multi-instance concurrency safety, and missed schedule recovery. |
| **12** | [**12. Worker Heartbeat Monitoring & Reliability**](12_worker_heartbeat_monitoring.md) | Worker state lifecycle (`ONLINE`, `BUSY`, `UNHEALTHY`, `STOPPED`), heartbeat endpoints, stale worker detection, and execution reliability trade-off design for orphaned jobs. |
| **13** | [**13. REST API Standards & OpenAPI Spec**](13_api_standards_and_openapi.md) | Standardized URL naming, request correlation IDs (`X-Request-Id`), error envelopes, OpenAPI 3.0.3 specification, and Swagger UI interactive docs (`/api/v1/docs`). |
| **14** | [**14. Production Observability & Metrics**](14_production_observability_and_metrics.md) | Structured JSON logging with correlation IDs (`requestId`, `jobId`, `workerId`, `queueId`), latency percentiles (p50/p95/p99), worker health, queue depths, and Prometheus exposition (`/api/v1/metrics/prometheus`). |
| **15** | [**15. React Dashboard & Operations Console**](15_react_dashboard_application.md) | 11 production pages, live metrics polling (5s), latency charts, queue configuration, jobs explorer, worker telemetry, and DLQ management. |
| **UI** | [**Web UI Step-by-Step User Guide (`uiguide.md`)**](../uiguide.md) | Complete beginner-friendly visual guide teaching new users how to navigate and operate every screen. |
| **Err**| [**Errors & Troubleshooting Guide (`errors.md`)**](../errors.md) | Complete reference of all possible errors, root causes, and fixes categorized by priority. |
| **All**| [**Complete Run & Operations Runbook (`run.md`)**](../run.md) | Full commands to run environment, all services, Docker compose, test suites, and feature verification. |

---

## Quick Verification Commands

### Run Full Test Suite (129 Tests Across 15 Suites)
```powershell
cd "d:\Job Scheduler\tests"
npx vitest run --reporter=verbose
```

### Start Backend API Server
```powershell
cd "d:\Job Scheduler"
npm run dev --prefix backend/api
```

### Start Frontend Dashboard
```powershell
cd "d:\Job Scheduler\frontend"
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.
