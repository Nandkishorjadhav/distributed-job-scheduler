# Step 4: Queue Management System

## Overview

Queues are the primary unit of throughput control and isolation. Each project can contain multiple queues with distinct priorities, concurrency limits, retry policies, and dead-letter queue configurations.

---

## 1. Queue Properties & Configuration

| Property | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Unique queue name within the project (e.g. `high-priority-emails`). |
| `priority` | `smallint` (1-10) | Queue priority level. Lower numeric values (e.g. `1`) or higher job priority determine evaluation order. |
| `concurrency_limit` | `integer` | Maximum simultaneous `running` jobs allowed across all workers for this queue. |
| `retry_policy_id` | `UUID` (optional) | Reference to reusable `retry_policies` configuration. |
| `dlq_enabled` | `boolean` | When true, exhausted failed jobs automatically snapshot into `dead_letter_jobs`. |
| `status` | `queue_status` | `active` (normal operation), `paused` (workers skip claiming), `archived`. |
| `paused_at` | `timestamp` | Timestamp when queue was paused. |

---

## 2. Real-Time Queue Statistics

The `QueueRepository.getStats(queueId)` method computes real-time status breakdowns across active jobs:

```json
{
  "queueId": "8b5ea0dc-4746-460d-9e3e-b58e0b051dab",
  "name": "email-queue",
  "status": "active",
  "priority": 5,
  "concurrencyLimit": 10,
  "stats": {
    "totalJobs": 150,
    "pendingJobs": 20,
    "runningJobs": 8,
    "completedJobs": 115,
    "failedJobs": 4,
    "deadJobs": 2,
    "cancelledJobs": 1
  }
}
```

---

## 3. REST Endpoints

### 1. Create Queue
- **`POST /api/v1/queues`**
- **Permission**: `MEMBER` or higher.
- **Body**:
  ```json
  {
    "projectId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "name": "transaction-webhooks",
    "priority": 3,
    "concurrencyLimit": 25,
    "dlqEnabled": true
  }
  ```
- **Response `201 Created`**.

### 2. List Queues
- **`GET /api/v1/queues`**
- **Query Parameters**: `projectId` (optional), `page`, `pageSize`.
- **Response `200 OK`**: Returns paginated list of queues with configuration.

### 3. Get Queue Details
- **`GET /api/v1/queues/:queueId`**
- **Response `200 OK`**: Returns queue configuration and parent project ID.

### 4. Update Queue
- **`PATCH /api/v1/queues/:queueId`**
- **Permission**: `MEMBER` or higher.
- **Body**: `{ "priority": 2, "concurrencyLimit": 50 }`

### 5. Pause Queue
- **`POST /api/v1/queues/:queueId/pause`**
- **Behavior**: Sets `status = 'paused'` and `paused_at = NOW()`. Workers immediately stop claiming new jobs from this queue. In-flight running jobs finish normally.

### 6. Resume Queue
- **`POST /api/v1/queues/:queueId/resume`**
- **Behavior**: Sets `status = 'active'` and `paused_at = NULL`. Workers resume claiming jobs.

### 7. Safe Delete Queue
- **`DELETE /api/v1/queues/:queueId`**
- **Permission**: `ADMIN` or `OWNER`.
- **Safety Guard**: Rejects deletion if any active (`running` or `pending`) jobs exist.

### 8. Queue Statistics
- **`GET /api/v1/queues/:queueId/stats`**
- **Response `200 OK`**: Returns live counters for queued, running, completed, failed, and dead jobs.
