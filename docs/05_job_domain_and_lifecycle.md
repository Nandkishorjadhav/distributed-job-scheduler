# Step 5: Job Domain Model & Lifecycle Finite State Machine

## Overview

The job domain model defines 5 distinct job types and an 8-state **Finite State Machine (FSM)**. State transitions are strictly validated to prevent illegal operations (such as retrying an already completed job or cancelling a finished execution), while execution attempts and logs are immutably preserved.

---

## 1. Job Types Supported

| Job Type           | Key           | Initial Status | Behavior                                                               |
| :----------------- | :------------ | :------------- | :--------------------------------------------------------------------- |
| **Immediate**      | `immediate`   | `pending`      | Executes as soon as an active worker has capacity.                     |
| **Delayed**        | `delayed`     | `scheduled`    | Scheduled to run after a delay (`scheduledAt = NOW() + delayMs`).      |
| **Scheduled**      | `scheduled`   | `scheduled`    | Scheduled to run at a specific future ISO 8601 timestamp.              |
| **Recurring Cron** | `recurring`   | `scheduled`    | Created via cron template (`scheduled_jobs`) and spawned periodically. |
| **Batch Child**    | `batch_child` | `pending`      | Child job linked to a parent `batch_groups` aggregate counter.         |

---

## 2. Finite State Machine (FSM) Transition Matrix

```
                        ┌──────────────┐
                        │  SCHEDULED   │
                        └──────┬───────┘
                               │ (due time reached)
                               ▼
                        ┌──────────────┐
     ┌─────────────────►│   QUEUED     │──────────────────┐
     │ (retry)          │  (pending)   │                  │
     │                  └──────┬───────┘                  │
     │                         │ (worker claim)           │
     │                         ▼                          │ (user cancel)
┌────┴─────────┐        ┌──────────────┐                  │
│   FAILED /   │◄───────│   RUNNING    │                  │
│   RETRYING   │        │  (claimed)   │                  │
└────┬─────────┘        └───┬──────────┘                  │
     │                      │ (success)                   │
     │ (exhausted attempts) ▼                             │
     │                  ┌──────────────┐                  │
     └─────────────────►│  COMPLETED   │                  │
     │ (move to DLQ)    │  (terminal)  │                  │
     ▼                  └──────────────┘                  │
┌──────────────┐                                          │
│ DEAD_LETTER  │                                          │
│    (dead)    │                                          │
└────┬─────────┘                                          │
     │ (manual retry)                                     │
     └────────────────────────────────────────────────────┤
                                                          ▼
                                                   ┌──────────────┐
                                                   │  CANCELLED   │
                                                   │  (terminal)  │
                                                   └──────────────┘
```

### Transition Validation Rules ([`JobStateMachine.ts`](file:///d:/Job%20Scheduler/backend/shared/src/domain/JobStateMachine.ts)):

| From State  | Allowed Target States                      | Description                                                                       |
| :---------- | :----------------------------------------- | :-------------------------------------------------------------------------------- |
| `SCHEDULED` | `PENDING`, `CANCELLED`                     | Promoted to `PENDING` when `scheduled_at <= NOW()`.                               |
| `PENDING`   | `RUNNING`, `CANCELLED`                     | Claimed by worker to transition to `RUNNING`.                                     |
| `RUNNING`   | `COMPLETED`, `FAILED`, `DEAD`, `CANCELLED` | Active execution outcome.                                                         |
| `FAILED`    | `PENDING`, `DEAD`                          | Retry backoff re-queues to `PENDING`, or moves to `DEAD` if max attempts reached. |
| `DEAD`      | `PENDING`                                  | Manual DLQ re-queue resets job back to `PENDING`.                                 |
| `COMPLETED` | _(None)_                                   | **Terminal State**. Self or outbound transitions throw `400 Bad Request`.         |
| `CANCELLED` | _(None)_                                   | **Terminal State**. Cannot be retried or transitioned.                            |

---

## 3. Execution History & Log Streaming

Every execution attempt is atomically recorded in `job_executions`:

- `attempt_number` (1-based attempt counter)
- `status` (`running`, `completed`, `failed`, `timed_out`, `cancelled`)
- `started_at` & `finished_at`
- `duration_ms` (PostgreSQL generated column)
- `error_message`, `error_code`, `next_retry_at`, `retry_delay_ms`

Structured logs are written to `job_logs` with severity levels:
`debug`, `info`, `warn`, `error`.

---

## 4. REST Endpoints

### 1. Submit Single Job

- **`POST /api/v1/queues/:queueId/jobs`** (or **`POST /api/v1/jobs`**)
- **Body**:
  ```json
  {
    "name": "send-welcome-email",
    "type": "immediate",
    "payload": { "userId": "usr_100", "email": "user@example.com" },
    "priority": 3,
    "maxAttempts": 3
  }
  ```
- **Response `201 Created`**.

### 2. Submit Batch of Jobs

- **`POST /api/v1/queues/:queueId/batch`**
- **Body**:
  ```json
  {
    "name": "bulk-notifications",
    "jobs": [
      { "name": "notify-user-1", "payload": { "id": 1 } },
      { "name": "notify-user-2", "payload": { "id": 2 } }
    ]
  }
  ```
- **Response `201 Created`**: Returns `batchGroupId`, `totalJobs`, and job array.

### 3. Create Recurring Cron Job

- **`POST /api/v1/queues/:queueId/recurring`**
- **Body**:
  ```json
  {
    "name": "hourly-cleanup",
    "cronExpression": "0 * * * *",
    "timezone": "UTC",
    "payloadTemplate": { "action": "purge_logs" }
  }
  ```

### 4. Get Job Details & List Jobs

- **`GET /api/v1/jobs/:jobId`**: Retrieve single job.
- **`GET /api/v1/jobs`** or **`GET /api/v1/queues/:queueId/jobs`**: Paginated listing with filters (`status`, `type`, `search`, `page`, `pageSize`).

### 5. Cancel Job

- **`POST /api/v1/jobs/:jobId/cancel`** (or `DELETE /api/v1/jobs/:jobId`)
- Validates FSM rules. Returns `400 Bad Request` if job cannot be cancelled.

### 6. Retry Failed Job

- **`POST /api/v1/jobs/:jobId/retry`**
- Validates FSM rules. Resets status to `pending`, clears error messages, and increments retry metrics.

### 7. Execution History & Logs

- **`GET /api/v1/jobs/:jobId/executions`**: Returns array of all execution attempts.
- **`GET /api/v1/jobs/:jobId/logs`**: Returns log stream filtered by `?level=`.
- **`GET /api/v1/jobs/:jobId/history`**: Full audit summary (job details + executions + logs).

---

## 5. How to Submit Batch Jobs at Once

You can submit batches of jobs simultaneously using either the **Web Dashboard UI** or the **REST API**.

### Option A: Web Dashboard UI

1. Open the **[Jobs](http://localhost:5173/jobs)** page or any **Queue Details** page.
2. Click **"Submit Job"** / **"Submit New Job"**.
3. In the modal header, click the **`Batch (Bulk)`** mode tab.
4. Select your **Target Queue**, enter a **Batch Group Name** (e.g. `nightly-settlements-batch`), and paste a JSON array into **Jobs Array**:
   ```json
   [
     {
       "name": "invoice-customer-101",
       "type": "immediate",
       "priority": 8,
       "payload": { "customerId": "cust_101", "amount": 120.5 }
     },
     {
       "name": "invoice-customer-102",
       "type": "immediate",
       "priority": 8,
       "payload": { "customerId": "cust_102", "amount": 450.0 }
     },
     {
       "name": "invoice-customer-103",
       "type": "delayed",
       "scheduledAt": "2026-08-23T18:00:00.000Z",
       "priority": 5,
       "payload": { "customerId": "cust_103", "amount": 35.0 }
     }
   ]
   ```
5. Click **"Enqueue Batch Jobs"**.

### Option B: REST API (`POST /api/v1/queues/:queueId/batch`)

#### cURL:

```bash
curl -X POST http://localhost:3000/api/v1/queues/<QUEUE_UUID>/batch \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <YOUR_JWT_TOKEN>" \
  -d '{
    "name": "data-sync-batch",
    "description": "Bulk synchronization of 100 accounts",
    "jobs": [
      {
        "name": "sync-account-1",
        "type": "immediate",
        "priority": 7,
        "payload": { "accountId": "acc_001" }
      },
      {
        "name": "sync-account-2",
        "type": "immediate",
        "priority": 7,
        "payload": { "accountId": "acc_002" }
      }
    ]
  }'
```

#### PowerShell:

```powershell
$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type"  = "application/json"
}

$body = @{
    name        = "payroll-batch-08"
    description = "August payroll execution"
    jobs        = @(
        @{ name = "payout-emp-1"; type = "immediate"; priority = 9; payload = @{ empId = 1; net = 4500 } },
        @{ name = "payout-emp-2"; type = "immediate"; priority = 9; payload = @{ empId = 2; net = 5200 } }
    )
} | ConvertTo-Json -Depth 5

$response = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/queues/$queueId/batch" `
    -Method Post `
    -Headers $headers `
    -Body $body

$response | ConvertTo-Json -Depth 5
```

#### Atomic Guarantees

- The batch is inserted inside an **atomic PostgreSQL transaction**.
- A parent record is created in `batch_groups` tracking `total_count`, `pending_count`, `running_count`, `completed_count`, and `failed_count`.
- Automatic database triggers dynamically maintain batch progress counters as child jobs transition states.
