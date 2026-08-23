# Step 9: Dead Letter Queue (DLQ) & Quarantine Management

## Overview

The **Dead Letter Queue (DLQ)** subsystem captures and isolates jobs that cannot be completed due to exhausted retry attempts or unrecoverable fatal errors. By retaining an immutable failure snapshot in `dead_letter_jobs`, operators can inspect failure causes, analyze error distributions, re-queue repaired jobs, or archive/delete permanently failed jobs.

---

## 1. When a Job Enters DLQ

A job enters the Dead Letter Queue when:
1. **Max Retry Attempts are Exhausted**: `job.attempt_count >= job.max_attempts`.
2. **Permanent Failure is Detected**: Handlers throw fatal errors, or queue execution terminates.
3. **Queue has `dlq_enabled = true`**: Enabled by default for all queues.

---

## 2. Retained Metadata

Implemented in [`DeadLetterJobRepository.ts`](file:///d:/Job%20Scheduler/backend/shared/src/db/repositories/DeadLetterJobRepository.ts):

| Field | Description |
| :--- | :--- |
| `job_id` | Original job UUID in `jobs` table. |
| `queue_id` & `queue_name` | The queue where the job failed. |
| `project_id` & `project_name`| Tenant project boundary. |
| `name` & `payload` | Immutable snapshot of job name and input arguments. |
| `total_attempts` | Count of attempts made before entering DLQ. |
| `final_error_message` | Error message captured on final attempt. |
| `final_error_code` | Error code captured on final attempt. |
| `failed_worker_id` & `hostname` | Host and process that executed the failed attempt. |
| `status` | `unhandled` (pending operator review), `retried`, `archived`. |
| `first_failed_at` & `last_failed_at` | Timestamps of first and last failure attempts. |
| `requeued_at` & `requeued_by` | Audit tracking when job is re-queued back to pending. |
| `archived_at` & `archived_by` | Audit tracking when job is marked archived. |

---

## 3. REST APIs

### 1. List DLQ Jobs
- **`GET /api/v1/dlq`** (or **`GET /api/v1/queues/:queueId/dlq`**)
- **Query Parameters**: `page`, `pageSize`, `queueId`, `projectId`, `status`, `search`.
- **Response `200 OK`**: Returns paginated DLQ items with failure summary.

### 2. Dashboard-Ready Statistics
- **`GET /api/v1/dlq/stats`** (or **`GET /api/v1/queues/:queueId/dlq/stats`**)
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "data": {
      "totalDlqJobs": 12,
      "unhandledCount": 9,
      "retriedCount": 2,
      "archivedCount": 1,
      "byQueue": [
        { "queueId": "...", "queueName": "payment-webhooks", "count": 8 },
        { "queueId": "...", "queueName": "email-notifications", "count": 4 }
      ],
      "topErrorCodes": [
        { "errorCode": "ERR_CARD_DECLINED", "count": 7 },
        { "errorCode": "ERR_SOCKET_TIMEOUT", "count": 5 }
      ],
      "recentFailures": [ ... ]
    }
  }
  ```

### 3. Inspect Single DLQ Job
- **`GET /api/v1/dlq/:dlqId`**
- Returns complete DLQ snapshot alongside the **full execution attempt history** (`job_executions`) and **execution log stream** (`job_logs`).

### 4. Re-queue / Retry DLQ Job
- **`POST /api/v1/dlq/:dlqId/retry`**
- **Behavior**: Resets original job in `jobs` table to `pending` status with `attempt_count = 0` and cleared error messages, updates DLQ status to `retried`, and records `requeued_at = NOW()` and `requeued_by = req.user.id`.

### 5. Archive DLQ Job
- **`POST /api/v1/dlq/:dlqId/archive`**
- **Behavior**: Marks DLQ record as `archived` with `archived_at = NOW()` and `archived_by = req.user.id`.

### 6. Delete DLQ Job
- **`DELETE /api/v1/dlq/:dlqId`**
- **Behavior**: Permanently deletes the DLQ record.
