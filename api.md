# Distributed Job Scheduler — Complete REST API Documentation

Comprehensive reference documentation for all REST API endpoints of the Distributed Job Scheduler platform.

---

## Table of Contents

1. [General Architecture & Conventions](#1-general-architecture--conventions)
2. [Authentication & System Health](#2-authentication--system-health)
3. [Organizations](#3-organizations)
4. [Projects](#4-projects)
5. [Queues](#5-queues)
6. [Jobs (Submission, Batches & Cron Schedules)](#6-jobs-submission-batches--cron-schedules)
7. [Job Executions, Logs & History](#7-job-executions-logs--history)
8. [Worker Nodes & Telemetry](#8-worker-nodes--telemetry)
9. [Dead Letter Queue (DLQ)](#9-dead-letter-queue-dlq)
10. [Metrics, Telemetry & Prometheus](#10-metrics-telemetry--prometheus)

---

## 1. General Architecture & Conventions

### Base URL

```text
http://localhost:3000/api/v1
```

### Authentication Header

Every authenticated endpoint supports either JWT Bearer tokens or API Keys:

- **JWT Token**: `Authorization: Bearer <jwt-token>`
- **API Key**: `x-api-key: <sha256-hashed-api-key>`

### Standard Success Response Envelope

```json
{
  "success": true,
  "data": { ... },
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 45,
    "totalPages": 3
  }
}
```

### Standard Error Response Envelope

```json
{
  "success": false,
  "error": "Human readable error description",
  "code": "ERROR_CODE_ENUM",
  "details": [ ... ],
  "requestId": "6cc05fda-ede3-4427-9161-7d26bd3780f4"
}
```

### Common HTTP Status Codes

| Code                      | Meaning               | Typical Usage                              |
| ------------------------- | --------------------- | ------------------------------------------ |
| `200 OK`                  | Request succeeded     | Retrieval, updates, and cancellations      |
| `201 Created`             | Resource created      | Registrations, submissions, and insertions |
| `400 Bad Request`         | Validation failure    | Missing fields or malformed payload        |
| `401 Unauthorized`        | Unauthenticated       | Missing or expired token / API key         |
| `403 Forbidden`           | Authorization failure | Insufficient tenant or organization role   |
| `404 Not Found`           | Resource missing      | Invalid UUID or entity not in tenant       |
| `409 Conflict`            | Unique constraint     | Duplicate email, slug, or queue name       |
| `500 Server Error`        | Unhandled failure     | Internal server or database error          |
| `503 Service Unavailable` | Health check failed   | Database or Redis unreachable              |

---

## 2. Authentication & System Health

### 2.1 Register User

Create a new user account and obtain an initial JWT token.

- **Method**: `POST`
- **URL**: `/auth/register`
- **Auth Required**: No (Public)
- **Request Body**:
  | Field      | Type     | Required | Description                              |
  | ---------- | -------- | -------- | ---------------------------------------- |
  | `email`    | `string` | Yes      | Valid email format (`admin@example.com`) |
  | `password` | `string` | Yes      | Min 8 characters, max 128 characters     |
  | `name`     | `string` | Yes      | Full display name (1-128 chars)          |
- **Success Response** (`201 Created`):
  ```json
  {
    "success": true,
    "data": {
      "user": {
        "id": "764beae8-9892-4ce0-8d59-21b9fe25bbef",
        "email": "admin@example.com",
        "name": "Admin User",
        "isActive": true,
        "createdAt": "2026-08-23T15:00:00.000Z"
      },
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
  }
  ```
- **Error Responses**:
  - `400 Bad Request` (`VALIDATION_ERROR`): Missing required fields or password under 8 characters.
  - `409 Conflict` (`USER_ALREADY_EXISTS`): Email is already registered.
- **Example Request**:
  ```bash
  curl -X POST http://localhost:3000/api/v1/auth/register \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@example.com","password":"Password123!","name":"Admin User"}'
  ```

---

### 2.2 Login

Authenticate with email and password to receive a JWT session token.

- **Method**: `POST`
- **URL**: `/auth/login`
- **Auth Required**: No (Public)
- **Request Body**:
  | Field      | Type     | Required | Description   |
  | ---------- | -------- | -------- | ------------- |
  | `email`    | `string` | Yes      | User email    |
  | `password` | `string` | Yes      | User password |
- **Success Response** (`200 OK`):
  ```json
  {
    "success": true,
    "data": {
      "user": {
        "id": "764beae8-9892-4ce0-8d59-21b9fe25bbef",
        "email": "admin@example.com",
        "name": "Admin User"
      },
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
  }
  ```
- **Error Responses**:
  - `401 Unauthorized` (`INVALID_CREDENTIALS`): Email not found or password incorrect.
  - `403 Forbidden` (`ACCOUNT_INACTIVE`): Account has been deactivated.
- **Example Request**:
  ```bash
  curl -X POST http://localhost:3000/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@example.com","password":"Password123!"}'
  ```

---

### 2.3 Get Current User Profile

Retrieve user details and authorized organization roles for the authenticated session.

- **Method**: `GET`
- **URL**: `/auth/me`
- **Auth Required**: Yes (`Bearer <token>` or `x-api-key`)
- **Success Response** (`200 OK`):
  ```json
  {
    "success": true,
    "data": {
      "id": "764beae8-9892-4ce0-8d59-21b9fe25bbef",
      "email": "admin@example.com",
      "name": "Admin User",
      "isActive": true,
      "createdAt": "2026-08-23T15:00:00.000Z"
    }
  }
  ```
- **Example Request**:
  ```bash
  curl -X GET http://localhost:3000/api/v1/auth/me \
    -H "Authorization: Bearer <jwt-token>"
  ```

---

### 2.4 Logout

Invalidate current session on client.

- **Method**: `POST`
- **URL**: `/auth/logout`
- **Auth Required**: Yes
- **Success Response** (`200 OK`):
  ```json
  {
    "success": true,
    "message": "Logged out successfully"
  }
  ```

---

### 2.5 Health Check

Live readiness and liveness probe verifying PostgreSQL and Redis connectivity.

- **Method**: `GET`
- **URL**: `/health`
- **Auth Required**: No (Public)
- **Success Response** (`200 OK`):
  ```json
  {
    "status": "healthy",
    "timestamp": "2026-08-23T16:00:00.000Z",
    "version": "1.0.0",
    "database": {
      "status": "connected",
      "latencyMs": 1.2
    },
    "redis": {
      "status": "connected",
      "latencyMs": 0.8
    }
  }
  ```
- **Error Response** (`503 Service Unavailable`): Returned if PostgreSQL `SELECT 1` or Redis `PING` fails.

---

## 3. Organizations

### 3.1 Create Organization

- **Method**: `POST`
- **URL**: `/orgs`
- **Auth Required**: Yes
- **Request Body**:
  | Field  | Type     | Required | Description                             |
  | ------ | -------- | -------- | --------------------------------------- |
  | `name` | `string` | Yes      | Organization display name (1-128 chars) |
  | `slug` | `string` | Yes      | URL-safe slug (e.g. `acme-corp`)        |
- **Success Response** (`201 Created`):
  ```json
  {
    "success": true,
    "data": {
      "organization": {
        "id": "e4b6c8d2-4301-4475-8120-d336a992e591",
        "name": "Acme Corp",
        "slug": "acme-corp",
        "role": "owner",
        "isActive": true,
        "createdAt": "2026-08-23T15:05:00.000Z",
        "updatedAt": "2026-08-23T15:05:00.000Z"
      }
    }
  }
  ```
- **Error Responses**:
  - `409 Conflict` (`ORG_SLUG_EXISTS`): Organization slug is already taken.

---

### 3.2 List User Organizations

- **Method**: `GET`
- **URL**: `/orgs`
- **Auth Required**: Yes
- **Query Parameters**:
  - `page` (`integer`, optional, default: 1)
  - `pageSize` (`integer`, optional, default: 20)
- **Success Response** (`200 OK`):
  ```json
  {
    "success": true,
    "data": {
      "organizations": [
        {
          "id": "e4b6c8d2-4301-4475-8120-d336a992e591",
          "name": "Acme Corp",
          "slug": "acme-corp",
          "role": "owner",
          "isActive": true
        }
      ]
    }
  }
  ```

---

### 3.3 Get Organization Details

- **Method**: `GET`
- **URL**: `/orgs/:orgId`
- **Path Parameters**: `orgId` (UUID)
- **Auth Required**: Yes

---

### 3.4 Update Organization

- **Method**: `PATCH`
- **URL**: `/orgs/:orgId`
- **Auth Required**: Yes (Owner or Admin role required)
- **Request Body**:
  | Field      | Type      | Required | Description                      |
  | ---------- | --------- | -------- | -------------------------------- |
  | `name`     | `string`  | Optional | Updated organization name        |
  | `isActive` | `boolean` | Optional | Activate/deactivate organization |

---

## 4. Projects

### 4.1 Create Project

- **Method**: `POST`
- **URL**: `/projects`
- **Auth Required**: Yes
- **Request Body**:
  | Field            | Type     | Required | Description                       |
  | ---------------- | -------- | -------- | --------------------------------- |
  | `organizationId` | `UUID`   | Yes      | Parent organization ID            |
  | `name`           | `string` | Yes      | Project name (1-128 chars)        |
  | `slug`           | `string` | Yes      | URL-safe slug within organization |
  | `description`    | `string` | Optional | Project description               |
- **Success Response** (`201 Created`):
  ```json
  {
    "success": true,
    "data": {
      "project": {
        "id": "31fe1128-5690-4822-b5e0-5cfbe3ea007b",
        "organizationId": "e4b6c8d2-4301-4475-8120-d336a992e591",
        "name": "Core Platform",
        "slug": "core-platform",
        "description": "Production jobs and processing",
        "status": "active",
        "createdAt": "2026-08-23T15:10:00.000Z"
      }
    }
  }
  ```

---

### 4.2 List Projects

- **Method**: `GET`
- **URL**: `/projects`
- **Auth Required**: Yes
- **Query Parameters**:
  - `organizationId` (`UUID`, optional): Filter projects by organization.
  - `search` (`string`, optional): Search projects by name.
  - `page` (`integer`, default: 1)
  - `pageSize` (`integer`, default: 20)

---

### 4.3 Get, Update & Delete Project

- **GET** `/projects/:projectId`: Get project info.
- **PATCH** `/projects/:projectId`: Update name, description, or status (`active`, `archived`).
- **DELETE** `/projects/:projectId`: Soft-delete/archive project and associated queues.

---

## 5. Queues

### 5.1 Create Queue

- **Method**: `POST`
- **URL**: `/queues`
- **Auth Required**: Yes
- **Request Body**:
  | Field              | Type      | Required | Description                                                                                                                                     |
  | ------------------ | --------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
  | `projectId`        | `UUID`    | Yes      | Parent project ID                                                                                                                               |
  | `name`             | `string`  | Yes      | Queue name (1-128 chars)                                                                                                                        |
  | `priority`         | `integer` | Optional | Default priority 1-10 (default: 5)                                                                                                              |
  | `concurrencyLimit` | `integer` | Optional | Max concurrent running jobs (default: 10)                                                                                                       |
  | `dlqEnabled`       | `boolean` | Optional | Enable Dead Letter Queue on exhaustion (default: true)                                                                                          |
  | `retryPolicy`      | `object`  | Optional | Strategy (`exponential`/`fixed`/`linear`), `maxAttempts` (default: 3), `initialDelayMs` (1000), `maxDelayMs` (60000), `backoffMultiplier` (2.0) |
- **Success Response** (`201 Created`):
  ```json
  {
    "success": true,
    "data": {
      "queue": {
        "id": "8a09f35c-2015-4674-a63e-79db04b901f4",
        "projectId": "31fe1128-5690-4822-b5e0-5cfbe3ea007b",
        "name": "image-processing",
        "priority": 5,
        "concurrencyLimit": 10,
        "status": "active",
        "dlqEnabled": true,
        "createdAt": "2026-08-23T15:15:00.000Z"
      }
    }
  }
  ```

---

### 5.2 List Queues

- **Method**: `GET`
- **URL**: `/queues`
- **Auth Required**: Yes
- **Query Parameters**:
  - `projectId` (`UUID`, optional)
  - `status` (`active` \| `paused` \| `archived`, optional)
  - `search` (`string`, optional)
  - `page` (`integer`, default: 1)
  - `pageSize` (`integer`, default: 20)

---

### 5.3 Pause & Resume Queue

- **POST** `/queues/:queueId/pause`: Suspends job claiming on this queue. In-flight jobs finish cleanly.
- **POST** `/queues/:queueId/resume`: Resumes job claiming.

---

### 5.4 Get Queue Statistics

- **Method**: `GET`
- **URL**: `/queues/:queueId/stats`
- **Auth Required**: Yes
- **Success Response** (`200 OK`):
  ```json
  {
    "success": true,
    "data": {
      "queueId": "8a09f35c-2015-4674-a63e-79db04b901f4",
      "pendingCount": 14,
      "runningCount": 6,
      "completedCount": 250,
      "failedCount": 2,
      "deadCount": 1,
      "paused": false
    }
  }
  ```

---

## 6. Jobs (Submission, Batches & Cron Schedules)

### 6.1 Submit Single Job

Submit a job to a queue for immediate or scheduled execution.

- **Method**: `POST`
- **URL**: `/queues/:queueId/jobs` _(or `/jobs` specifying `queueId` in body)_
- **Auth Required**: Yes
- **Request Body**:
  | Field         | Type       | Required | Description                                           |
  | ------------- | ---------- | -------- | ----------------------------------------------------- |
  | `name`        | `string`   | Yes      | Handler job name (e.g. `image-resize`)                |
  | `type`        | `string`   | Optional | `immediate` (default) or `scheduled`                  |
  | `payload`     | `object`   | Optional | JSON payload passed to worker handler (default: `{}`) |
  | `priority`    | `integer`  | Optional | 1 (lowest) to 10 (highest), default: 5                |
  | `maxAttempts` | `integer`  | Optional | Max execution tries before failing/DLQ (default: 3)   |
  | `timeoutMs`   | `integer`  | Optional | Handler execution timeout in ms (e.g. `10000`)        |
  | `scheduledAt` | `ISO Date` | Optional | Execute at a future timestamp                         |
- **Success Response** (`201 Created`):
  ```json
  {
    "success": true,
    "data": {
      "id": "e7b0d912-70b1-4770-bc2f-6821213f59e8",
      "queueId": "8a09f35c-2015-4674-a63e-79db04b901f4",
      "name": "image-resize",
      "type": "immediate",
      "status": "pending",
      "payload": {
        "imageId": "img_9941",
        "format": "webp"
      },
      "priority": 8,
      "attemptCount": 0,
      "maxAttempts": 3,
      "enqueuedAt": "2026-08-23T15:20:00.000Z"
    }
  }
  ```

---

### 6.2 Submit Batch of Jobs

Atomically submit up to 1,000 jobs linked by a common `batchGroupId`.

- **Method**: `POST`
- **URL**: `/queues/:queueId/batch`
- **Auth Required**: Yes
- **Request Body**:
  | Field         | Type                     | Required | Description                     |
  | ------------- | ------------------------ | -------- | ------------------------------- |
  | `name`        | `string`                 | Yes      | Batch label/name (1-256 chars)  |
  | `description` | `string`                 | Optional | Description of the batch        |
  | `jobs`        | `Array<SubmitJobSchema>` | Yes      | Array of 1 to 1,000 job objects |
- **Success Response** (`201 Created`):
  ```json
  {
    "success": true,
    "data": {
      "batchGroupId": "fa3b2110-449e-4b91-a1dc-1188339900aa",
      "totalJobs": 50,
      "jobs": [ ... ]
    }
  }
  ```

---

### 6.3 Create Recurring (Cron) Job

Configure a recurring job template scheduled via standard 5-part cron expressions.

- **Method**: `POST`
- **URL**: `/queues/:queueId/recurring`
- **Auth Required**: Yes
- **Request Body**:
  | Field             | Type      | Required | Description                                                  |
  | ----------------- | --------- | -------- | ------------------------------------------------------------ |
  | `name`            | `string`  | Yes      | Job template name                                            |
  | `cronExpression`  | `string`  | Yes      | Standard 5-field cron (e.g. `*/10 * * * *` for every 10 min) |
  | `timezone`        | `string`  | Optional | Default: `UTC`                                               |
  | `payloadTemplate` | `object`  | Optional | Default payload template                                     |
  | `priority`        | `integer` | Optional | Default: 5                                                   |
  | `maxAttempts`     | `integer` | Optional | Default: 3                                                   |
  | `enabled`         | `boolean` | Optional | Default: `true`                                              |
  | `skipIfRunning`   | `boolean` | Optional | Skip firing if a previous run is active (default: `true`)    |
- **Success Response** (`201 Created`):
  ```json
  {
    "success": true,
    "data": {
      "id": "5500c228-6622-4911-aa99-dd4411ee66aa",
      "queueId": "8a09f35c-2015-4674-a63e-79db04b901f4",
      "name": "nightly-cleanup",
      "cronExpression": "0 2 * * *",
      "nextRunAt": "2026-08-24T02:00:00.000Z",
      "enabled": true
    }
  }
  ```

---

### 6.4 List Jobs with Filtering & Pagination

- **Method**: `GET`
- **URL**: `/jobs` _(or `/queues/:queueId/jobs`)_
- **Auth Required**: Yes
- **Query Parameters**:
  - `queueId` (`UUID`, optional)
  - `projectId` (`UUID`, optional)
  - `status` (`pending` \| `running` \| `completed` \| `failed` \| `dead` \| `cancelled`, optional)
  - `type` (`immediate` \| `scheduled` \| `cron`, optional)
  - `search` (`string`, optional): Search job names.
  - `page` (`integer`, default: 1)
  - `pageSize` (`integer`, default: 20)
- **Success Response** (`200 OK`):
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "e7b0d912-70b1-4770-bc2f-6821213f59e8",
        "name": "image-resize",
        "status": "completed",
        "priority": 8,
        "attemptCount": 1,
        "maxAttempts": 3,
        "enqueuedAt": "2026-08-23T15:20:00.000Z",
        "startedAt": "2026-08-23T15:20:01.000Z",
        "finishedAt": "2026-08-23T15:20:01.250Z"
      }
    ],
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 1,
      "totalPages": 1
    }
  }
  ```

---

### 6.5 Cancel Job

- **Method**: `POST` (or `DELETE`)
- **URL**: `/jobs/:jobId/cancel`
- **Auth Required**: Yes
- **Success Response** (`200 OK`): Cancels pending or scheduled job. Returns updated job with `status = 'cancelled'`.

---

### 6.6 Retry Failed or Dead Job

- **Method**: `POST`
- **URL**: `/jobs/:jobId/retry`
- **Auth Required**: Yes
- **Success Response** (`200 OK`): Resets attempt counter, schedules for immediate execution, and sets status back to `pending`.

---

## 7. Job Executions, Logs & History

### 7.1 Get Job Execution Attempts

Inspect individual attempt runs, worker IDs, durations, and attempt-level error messages.

- **Method**: `GET`
- **URL**: `/jobs/:jobId/executions`
- **Auth Required**: Yes
- **Success Response** (`200 OK`):
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "9933bb11-33aa-44ee-8811-33221100aaee",
        "jobId": "e7b0d912-70b1-4770-bc2f-6821213f59e8",
        "workerId": "6b6b93a0-f739-40c7-b064-789c390b4bf5",
        "attemptNumber": 1,
        "status": "failed",
        "startedAt": "2026-08-23T15:20:01.000Z",
        "finishedAt": "2026-08-23T15:20:01.500Z",
        "errorMessage": "Remote connection timed out",
        "errorCode": "TIMEOUT_ERROR"
      },
      {
        "id": "aa11cc22-55dd-44ee-9922-44332211bbff",
        "jobId": "e7b0d912-70b1-4770-bc2f-6821213f59e8",
        "workerId": "f15dccd5-19b6-4ad1-b8ad-a533b6c5100b",
        "attemptNumber": 2,
        "status": "completed",
        "startedAt": "2026-08-23T15:20:03.000Z",
        "finishedAt": "2026-08-23T15:20:03.200Z",
        "result": { "processed": true, "bytes": 1048576 }
      }
    ]
  }
  ```

---

### 7.2 Get Job Logs

- **Method**: `GET`
- **URL**: `/jobs/:jobId/logs`
- **Auth Required**: Yes
- **Success Response** (`200 OK`): Returns chronological logs produced by worker `context.log()` during execution.

---

### 7.3 Get Full Job History

- **Method**: `GET`
- **URL**: `/jobs/:jobId/history`
- **Auth Required**: Yes
- **Success Response** (`200 OK`): Composite endpoint returning job definition, queue metadata, all execution attempt records, and full stdout/stderr log stream in one call.

---

## 8. Worker Nodes & Telemetry

### 8.1 Register Worker Process

Workers call this upon startup to register their hostname, PID, concurrency capacity, and assigned project.

- **Method**: `POST`
- **URL**: `/workers/register`
- **Auth Required**: Yes (API key or Token with Worker scope)
- **Request Body**:
  | Field            | Type      | Required | Description                      |
  | ---------------- | --------- | -------- | -------------------------------- |
  | `projectId`      | `UUID`    | Yes      | Tenant project ID                |
  | `hostname`       | `string`  | Yes      | Machine hostname                 |
  | `pid`            | `integer` | Yes      | Operating system process ID      |
  | `maxConcurrency` | `integer` | Optional | Max concurrent jobs (default: 5) |
  | `version`        | `string`  | Optional | Worker build version             |
- **Success Response** (`201 Created`):
  ```json
  {
    "success": true,
    "data": {
      "id": "6b6b93a0-f739-40c7-b064-789c390b4bf5",
      "projectId": "31fe1128-5690-4822-b5e0-5cfbe3ea007b",
      "hostname": "worker-node-01",
      "pid": 4012,
      "status": "online",
      "maxConcurrency": 5,
      "currentJobCount": 0,
      "lastHeartbeatAt": "2026-08-23T15:25:00.000Z"
    }
  }
  ```

---

### 8.2 Send Worker Heartbeat

- **Method**: `POST`
- **URL**: `/workers/:workerId/heartbeat`
- **Auth Required**: Yes
- **Request Body**:
  | Field             | Type      | Required | Description                                   |
  | ----------------- | --------- | -------- | --------------------------------------------- |
  | `status`          | `string`  | Optional | `online` \| `busy` \| `draining` \| `stopped` |
  | `currentJobCount` | `integer` | Optional | Active in-flight jobs count                   |

---

### 8.3 List Workers

- **Method**: `GET`
- **URL**: `/workers`
- **Auth Required**: Yes
- **Query Parameters**:
  - `projectId` (`UUID`, optional)
  - `status` (`online` \| `busy` \| `unhealthy` \| `stopped`, optional)
  - `page` (`integer`, default: 1)
  - `pageSize` (`integer`, default: 20)

---

### 8.4 Stale Worker Scanner

Detects and transitions dead worker instances that missed heartbeats ($>30\text{s}$) to `unhealthy`.

- **Method**: `POST`
- **URL**: `/workers/stale/scan`
- **Auth Required**: Yes (Scoped to tenant projects)
- **Query Parameters**: `timeoutSeconds` (integer, default: 30)
- **Success Response** (`200 OK`): Returns count and list of reaped worker nodes.

---

## 9. Dead Letter Queue (DLQ)

### 9.1 List DLQ Quarantined Jobs

- **Method**: `GET`
- **URL**: `/dlq` _(or `/queues/:queueId/dlq`)_
- **Auth Required**: Yes
- **Query Parameters**:
  - `queueId` (`UUID`, optional)
  - `projectId` (`UUID`, optional)
  - `status` (`unhandled` \| `retried` \| `archived`, default: `unhandled`)
  - `search` (`string`, optional): Search by error message or job name.
  - `page` (`integer`, default: 1)
  - `pageSize` (`integer`, default: 20)
- **Success Response** (`200 OK`):
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "1dc01824-90d0-4445-8511-64a469104f49",
        "jobId": "f0e5204a-be6d-4717-8b54-fe769323fa82",
        "queueId": "8a09f35c-2015-4674-a63e-79db04b901f4",
        "queueName": "image-processing",
        "name": "image-resize",
        "payload": { "imageId": "corrupt_file_99" },
        "totalAttempts": 3,
        "finalErrorMessage": "Corrupt WebP header bytes",
        "finalErrorCode": "INVALID_IMAGE_PAYLOAD",
        "failedWorkerHostname": "worker-node-01",
        "status": "unhandled",
        "movedToDlqAt": "2026-08-23T15:30:00.000Z"
      }
    ]
  }
  ```

---

### 9.2 Replay / Requeue DLQ Job

Re-enqueues a quarantined DLQ job into its original queue as a fresh execution.

- **Method**: `POST`
- **URL**: `/dlq/:dlqId/retry`
- **Auth Required**: Yes
- **Success Response** (`200 OK`):
  ```json
  {
    "success": true,
    "data": {
      "dlqId": "1dc01824-90d0-4445-8511-64a469104f49",
      "requeuedJobId": "91823120-fa21-4112-bb91-00aa992211ee",
      "status": "retried"
    }
  }
  ```

---

### 9.3 Archive & Delete DLQ Job

- **POST** `/dlq/:dlqId/archive`: Marks DLQ job as `archived` without deletion.
- **DELETE** `/dlq/:dlqId`: Permanently purges DLQ record.

---

### 9.4 DLQ Dashboard Statistics

- **Method**: `GET`
- **URL**: `/dlq/stats` _(or `/queues/:queueId/dlq/stats`)_
- **Auth Required**: Yes
- **Success Response** (`200 OK`):
  ```json
  {
    "success": true,
    "data": {
      "totalDlqJobs": 24,
      "unhandledCount": 18,
      "retriedCount": 4,
      "archivedCount": 2,
      "byQueue": [
        {
          "queueId": "8a09f35c-2015-4674-a63e-79db04b901f4",
          "queueName": "image-processing",
          "count": 18
        }
      ],
      "topErrorCodes": [
        { "errorCode": "INVALID_IMAGE_PAYLOAD", "count": 14 },
        { "errorCode": "TIMEOUT_ERROR", "count": 4 }
      ]
    }
  }
  ```

---

## 10. Metrics, Telemetry & Prometheus

### 10.1 Get Aggregate System Telemetry

- **Method**: `GET`
- **URL**: `/metrics`
- **Auth Required**: Yes
- **Query Parameters**: `projectId` (`UUID`, optional)
- **Success Response** (`200 OK`):
  ```json
  {
    "success": true,
    "data": {
      "summary": {
        "totalJobs": 1250,
        "completedJobs": 1200,
        "failedJobs": 10,
        "deadJobs": 20,
        "pendingJobs": 15,
        "runningJobs": 5,
        "scheduledJobs": 2,
        "retryCount": 18,
        "dlqCount": 20
      },
      "workers": {
        "total": 5,
        "online": 4,
        "busy": 1,
        "unhealthy": 0,
        "stopped": 0,
        "totalConcurrencyCapacity": 25,
        "activeJobSlotsUsed": 5
      },
      "executionDuration": {
        "minDurationMs": 4.5,
        "avgDurationMs": 24.8,
        "p50DurationMs": 18.2,
        "p95DurationMs": 55.4,
        "p99DurationMs": 112.0
      },
      "queueDepths": [
        {
          "queueId": "8a09f35c-2015-4674-a63e-79db04b901f4",
          "queueName": "image-processing",
          "priority": 5,
          "concurrencyLimit": 10,
          "pendingCount": 15,
          "runningCount": 5,
          "status": "active"
        }
      ]
    }
  }
  ```

---

### 10.2 Queue Specific Metrics

- **Method**: `GET`
- **URL**: `/metrics/queues/:queueId`
- **Auth Required**: Yes
- **Success Response** (`200 OK`): Returns queue-specific percentile latencies, throughput rates, and backlog counts.

---

### 10.3 Prometheus Metrics Scraping Endpoint

Exposes live system metrics in Prometheus standard exposition text format for Grafana / Prometheus scrapers.

- **Method**: `GET`
- **URL**: `/metrics/prometheus`
- **Auth Required**: No (Standard metrics scraper endpoint)
- **Query Parameters**: `projectId` (`UUID`, optional)
- **Success Response** (`200 OK` text/plain):
  ```text
  # HELP job_scheduler_jobs_total Total jobs in the system by status
  # TYPE job_scheduler_jobs_total gauge
  job_scheduler_jobs_total{status="pending"} 15
  job_scheduler_jobs_total{status="running"} 5
  job_scheduler_jobs_total{status="completed"} 1200
  job_scheduler_jobs_total{status="failed"} 10
  job_scheduler_jobs_total{status="dead"} 20

  # HELP job_scheduler_workers_total Registered workers by status
  # TYPE job_scheduler_workers_total gauge
  job_scheduler_workers_total{status="online"} 4
  job_scheduler_workers_total{status="busy"} 1
  job_scheduler_workers_total{status="unhealthy"} 0

  # HELP job_scheduler_execution_duration_ms Job execution duration percentiles
  # TYPE job_scheduler_execution_duration_ms gauge
  job_scheduler_execution_duration_ms{quantile="0.5"} 18.2
  job_scheduler_execution_duration_ms{quantile="0.95"} 55.4
  job_scheduler_execution_duration_ms{quantile="0.99"} 112.0
  ```
