# React Operations Dashboard & Web UI

## Overview

The **Distributed Job Scheduler React Dashboard** is a production-grade operations console designed for DevOps engineers, system administrators, and developers to monitor, configure, inspect, and troubleshoot distributed queues, jobs, worker nodes, and dead-letter queues.

---

## 1. Supported Pages & Workflows

| Page | Route | Features & Capabilities |
| :--- | :--- | :--- |
| **1. Login & Sign Up** | `/login` | Tabbed login and registration, JWT authentication token persistence in `localStorage`, user session management. |
| **2. Dashboard Overview** | `/` | Live metric counters (Total, Running, Completed, Failed, Retrying, DLQ), duration percentiles chart (Min/p50/Avg/p95/p99), worker fleet capacity meters, queue depth breakdown, auto-refresh polling (5s). |
| **3. Projects & Orgs** | `/projects` & `/orgs` | Multi-tenant organization grouping, project CRUD, queue counts, slug metadata. |
| **4. Queues List** | `/queues` | Live queues table, priority badges (P1–P10), concurrency limits, pause/resume processing toggle, and queue creation modal. |
| **5. Queue Details** | `/queues/:queueId` | Queue breakdown banner (Pending, Running, Completed, DLQ), in-queue job filtering, direct job submission modal (Immediate / Delayed). |
| **6. Queue Configuration** | `/queues/:queueId/config` | Edit concurrency limit, priority, retry policy parameters (strategy: exponential/linear/fixed, max attempts, delays, jitter), DLQ toggle, and safe queue deletion. |
| **7. Jobs Explorer** | `/jobs` | Global jobs explorer with substring search, status filters, queue filters, pagination, priority sorting, cancel job, and retry job actions. |
| **8. Job Details & Inspector** | `/jobs/:jobId` | Lifecycle status timeline, attempt counter, payload viewer, execution result / error stack trace, chronological execution attempts history, and real-time log stream. |
| **9. Workers Fleet** | `/workers` | Real-time worker node health (`ONLINE`, `BUSY`, `UNHEALTHY`, `STOPPED`), concurrency slot utilization, relative heartbeat timer, stale worker scanner, worker stop button, and active job inspector modal. |
| **10. Dead Letter Queue** | `/dlq` | Quarantined dead jobs table, failure reason distribution, inspection modal with root-cause error code and payload, re-queue (retry), archive, and permanent deletion. |
| **11. Interactive API Docs**| `/api` & `/api/v1/docs` | Interactive Swagger UI API explorer powered by OpenAPI 3.0.3 specification. |

---

## 2. Real-Time Polling Strategy

- Initial real-time updates are driven by lightweight, configurable polling intervals (default: $5\text{ s}$) rather than heavy WebSocket connections.
- Reduces connection overhead, simplifies failover and load balancing behind standard reverse proxies (Nginx/Cloudflare), and provides deterministic cache invalidation with `@tanstack/react-query`.

---

## 3. UI Component Architecture

- **Styling**: TailwindCSS with dark-mode palette (`gray-950` / `gray-900` / `blue-600`).
- **Icons**: Lucide React (`Zap`, `Layers`, `Server`, `Skull`, `Activity`, `RotateCcw`, `CheckCircle`).
- **Charts**: Recharts (`BarChart`, `ResponsiveContainer`, `Tooltip`, `CartesianGrid`).
- **State Management**: React Context (`AuthContext`) and TanStack React Query for cached network state.

---

## 4. Quick Start: Launching the Frontend

```powershell
cd "d:\Job Scheduler\frontend"
npm run dev
```

Open your browser at: [http://localhost:5173](http://localhost:5173)
