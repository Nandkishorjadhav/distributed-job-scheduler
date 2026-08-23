# Distributed Job Scheduler — Complete Web UI User Guide (`uiguide.md`)

Welcome to the **Distributed Job Scheduler Web Operations Console**! 

This step-by-step tutorial is designed for new users. It explains the core concepts, how to start the platform, and walks you through every screen and workflow in the user interface.

---

## Table of Contents

1. [Core Concept: The 4-Tier Hierarchy](#1-core-concept-the-4-tier-hierarchy)
2. [Step 0: Starting the Platform](#step-0-starting-the-platform)
3. [Step 1: Account Registration & Sign-In](#step-1-account-registration--sign-in)
4. [Step 2: Creating Your First Organization & Project](#step-2-creating-your-first-organization--project)
5. [Step 3: Creating and Configuring Queues](#step-3-creating-and-configuring-queues)
6. [Step 4: Submitting and Dispatching Jobs](#step-4-submitting-and-dispatching-jobs)
7. [Step 5: Tracking Job Lifecycles & Execution Logs](#step-5-tracking-job-lifecycles--execution-logs)
8. [Step 6: Monitoring Distributed Workers & Heartbeats](#step-6-monitoring-distributed-workers--heartbeats)
9. [Step 7: Dead Letter Queue (DLQ) Quarantine & Recovery](#step-7-dead-letter-queue-dlq-quarantine--recovery)
10. [Step 8: Reading System Telemetry & Metrics Dashboard](#step-8-reading-system-telemetry--metrics-dashboard)
11. [Step 9: Exploring Interactive OpenAPI Swagger Docs](#step-9-exploring-interactive-openapi-swagger-docs)
12. [Troubleshooting & Frequently Asked Questions](#troubleshooting--frequently-asked-questions)

---

## 1. Core Concept: The 4-Tier Hierarchy

Before interacting with the UI, understanding how resources relate to one another will make navigation intuitive:

```
┌──────────────────────────────────────────────────────────┐
│             1. Organization (Tenant Boundary)            │
│                 e.g. "Acme Corporation"                  │
└────────────────────────────┬─────────────────────────────┘
                             │ owns
                             ▼
┌──────────────────────────────────────────────────────────┐
│                 2. Project (Resource Scope)              │
│                e.g. "Payments & Settlements"             │
└────────────────────────────┬─────────────────────────────┘
                             │ contains
                             ▼
┌──────────────────────────────────────────────────────────┐
│                 3. Queue (Processing Lane)               │
│               e.g. "high-priority-transfers"             │
└────────────────────────────┬─────────────────────────────┘
                             │ processes
                             ▼
┌──────────────────────────────────────────────────────────┐
│                 4. Job (Asynchronous Task)               │
│        e.g. "process-stripe-transfer-id-9988"            │
└──────────────────────────────────────────────────────────┘
```

* **Organization**: Multi-tenant container. You can invite team members with specific roles (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`).
* **Project**: A logical grouping of related queues and jobs (e.g. "Billing Service", "Image Processing").
* **Queue**: A prioritized execution pipeline with concurrency limits and retry policies.
* **Job**: An individual unit of work containing a JSON payload, priority score, and execution state.

---

## Step 0: Starting the Platform

Open **4 PowerShell terminals** in `d:\Job Scheduler`:

```powershell
# Terminal 1: Backend REST API Gateway (Port 3000)
npm run dev --prefix backend/api

# Terminal 2: Distributed Scheduler Service (Delayed & Cron Promoter)
npm run dev --prefix backend/scheduler

# Terminal 3: Distributed Worker Node (Claims & Runs Jobs)
npm run dev --prefix backend/worker

# Terminal 4: React Dashboard Web UI (Port 5173)
npm run dev --prefix frontend
```

Open your browser and navigate to: **[http://localhost:5173](http://localhost:5173)**

---

## Step 1: Account Registration & Sign-In

### 1.1 First-Time Registration
1. Navigate to **[http://localhost:5173/login](http://localhost:5173/login)**.
2. Click **"Need an account? Register"** at the bottom of the form.
3. Fill in the fields:
   * **Full Name**: `Alex Developer`
   * **Email Address**: `alex@example.com`
   * **Password**: `Password123!` (minimum 8 characters with at least one number/symbol).
4. Click **"Create Account"**.

### 1.2 Sign In
1. Enter your email and password.
2. Click **"Sign In"**.
3. You will be redirected to the **Main Dashboard**. Your user name and initial avatar will appear in the top-right corner.

---

## Step 2: Creating Your First Organization & Project

All queues and jobs must belong to an Organization and Project.

### 2.1 Create an Organization
1. Click **"Projects"** in the top navigation bar (or navigate to `/projects`).
2. Click the **"New Organization"** button in the top right.
3. In the modal:
   * **Organization Name**: `Acme Logistics`
   * **Slug (Identifier)**: `acme-logistics` (auto-generated URL-safe identifier).
4. Click **"Create Organization"**. You are now the **`OWNER`** of this organization.

### 2.2 Create a Project
1. On the same **Projects** page, click the **"New Project"** button.
2. In the modal:
   * **Target Organization**: Select `Acme Logistics` from the dropdown.
   * **Project Name**: `Order Fulfillment`
   * **Slug**: `order-fulfillment`
   * **Description**: `Handles inventory checks and packing slips`
3. Click **"Create Project"**.
4. You will see the new project card appear with a **"View Queues"** button.

---

## Step 3: Creating and Configuring Queues

Queues dictate *how fast*, *in what order*, and *with what retry strategy* your background tasks run.

### 3.1 Create a New Queue
1. Click **"Queues"** in the top navigation bar (or click "View Queues" on your project card).
2. Click the **"New Queue"** button.
3. In the modal:
   * **Target Project**: Select `Order Fulfillment`.
   * **Queue Name**: `invoice-generation`
   * **Priority (1-10)**: `8` (Higher priority queues are claimed first by workers).
   * **Concurrency Limit**: `10` (Maximum simultaneous jobs running in this queue).
   * **Enable Dead Letter Queue**: Check the box $\checkmark$ (Quarantines jobs after retry exhaustion).
4. Click **"Create Queue"**.

### 3.2 Advanced Queue Configuration (Backoff Policy)
1. In the queues table, click the **Settings icon** ($\text{⚙}$) on your queue row (or navigate to `/queues/<queueId>/config`).
2. Here you can configure the **Retry & Backoff Policy Engine**:
   * **Backoff Strategy**: 
     * `Exponential Backoff`: Delay doubles after each failure ($1\text{s} \rightarrow 2\text{s} \rightarrow 4\text{s} \rightarrow 8\text{s}$). Best for third-party APIs.
     * `Linear Backoff`: Delay increases linearly ($1\text{s} \rightarrow 2\text{s} \rightarrow 3\text{s}$).
     * `Fixed Delay`: Same delay between every retry.
   * **Max Retry Attempts**: `3` (How many times a failing job is re-attempted before entering DLQ).
   * **Initial Delay (ms)**: `1000` ($1$ second initial backoff).
   * **Max Delay Cap (ms)**: `30000` (Caps delay at $30$ seconds).
   * **Randomized Jitter (ms)**: `500` (Adds $\pm 500\text{ms}$ random variance to prevent "thundering herd" server spikes).
3. Click **"Save Configuration"**.

### 3.3 Pausing and Resuming Queues
* To halt all processing on a queue (e.g. during database maintenance), click the **Pause** ($\text{⏸}$) button on the queue row.
* While paused, jobs remain queued in `PENDING` state and will NOT be claimed by workers.
* Click **Resume** ($\blacktriangleright$) to resume claiming immediately.

---

## Step 4: Submitting and Dispatching Jobs

### 4.1 Enqueue an Immediate Job
1. Click **"Jobs"** in the top navigation bar (or open your queue details and click "Submit Job").
2. Click **"Submit Job"**.
3. In the modal:
   * **Target Queue**: `invoice-generation`
   * **Job Name**: `generate-invoice-INV-1001`
   * **Job Type**: `Immediate`
   * **Priority (1-10)**: `8`
   * **Payload (JSON)**:
     ```json
     {
       "orderId": "ORD-9988",
       "customerEmail": "customer@example.com",
       "amount": 250.00,
       "currency": "USD"
     }
     ```
4. Click **"Enqueue"**.
5. Your running worker node will immediately claim and execute the job!

### 4.2 Enqueue a Delayed Job
1. Click **"Submit Job"**.
2. Select **Job Type**: `Delayed`.
3. Set **Delay**: `30` seconds.
4. Set **Job Name**: `send-followup-survey`.
5. Click **"Enqueue"**.
6. The job will sit safely in `SCHEDULED` status until the 30 seconds elapse, after which the **Scheduler Engine** promotes it to `PENDING` for workers to claim.

### 4.3 Enqueue a Batch of Jobs (Bulk Submission)
1. Click **"Submit Job"** on the **Jobs** page or on any **Queue Details** page.
2. In the modal header, toggle the tab to **`Batch (Bulk)`**.
3. Fill in:
   * **Target Queue**: `invoice-generation`
   * **Batch Group Name**: `monthly-payroll-batch`
   * **Description**: `Processing 3 invoice tasks in parallel`
   * **Jobs Array (JSON)**:
     ```json
     [
       {
         "name": "invoice-cust-101",
         "type": "immediate",
         "priority": 8,
         "payload": { "customerId": "cust_101", "amount": 120.50 }
       },
       {
         "name": "invoice-cust-102",
         "type": "immediate",
         "priority": 8,
         "payload": { "customerId": "cust_102", "amount": 450.00 }
       },
       {
         "name": "invoice-cust-103",
         "type": "delayed",
         "scheduledAt": "2026-08-23T18:00:00.000Z",
         "priority": 5,
         "payload": { "customerId": "cust_103", "amount": 35.00 }
       }
     ]
     ```
4. Click **"Enqueue Batch Jobs"**. All jobs are created atomically in a single transaction and tracked by a parent `batch_groups` record.

---

## Step 5: Tracking Job Lifecycles & Execution Logs

### 5.1 Understanding Job States

```
[SCHEDULED] ──(Time arrived)──> [PENDING] ──(Worker claim)──> [RUNNING]
                                                                  │
                                   ┌──────────────────────────────┴──────────────────────────────┐
                                   ▼                                                             ▼
                             [COMPLETED]                                                      [FAILED]
                                                                                                 │
                                                   ┌─────────────────────────────────────────────┴─────────────┐
                                                   ▼                                                           ▼
                                         [RETRYING] ──(Backoff delay)──> [PENDING]                    [DEAD / DLQ]
```

| Badge Status | Meaning |
| :--- | :--- |
| **`SCHEDULED`** | Future timestamp has not arrived yet. Monitored by the Scheduler. |
| **`PENDING`** | Eligible and waiting in queue for an available worker concurrency slot. |
| **`RUNNING`** | Currently being processed by an active worker process. |
| **`COMPLETED`** | Handled successfully with `0` errors. |
| **`RETRYING`** | Failed, currently waiting for its exponential backoff delay before re-queueing. |
| **`FAILED`** | Failed attempt recorded. |
| **`DEAD`** | Maximum retry attempts exhausted or permanent failure. Quarantined in DLQ. |
| **`CANCELLED`** | Manually stopped by user before execution started. |

### 5.2 Inspecting Job Details & Live Logs
1. On the **Jobs** page, click on any Job Name (e.g. `generate-invoice-INV-1001`).
2. The **Job Inspector** will open, showing:
   * **Lifecycle Status & Timeline**: Exact timestamps for `Enqueued`, `Started`, and `Finished`.
   * **Input Payload**: Raw JSON submitted with syntax highlighting.
   * **Execution Attempts Table**: Attempt number, worker ID, execution duration (ms), error messages, and error codes.
   * **Execution Logs**: Real-time console logs emitted by the handler (`INFO`, `WARN`, `ERROR`).
3. If a job is `DEAD`, you can click **"Retry Job"** in the header to re-queue it immediately.

---

## Step 6: Monitoring Distributed Workers & Heartbeats

Navigate to **[Workers](http://localhost:5173/workers)** in the navigation bar.

### 6.1 Worker Statuses
* **`ONLINE`** (Green): Worker is active and sending heartbeat pings every 5 seconds.
* **`BUSY`** (Amber): Worker is operating at maximum concurrency capacity (`current_job_count >= max_concurrency`).
* **`UNHEALTHY`** (Red): Worker missed heartbeats for over 30 seconds (network partition or crashed process).
* **`STOPPED`** (Gray): Worker drained in-flight jobs and shut down cleanly.

### 6.2 Worker Actions
* **Scan Stale Workers**: Click this button to trigger an instant sweep identifying workers whose heartbeats expired without clean shutdown.
* **Inspect Worker**: Click on any worker card to view its host machine details, OS PID, version, and list of currently assigned active jobs.
* **Stop Worker**: Sends a graceful shutdown command to drain and stop the worker process.

---

## Step 7: Dead Letter Queue (DLQ) Quarantine & Recovery

Navigate to **[DLQ](http://localhost:5173/dlq)** in the navigation bar.

### 7.1 Why Does a Job Enter DLQ?
A job enters the Dead Letter Queue when:
1. It fails repeatedly and exhausts its `maxAttempts` (e.g. 3 failed attempts).
2. The worker handler encounters an unrecoverable permanent error (e.g. `Invalid Card Number` or `Malformed Schema`).

### 7.2 DLQ Capabilities
* **Inspect Failure**: Click the **Eye icon** ($\odot$) to inspect the full stack trace, last error code, attempt count, and original payload.
* **Retry / Re-queue**: Click **"Retry Job"** ($\circlearrowright$) to reset its attempt counter and push it back to `PENDING` in the primary queue.
* **Archive**: Move from active quarantine to archived state.
* **Delete**: Permanently purge the record.

---

## Step 8: Reading System Telemetry & Metrics Dashboard

Navigate to **[Dashboard](http://localhost:5173/)** in the navigation bar.

### 8.1 Key Metrics Cards
* **Total Jobs**: Total volume of jobs tracked in durable storage.
* **Running Jobs**: Real-time in-flight jobs currently being processed.
* **Completed Jobs**: Total jobs that succeeded.
* **Retrying Jobs**: Jobs waiting in backoff windows.
* **Failed / DLQ**: Failure counts requiring developer attention.

### 8.2 Execution Latency Percentiles
The bar chart visualizes duration percentiles across completed executions:
* **p50 (Median)**: 50% of your jobs completed faster than this time.
* **p95**: Tail latency excluding the slowest 5%.
* **p99**: Extreme tail latency (worst-case execution performance).

### 8.3 Auto-Refresh
Check the **"Auto-refresh (5s)"** checkbox in the top right to keep the metrics dashboard streaming live updates every 5 seconds.

---

## Step 9: Exploring Interactive OpenAPI Swagger Docs

Click **"API Docs"** in the top navigation bar or navigate to **[http://localhost:3000/api/v1/docs](http://localhost:3000/api/v1/docs)**.

* Fully interactive Swagger UI documenting all 40 REST endpoints.
* Every endpoint includes request/response JSON schemas, authentication requirements, and error code catalogs.
* Every API request returns a unique `X-Request-Id` correlation header for end-to-end tracing across services.

---

## Troubleshooting & Frequently Asked Questions

### Q: Why do I see "Access Restricted (Forbidden 403)" on a Queue or Project?
**A**: The platform enforces multi-tenant RBAC boundaries. You can only view and manage resources in organizations where your logged-in account is an active member. If you are viewing a queue created under a different account or test run, navigate to **[Projects](http://localhost:5173/projects)** and select your own organization's queues.

### Q: My job is stuck in `PENDING` state. Why isn't it executing?
**A**: Check the following:
1. Is your worker process running? Ensure you ran `npm run dev --prefix backend/worker` in a terminal.
2. Is the queue paused? Navigate to **Queues** and ensure the status is `ACTIVE` (not `PAUSED`).
3. Is worker concurrency maxed out? Check the **Workers** page to see if all concurrency slots are currently busy.

### Q: My delayed job hasn't run yet. Why?
**A**: Ensure the **Scheduler Service** is running (`npm run dev --prefix backend/scheduler`). The scheduler polls every second to promote scheduled jobs whose execution timestamp has arrived.

### Q: How do I completely clear all test data and start with 0 jobs?
**A**: Run the reset batch script in PowerShell:
```powershell
cmd /c "d:\Job Scheduler\database\reset_db.bat"
```
Or truncate only the job tables:
```powershell
psql -U postgres -d job_scheduler -c "TRUNCATE job_logs, job_executions, dead_letter_jobs, jobs, worker_heartbeats, workers CASCADE;"
```

---

*Happy Scheduling! For developer documentation and database schema deep-dives, refer to the [Master Docs Index](docs/README.md).*
