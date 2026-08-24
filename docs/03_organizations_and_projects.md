# Step 3: Organization & Project Management

## Overview

The organization and project management system establishes tenant boundaries and resource isolation. Users interact with queues, jobs, and workers strictly within the boundaries of projects and organizations they have been authorized to access.

---

## 1. Multi-Tenant Resource Hierarchy

```
Organization ("Acme Corp")
    ├── Member (Alice - OWNER)
    ├── Member (Bob - ADMIN)
    ├── Member (Charlie - MEMBER)
    └── Projects
          ├── Project 1 ("Production Payments")
          │     ├── Queue 1 ("card-charges")
          │     ├── Queue 2 ("refunds")
          │     └── Workers (Worker-01, Worker-02)
          └── Project 2 ("Data Pipeline")
                ├── Queue 1 ("nightly-etl")
                └── Workers (Worker-03)
```

---

## 2. Organization Management

### 1. Create Organization

- **`POST /api/v1/orgs`**
- **Body**: `{ "name": "Acme Corp", "slug": "acme-corp" }`
- **Behavior**: Atomically creates the organization and assigns the requesting user as `OWNER`.
- **Response `201 Created`**.

### 2. Get Organization

- **`GET /api/v1/orgs/:orgId`**
- **Permission**: `VIEWER` or higher.
- **Response `200 OK`**: Returns organization details and member count.

### 3. Update Organization

- **`PATCH /api/v1/orgs/:orgId`**
- **Permission**: `ADMIN` or `OWNER`.
- **Body**: `{ "name": "Acme Global" }`

---

## 3. Project Management

### 1. Create Project

- **`POST /api/v1/projects`**
- **Permission**: `ADMIN` or `OWNER` on target organization.
- **Body**:
  ```json
  {
    "organizationId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "name": "Payments Service",
    "slug": "payments-service",
    "description": "Production billing workflows"
  }
  ```

### 2. List Projects

- **`GET /api/v1/projects`**
- **Query Parameters**:
  - `organizationId`: (Optional) Filter by specific organization.
  - `page`: Page number (default: `1`).
  - `pageSize`: Page size (default: `20`).
- **Response `200 OK`**: Returns paginated list of projects accessible to the user.

### 3. Get Project

- **`GET /api/v1/projects/:projectId`**
- **Permission**: `VIEWER` or higher.
- **Response `200 OK`**: Returns project details and organization metadata.

### 4. Update Project

- **`PATCH /api/v1/projects/:projectId`**
- **Permission**: `ADMIN` or `OWNER`.
- **Body**: `{ "name": "Updated Name", "description": "New description" }`

### 5. Safe Delete Project

- **`DELETE /api/v1/projects/:projectId`**
- **Permission**: `ADMIN` or `OWNER`.
- **Safety Guard**: Checks whether any active/running queues exist before deletion. Rejects unsafe deletion with `400 Bad Request` if queues are active.
