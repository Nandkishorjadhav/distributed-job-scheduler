# REST API Standards, Request IDs & OpenAPI Specification

## Overview

The Distributed Job Scheduler REST API conforms to strict industry standards for URI naming, HTTP status codes, request/response validation, correlation ID tracking, structured error envelopes, and automated OpenAPI 3.0.3 documentation.

---

## 1. Request Correlation IDs (`X-Request-Id`)

Every request processed by the API gateway is assigned a unique UUIDv4 correlation ID:

- If the incoming client request provides an `X-Request-Id` or `X-Correlation-Id` header, that value is preserved.
- If omitted, the server generates a new UUIDv4 identifier.
- The correlation ID is echoed in the `X-Request-Id` response header and included in all JSON response and error payloads (`requestId`).
- Structured server logs attach `requestId` to every logged event for distributed request tracing.

---

## 2. Standardized Response Formats

### 1. Success Envelope

```json
{
  "success": true,
  "message": "Optional human-readable description of outcome",
  "data": { ... },
  "requestId": "4fa85f64-5717-4562-b3fc-2c963f66afa6"
}
```

### 2. Paginated Success Envelope

```json
{
  "success": true,
  "data": [ ... ],
  "pagination": {
    "total": 150,
    "page": 1,
    "pageSize": 20,
    "totalPages": 8
  },
  "requestId": "4fa85f64-5717-4562-b3fc-2c963f66afa6"
}
```

### 3. Error Envelope

```json
{
  "success": false,
  "error": "Validation failed",
  "code": "VALIDATION_ERROR",
  "details": [
    {
      "code": "invalid_type",
      "expected": "string",
      "received": "undefined",
      "path": ["email"],
      "message": "Required"
    }
  ],
  "requestId": "4fa85f64-5717-4562-b3fc-2c963f66afa6"
}
```

---

## 3. Standardized HTTP Status Codes

|   Code    | Status                  | Meaning & Use Case                                                                    |
| :-------: | :---------------------- | :------------------------------------------------------------------------------------ |
| **`200`** | `OK`                    | Standard successful retrieval, modification, or action execution.                     |
| **`201`** | `Created`               | Successful resource creation (`POST /api/v1/jobs`, `/queues`, `/projects`, `/orgs`).  |
| **`400`** | `Bad Request`           | Validation failure or illegal state machine transition.                               |
| **`401`** | `Unauthorized`          | Missing, expired, or invalid JWT Bearer token.                                        |
| **`403`** | `Forbidden`             | Insufficient RBAC permissions or attempting to access another tenant's project/queue. |
| **`404`** | `Not Found`             | Target resource UUID does not exist.                                                  |
| **`409`** | `Conflict`              | Unique constraint violation (e.g. duplicate email or project slug).                   |
| **`429`** | `Too Many Requests`     | Rate limit threshold exceeded.                                                        |
| **`500`** | `Internal Server Error` | Unexpected server or database exception.                                              |

---

## 4. Query Parameter Conventions

| Parameter   | Type      | Default | Description                                |
| :---------- | :-------- | :-----: | :----------------------------------------- |
| `page`      | `integer` |   `1`   | Page number for pagination (1-indexed).    |
| `pageSize`  | `integer` |  `20`   | Number of items per page (maximum: `100`). |
| `projectId` | `UUID`    | `null`  | Tenant project scoping filter.             |
| `queueId`   | `UUID`    | `null`  | Queue scoping filter.                      |
| `status`    | `string`  | `null`  | Filter by job, queue, or worker status.    |
| `search`    | `string`  | `null`  | Case-insensitive substring search.         |

---

## 5. OpenAPI 3.0.3 Specification & Interactive Documentation

The full OpenAPI 3.0.3 specification is served dynamically from the API server:

- **Raw JSON Spec**: [`GET /api/v1/openapi.json`](file:///d:/Job%20Scheduler/backend/api/src/openapi.json)
- **YAML Spec**: [`docs/openapi.yaml`](file:///d:/Job%20Scheduler/docs/openapi.yaml)
- **Interactive Swagger UI**: `GET /api/v1/docs` (interactive browser exploration)

---

## 6. Automated Test Results

Ran `npx vitest run api/api_standards.test.ts`:

```text
✓ api/api_standards.test.ts (7 tests)
  ✓ 1. Request Correlation IDs (X-Request-Id) > generates a unique UUID X-Request-Id header when not provided by client
  ✓ 1. Request Correlation IDs (X-Request-Id) > preserves and echoes client-supplied X-Request-Id header
  ✓ 1. Request Correlation IDs (X-Request-Id) > includes requestId in error responses for easy tracing
  ✓ 2. OpenAPI Specification & Interactive Docs > serves OpenAPI 3.0.3 JSON specification at /api/v1/openapi.json
  ✓ 2. OpenAPI Specification & Interactive Docs > serves Swagger UI interactive HTML documentation at /api/v1/docs
  ✓ 3. Standardized Error Response Formats > returns standardized 401 Unauthorized for missing authentication
  ✓ 3. Standardized Error Response Formats > returns standardized 404 Not Found for non-existent routes outside api prefix

Test Files  1 passed (1)
     Tests  7 passed (7)
```
