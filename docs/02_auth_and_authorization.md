# Step 2: Authentication & Authorization Module

## Overview

The authentication and authorization module secures all API access, validates incoming request payloads, hashes sensitive credentials using cryptographic algorithms, generates signed JSON Web Tokens (JWT), and enforces multi-tenant Role-Based Access Control (RBAC).

---

## 1. Authentication Architecture

```
Client Request
      │
      ▼
┌──────────────────────────────────────┐
│  Rate Limiter Middleware             │  Protects against brute-force attacks
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│  Authenticate Middleware             │  Extracts 'Authorization: Bearer <jwt>'
└──────────────────┬───────────────────┘
                   │
         ┌─────────┴─────────┐
         │                   │
      Valid               Invalid / Missing
         │                   │
         ▼                   ▼
┌─────────────────┐ ┌─────────────────────────┐
│ req.user = user │ │ 401 Unauthorized Response│
└────────┬────────┘ └─────────────────────────┘
         │
         ▼
┌──────────────────────────────────────┐
│  RBAC Check (checkOrgPermission)     │  Evaluates role: OWNER, ADMIN, MEMBER, VIEWER
└──────────────────┬───────────────────┘
                   │
         ┌─────────┴─────────┐
         │                   │
     Authorized          Forbidden
         │                   │
         ▼                   ▼
┌─────────────────┐ ┌─────────────────────────┐
│ Execute Handler │ │ 403 Forbidden Response  │
└─────────────────┘ └─────────────────────────┘
```

---

## 2. Cryptographic Security Standards

1. **Password Hashing**:
   - Implemented using **Argon2id** (with fallback to **bcrypt** with work factor 10).
   - Passwords are never stored or logged in plain text.
2. **Access Tokens**:
   - JSON Web Tokens (JWT) signed with HMAC-SHA256 (`JWT_SECRET`).
   - Token payload contains `{ id: user.id, email: user.email }`.
   - Default expiration: `7d` (configurable via `JWT_EXPIRES_IN`).
3. **Structured Validation**:
   - All input requests validated at the route boundary using Zod schemas (`RegisterSchema`, `LoginSchema`).

---

## 3. Role-Based Access Control (RBAC)

Organization membership assigns one of four hierarchical roles:

| Role | Hierarchy Level | Capabilities |
| :--- | :---: | :--- |
| **`OWNER`** | 4 | Full organization control, delete organization, billing, manage admins. |
| **`ADMIN`** | 3 | Manage projects, queues, workers, DLQ deletion, invite members. |
| **`MEMBER`** | 2 | Submit jobs, pause/resume queues, cancel/retry jobs, re-queue DLQ jobs. |
| **`VIEWER`** | 1 | Read-only access to projects, queues, jobs, executions, and metrics. |

---

## 4. REST Endpoints

### 1. Register User
- **`POST /api/v1/auth/register`**
- **Body**: `{ "email": "user@example.com", "password": "password123", "name": "Jane Doe" }`
- **Response `201 Created`**:
  ```json
  {
    "success": true,
    "message": "User registered successfully",
    "data": {
      "user": { "id": "...", "email": "user@example.com", "name": "Jane Doe" },
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6..."
    }
  }
  ```

### 2. Login User
- **`POST /api/v1/auth/login`**
- **Body**: `{ "email": "user@example.com", "password": "password123" }`
- **Response `200 OK`**: Returns user profile and JWT Bearer token.

### 3. Current User Endpoint
- **`GET /api/v1/auth/me`** (Protected)
- **Headers**: `Authorization: Bearer <token>`
- **Response `200 OK`**: Returns current authenticated user and organization memberships.

### 4. Logout User
- **`POST /api/v1/auth/logout`** (Protected)
- **Response `200 OK`**: Clears authentication cookies / session state.
