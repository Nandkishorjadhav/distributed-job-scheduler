# Dead Letter Queue (DLQ) System

## Overview

The **Dead Letter Queue (DLQ)** subsystem captures and isolates jobs that cannot be completed due to exhausted retry attempts or unrecoverable fatal errors. By storing an immutable snapshot in `dead_letter_jobs`, operators can inspect failures, analyze error code distributions, safely re-queue repaired jobs, or archive/delete permanently failed jobs without interfering with active queue processing.

---

## 1. When a Job Enters DLQ

A job enters the Dead Letter Queue when:

1. **Max Retry Attempts are Exhausted**: `job.attempt_count >= job.max_attempts`.
2. **Permanent Failure is Detected**: Handlers throw fatal errors, or queue execution terminates.
3. **Queue has `dlq_enabled = true`**: Default behavior for all queues.

### Stored DLQ Metadata

Each DLQ record captures:

- **`job_id`**: Original job UUID.
- **`queue_id`** & **`queue_name`**: The queue where failure occurred.
- **`project_id`** & **`project_name`**: Tenant and resource scoping.
- **`name`** & **`payload`**: The original job name and input arguments.
- **`total_attempts`**: Number of attempts made before quarantine.
- **`final_error_message`** & **`final_error_code`**: Detailed error information from the last attempt.
- **`failed_worker_id`** & **`failed_worker_hostname`**: Host and process that executed the final attempt.
- **`status`**: `unhandled` | `retried` | `archived`.
- **`first_failed_at`**, **`last_failed_at`**, and **`moved_to_dlq_at`** timestamps.
- **`requeued_at`**, **`requeued_job_id`**, and **`requeued_by`** when manually retried.
- **`archived_at`** and **`archived_by`** when archived.

---

## 2. REST APIs Implemented

### 1. List DLQ Jobs

- **`GET /api/v1/dlq`** (or **`GET /api/v1/queues/:queueId/dlq`**)
- **Query Parameters**:
  - `page`: Page number (default: `1`).
  - `pageSize`: Items per page (default: `20`, max: `100`).
  - `queueId`: Filter by specific queue UUID.
  - `projectId`: Filter by specific project UUID.
  - `status`: Filter by status (`unhandled`, `retried`, `archived`).
  - `search`: Fuzzy search on job name, error message, or error code.

### 2. Dashboard-Ready DLQ Statistics

- **`GET /api/v1/dlq/stats`** (or **`GET /api/v1/queues/:queueId/dlq/stats`**)
- **Response Structure**:
  ```json
  {
    "success": true,
    "data": {
      "totalDlqJobs": 42,
      "unhandledCount": 35,
      "retriedCount": 5,
      "archivedCount": 2,
      "byQueue": [
        { "queueId": "...", "queueName": "payment-webhooks", "count": 28 },
        { "queueId": "...", "queueName": "email-notifications", "count": 14 }
      ],
      "topErrorCodes": [
        { "errorCode": "ERR_CARD_DECLINED", "count": 20 },
        { "errorCode": "ERR_SOCKET_TIMEOUT", "count": 12 }
      ],
      "recentFailures": [ ... ]
    }
  }
  ```

### 3. Inspect DLQ Job

- **`GET /api/v1/dlq/:dlqId`**
- Returns the complete DLQ snapshot alongside the **full execution attempt history** (`job_executions`) and **execution log stream** (`job_logs`).

### 4. Re-queue / Retry DLQ Job

- **`POST /api/v1/dlq/:dlqId/retry`**
- Atomically:
  1. Resets original job status to `pending`, clears error messages, resets attempt count to `0`, and unassigns worker.
  2. Updates DLQ status to `retried`, records `requeued_at = NOW()` and `requeued_by = req.user.id`.
  3. Appends an audit log into `job_logs`.

### 5. Archive DLQ Job

- **`POST /api/v1/dlq/:dlqId/archive`**
- Marks DLQ record as `archived` with `archived_at = NOW()` and `archived_by = req.user.id`.

### 6. Delete DLQ Job

- **`DELETE /api/v1/dlq/:dlqId`**
- Permanently deletes the DLQ record.

---

## 3. Automated Test Verification

Ran `npx vitest run api/dlq.test.ts`:

```text
✓ api/dlq.test.ts (11 tests)
  ✓ DLQ Listing & Filtering > lists DLQ jobs for the project with pagination
  ✓ DLQ Listing & Filtering > lists DLQ jobs scoped to a specific queue via /api/v1/queues/:queueId/dlq
  ✓ DLQ Listing & Filtering > filters DLQ jobs by search query
  ✓ DLQ Listing & Filtering > rejects DLQ listing for unauthorized user with 403 Forbidden
  ✓ DLQ Inspection > inspects a DLQ job returning snapshot, execution history, and logs
  ✓ DLQ Inspection > returns 404 for non-existent DLQ record
  ✓ DLQ Statistics > returns dashboard-ready DLQ statistics with breakdowns
  ✓ DLQ Statistics > returns queue-scoped DLQ statistics via /api/v1/queues/:queueId/dlq/stats
  ✓ DLQ Job Re-queue (Retry) > re-queues a dead job back to pending state and updates DLQ status to retried
  ✓ DLQ Job Archive & Delete > archives a DLQ job
  ✓ DLQ Job Archive & Delete > permanently deletes a DLQ job

Test Files  1 passed (1)
     Tests  11 passed (11)
```
