# Production Observability, Structured Logging & Metrics

## Overview

The **Distributed Job Scheduler** observability subsystem provides unified, production-grade telemetry across all nodes (API Gateway, Schedulers, and Distributed Workers). It incorporates structured JSON logging with end-to-end request/execution correlation IDs, aggregate and queue-scoped performance metrics, execution duration percentiles, worker health states, and standard Prometheus exposition.

---

## 1. Structured Logging & Correlation Tracing

### 1. Unified Context Fields

Every significant lifecycle event captures a standard set of correlation identifiers:

| Context Field       | Type      | Description                                     |
| :------------------ | :-------- | :---------------------------------------------- |
| **`requestId`**     | `UUID`    | HTTP request correlation ID from `X-Request-Id` |
| **`jobId`**         | `UUID`    | Unique job instance identifier                  |
| **`queueId`**       | `UUID`    | Parent queue identifier                         |
| **`projectId`**     | `UUID`    | Tenant project boundary                         |
| **`workerId`**      | `UUID`    | Active worker process node ID                   |
| **`executionId`**   | `UUID`    | Execution attempt record ID in `job_executions` |
| **`attemptNumber`** | `integer` | Current execution attempt counter               |
| **`durationMs`**    | `float`   | Wall-clock execution runtime in ms              |
| **`retryDelayMs`**  | `integer` | Calculated backoff delay before next attempt    |
| **`errorCode`**     | `string`  | Machine-readable error categorization code      |

---

### 2. Logged Lifecycle Events

```json
// Example: Production JSON Log Event (Job Claimed)
{
  "timestamp": "2026-08-23T07:56:40.012Z",
  "level": "info",
  "service": "job-scheduler",
  "message": "Job claimed by worker",
  "workerId": "4c65fb2f-a6f1-44a5-a59b-4986d5129e8f",
  "jobId": "7245189b-1920-400a-bdbd-d22577b66a0b",
  "queueId": "c26655d1-e915-4981-aee1-8238e2b10c13",
  "priority": 5,
  "attemptNumber": 1
}
```

```json
// Example: Production JSON Log Event (Job Retrying)
{
  "timestamp": "2026-08-23T07:56:40.114Z",
  "level": "warn",
  "service": "job-scheduler",
  "message": "Job execution failed — scheduled for retry",
  "workerId": "4c65fb2f-a6f1-44a5-a59b-4986d5129e8f",
  "jobId": "5e68ab49-3400-4bb1-a04a-707cfd111fa2",
  "queueId": "c26655d1-e915-4981-aee1-8238e2b10c13",
  "attemptNumber": 1,
  "retryDelayMs": 2000,
  "nextAttemptAt": "2026-08-23T07:56:42.028Z",
  "errorCode": "ERR_CONN_RESET"
}
```

---

## 2. Metrics Engine ([`MetricsRepository.ts`](file:///d:/Job%20Scheduler/backend/shared/src/db/repositories/MetricsRepository.ts))

The metrics repository computes high-performance aggregate telemetry across 4 core dimensions:

### 1. Job Summary Counters

- `totalJobs`: Cumulative count of all jobs created.
- `completedJobs`: Successfully executed jobs.
- `failedJobs`: In-flight jobs scheduled for retry.
- `deadJobs` / `dlqCount`: Permanently failed jobs moved to DLQ.
- `pendingJobs` & `runningJobs`: Active backlog and in-flight workloads.
- `retryCount`: Total number of retry attempts executed.

### 2. Execution Duration Percentiles

- Calculated over completed execution records:
  - `avgDurationMs`
  - `p50DurationMs` (Median)
  - `p95DurationMs` (95th Percentile)
  - `p99DurationMs` (99th Percentile)
  - `minDurationMs` & `maxDurationMs`

### 3. Worker Health Breakdown

- Counts of workers in `online`, `busy`, `unhealthy`, and `stopped` states.
- Total worker concurrency capacity vs. currently utilized execution slots.

### 4. Queue Depths

- Live breakdown of `pendingCount` and `runningCount` per individual queue.

---

## 3. Metrics REST Endpoints

| Method | Endpoint                          | Description                                                           |
| :----- | :-------------------------------- | :-------------------------------------------------------------------- |
| `GET`  | `/api/v1/metrics`                 | Returns full system/project metrics JSON envelope.                    |
| `GET`  | `/api/v1/metrics/queues/:queueId` | Returns metrics isolated to a specific queue.                         |
| `GET`  | `/api/v1/metrics/prometheus`      | Exports Prometheus text-format metrics (`text/plain; version=0.0.4`). |

---

## 4. Automated Test Results

Ran `npx vitest run api/metrics_observability.test.ts`:

```text
✓ api/metrics_observability.test.ts (5 tests)
  ✓ 1. Live System & Project Metrics API (GET /api/v1/metrics) > returns aggregate summary counters, worker health, and queue depths
  ✓ 1. Live System & Project Metrics API (GET /api/v1/metrics) > returns request correlation ID in metrics response
  ✓ 2. Queue-Scoped Metrics (GET /api/v1/metrics/queues/:queueId) > returns deep metrics isolated to target queue
  ✓ 2. Queue-Scoped Metrics (GET /api/v1/metrics/queues/:queueId) > returns 404 for non-existent queue ID
  ✓ 3. Prometheus Text Exposition (GET /api/v1/metrics/prometheus) > exports metrics formatted according to Prometheus exposition standard

Test Files  1 passed (1)
     Tests  5 passed (5)
```
