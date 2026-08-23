# Distributed Job Scheduler — Comprehensive Errors & Troubleshooting Playbook (`errors.md`)

This reference document catalogs all potential runtime, API, database, worker, and frontend errors across the **Distributed Job Scheduler** platform.

Errors are organized by **Priority** (from most frequently occurring during development to rare infrastructure edge cases), with exact **Root Causes**, **HTTP Status Codes**, and **Step-by-Step Fixes**.

---

## Error Priority Matrix

| Priority | Category | Typical Occurrence |
| :--- | :--- | :--- |
| **P1 — Critical / Frequent** | Authentication, RBAC, Slugs, Input Constraints | Daily development, first-time setup, database resets |
| **P2 — Operational & Lifecycle**| Job Claiming, Scheduler Engine, Stale Workers, DLQ | Runtime processing, worker crashes, paused queues |
| **P3 — Infrastructure & Network**| Database connectivity, Redis locks, Connection Pools | Local service startups, Docker Compose ports |
| **P4 — Edge Cases & Warnings** | React NaN warnings, 404 lookups, Cascading Deletions | UI input clearing, non-existent entity inspection |

---

## ─── Priority 1: Critical & Frequent Errors ───────────────────

### 1. `401 Unauthorized` / `SESSION_INVALID`
* **Error Message**: `"Session user does not exist in database. Please log in again."` or `"Authentication required"`
* **HTTP Code**: `401 Unauthorized`
* **Where It Occurs**: Any protected REST endpoint (`/api/v1/orgs`, `/api/v1/projects`, `/api/v1/queues`, `/api/v1/metrics`).
* **Root Cause**: 
  1. The database was reset or re-migrated, but your browser still holds an old JWT in `localStorage` with a deleted `userId`.
  2. The `access_token` expired or was signed with a different `JWT_SECRET`.
* **How to Fix**:
  1. Click **Sign Out** in the top-right user menu, or navigate to `/login`.
  2. Register a fresh account or log in with:
     * **Email**: `alice@example.com`
     * **Password**: `password123`
  3. Alternatively, clear `localStorage` via browser DevTools: `localStorage.clear()`.

---

### 2. `403 Forbidden` / `Access Restricted`
* **Error Message**: `"You do not have access to this organization"` or `"Requires ADMIN permissions or higher"`
* **HTTP Code**: `403 Forbidden`
* **Where It Occurs**: `GET/POST /api/v1/queues/:id/jobs`, `GET /api/v1/queues/:id/stats`, `PATCH /api/v1/queues/:id`.
* **Root Cause**: 
  * The system enforces strict multi-tenant Role-Based Access Control (RBAC). You are trying to view or modify a project/queue belonging to an organization where your logged-in user is not an active member (`organization_members`).
* **How to Fix**:
  1. Navigate to **[Projects](http://localhost:5173/projects)**.
  2. Select your own organization and click **View Queues**.
  3. If you need elevated access, have the Organization `OWNER` promote your account role to `ADMIN` or `MEMBER`.

---

### 3. `400 Bad Request` / `CONSTRAINT_VIOLATION` (Slug Format)
* **Error Message**: `"Field value failed format or boundary constraints (e.g. slug must be 2-64 alphanumeric chars with no trailing hyphens)"`
* **HTTP Code**: `400 Bad Request`
* **Where It Occurs**: `POST /api/v1/orgs`, `POST /api/v1/projects`.
* **Root Cause**: 
  * The PostgreSQL table has a check constraint `chk_projects_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9\-]{0,62}[a-z0-9]$')`.
  * Slugs must:
    * Be at least **2 characters** long.
    * Start and end with an alphanumeric character (`a-z`, `0-9`).
    * Contain **no spaces, no underscores, and no trailing/leading hyphens** (e.g. `test-` is invalid).
* **How to Fix**:
  * Use URL-safe slugs like `acme-corp`, `payments-v2`, `order-fulfillment`.
  * The UI automatically sanitizes trailing hyphens on submission.

---

### 4. `400 Bad Request` / `VALIDATION_ERROR` (Invalid UUID or Missing Body)
* **Error Message**: `"Validation failed"` with Zod details: `[{"message": "Invalid uuid", "path": ["organizationId"]}]`
* **HTTP Code**: `400 Bad Request`
* **Where It Occurs**: `POST /api/v1/projects`, `POST /api/v1/queues`.
* **Root Cause**: 
  * Submitting a creation form when no parent resource exists (e.g. submitting a project when `organizationId` is empty `""`).
* **How to Fix**:
  1. Ensure you create an Organization first before creating a Project.
  2. Ensure you create a Project first before creating a Queue.

---

### 5. `409 Conflict` / `PROJECT_SLUG_EXISTS` or `QUEUE_NAME_EXISTS`
* **Error Message**: `"A project with this slug already exists in this organization"` or `"A queue with this name already exists in this project"`
* **HTTP Code**: `409 Conflict`
* **Where It Occurs**: `POST /api/v1/projects`, `POST /api/v1/queues`.
* **Root Cause**: 
  * Unique constraint violation: Slugs must be unique within their parent Organization; Queue names must be unique within their parent Project.
* **How to Fix**:
  * Choose a distinct name or slug (e.g. `order-fulfillment-v2`, `email-notifications-fast`).

---

## ─── Priority 2: Operational & Lifecycle Errors ───────────────

### 6. Jobs Stuck in `PENDING` State (Not Executing)
* **Symptom**: Jobs are submitted and show `PENDING` badge, but worker never claims them.
* **Root Causes & Solutions**:
  1. **Worker Process Not Running**:
     * *Fix*: Start the worker engine in a terminal: `npm run dev --prefix backend/worker`.
  2. **Queue is Paused**:
     * *Fix*: Check the queue status in **[Queues](http://localhost:5173/queues)**. If `PAUSED`, click the **Resume** ($\blacktriangleright$) button.
  3. **Worker Concurrency Saturated**:
     * *Fix*: Check the **[Workers](http://localhost:5173/workers)** page. If all concurrency slots are in use (`BUSY`), increase worker concurrency in `.env` (`WORKER_CONCURRENCY=10`) or start additional worker nodes.

---

### 7. Delayed Jobs Stuck in `SCHEDULED` State
* **Symptom**: A delayed job's scheduled time has passed, but it never transitions to `PENDING` or `RUNNING`.
* **Root Cause**: 
  * The **Scheduler Service** is not running. (Workers only claim `PENDING` jobs; the Scheduler is responsible for promoting `SCHEDULED` $\rightarrow$ `PENDING`).
* **How to Fix**:
  * Start the scheduler engine: `npm run dev --prefix backend/scheduler`.

---

### 8. Worker Marked `UNHEALTHY` / Stale Heartbeats
* **Symptom**: In **[Workers](http://localhost:5173/workers)**, a worker card displays red `UNHEALTHY` badge.
* **Root Cause**: 
  * The worker node missed heartbeat updates for over 30 seconds (`WORKER_STALE_THRESHOLD_SECONDS=30`). This happens if the Node process was terminated with `Ctrl+C` without graceful drainage or if the machine lost network connectivity.
* **How to Fix**:
  1. Click **"Scan Stale Workers"** to flag orphaned nodes.
  2. Restart the worker process: `npm run dev --prefix backend/worker`.
  3. If jobs were stuck on the dead worker, the scheduler will re-queue uncompleted jobs.

---

### 9. Job Quarantined in Dead Letter Queue (`DEAD` Status)
* **Symptom**: Job status changes to `DEAD` with a skull icon $\skull$.
* **Root Cause**: 
  1. The job failed repeatedly and exhausted its maximum retry attempts (e.g. 3 attempts).
  2. The worker handler encountered a permanent fatal error (e.g. `ERR_PARSE_FAIL`).
* **How to Fix**:
  1. Navigate to **[DLQ](http://localhost:5173/dlq)**.
  2. Click the **Eye icon** ($\odot$) to inspect the failure stack trace and error code.
  3. Fix the underlying bug (or external API issue).
  4. Click **"Retry Job"** ($\circlearrowright$) to reset its attempts and re-queue it.

---

### 10. PostgreSQL `42601` Trigger Error (Batch Counter Trigger)
* **Error Message**: `SQL statement "UPDATE batch_groups SET pending_count = ..."` with code `42601`.
* **Root Cause**: 
  * In PL/pgSQL, an `UPDATE` statement cannot have duplicate column assignments in the same `SET` clause (`pending_count = ... - 1, ..., pending_count = ... + 1`).
* **How to Fix**:
  * Apply migration `005_fix_batch_counts_trigger.sql` which merges increment/decrement expressions into `pending_count = pending_count - (...) + (...)`.

---

## ─── Priority 3: Infrastructure & Environment Errors ─────────

### 11. `ECONNREFUSED 127.0.0.1:5432` (PostgreSQL Down)
* **Error Message**: `connect ECONNREFUSED 127.0.0.1:5432`
* **Root Cause**: PostgreSQL server is not running on port 5432.
* **How to Fix**:
  * Windows Service: Open `services.msc` and start `postgresql-x64-17`.
  * Docker: Run `docker-compose up postgres -d`.

---

### 12. `ECONNREFUSED 127.0.0.1:6379` (Redis Down)
* **Error Message**: `[ioredis] Unhandled error event: Error: connect ECONNREFUSED 127.0.0.1:6379`
* **Root Cause**: Redis cache is not running. (Redis is optional for local dev since database row locks fallback automatically, but needed for leader election in multi-instance scheduler clusters).
* **How to Fix**:
  * Docker: Run `docker-compose up redis -d`.

---

### 13. `500 RESOURCE_NOT_FOUND` / Foreign Key Constraint `23503`
* **Error Message**: `"Referenced foreign resource not found"`
* **HTTP Code**: `404 Not Found`
* **Root Cause**: 
  * Attempting to delete an Organization that contains active Queues without cascading, or submitting a job to a deleted queue ID.
* **How to Fix**:
  * Delete child Queues first before deleting a Project, or delete Projects before deleting an Organization.

---

## ─── Priority 4: Frontend Warnings & Edge Cases ───────────────

### 14. `Warning: Received NaN for the value attribute`
* **Error Message in Browser Console**: `Warning: Received NaN for the value attribute. If this is expected, cast the value to a string.`
* **Root Cause**: 
  * An `<input type="number">` field was cleared by the user (backspace), causing `parseInt("", 10)` to produce `NaN`.
* **How to Fix**:
  * Use defensive state fallback: `value={isNaN(val) ? '' : val}` and `onChange={(e) => setVal(parseInt(e.target.value, 10) || '')}`. (Resolved across all pages).

---

### 15. `404 Not Found` / `QUEUE_NOT_FOUND` or `JOB_NOT_FOUND`
* **Error Message**: `"Queue not found"` or `"Job not found"`
* **HTTP Code**: `404 Not Found`
* **Where It Occurs**: Direct URL navigation to `/queues/<invalid-uuid>` or `/jobs/<invalid-uuid>`.
* **How to Fix**:
  * Use the navigation table in **[Queues](http://localhost:5173/queues)** or **[Jobs](http://localhost:5173/jobs)** to open valid active entities.

---

## Summary Diagnostic Checklist

When encountering unexpected behavior, run this 4-point diagnostic check:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       4-POINT SYSTEM HEALTH CHECK                           │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. API Health:        curl http://localhost:3000/api/v1/health             │
│                       -> Should return status: "ok" with database connected │
├─────────────────────────────────────────────────────────────────────────────┤
│ 2. Active Session:    Inspect Authorization header or re-login at /login    │
│                       -> Token should contain valid active user UUID        │
├─────────────────────────────────────────────────────────────────────────────┤
│ 3. Background Nodes:  Check terminals for Worker & Scheduler processes      │
│                       -> Worker claiming loop polling every 500ms           │
├─────────────────────────────────────────────────────────────────────────────┤
│ 4. Reset Clean State: cmd /c "d:\Job Scheduler\database\reset_db.bat"       │
│                       -> Recreates clean database with seed accounts        │
└─────────────────────────────────────────────────────────────────────────────┘
```
