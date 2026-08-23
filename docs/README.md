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
| **10** | [**10. System Overview & Verification Playbook**](10_system_overview_and_verification.md) | Master architectural topology, complete REST API endpoints catalog, environment variables reference, PowerShell interactive verification script, and automated test runbook (107 tests). |
| **11** | [**11. Scheduler Service Engine**](11_scheduler_service.md) | Time-based job promotions (`SCHEDULED` $\rightarrow$ `QUEUED`), recurring cron dispatcher, `skip_if_running` overlap protection, multi-instance concurrency safety, and missed schedule recovery. |

---

## Quick Verification Commands

### Run Full Test Suite (107 Tests Across 12 Suites)
```powershell
cd "d:\Job Scheduler\tests"
npx vitest run --reporter=verbose
```

### Start Backend API Server
```powershell
cd "d:\Job Scheduler"
npm run dev --prefix backend/api
```

### Start Scheduler Service Node
```powershell
cd "d:\Job Scheduler"
npm run dev --prefix backend/scheduler
```

### Start Worker Service Node
```powershell
cd "d:\Job Scheduler"
npm run dev --prefix backend/worker
```

### Start Frontend Dashboard
```powershell
cd "d:\Job Scheduler"
npm run dev --prefix frontend
```
