import { JobStatus, QueueStatus, WorkerStatus, RetryStrategy, JobType, LogLevel, OrgRole } from '../enums';

// ─── Retry Policy ─────────────────────────────────────────────────────────────

export interface RetryPolicy {
  maxAttempts: number;
  strategy: RetryStrategy;
  initialDelayMs: number;
  maxDelayMs: number;
  jitterMs: number;
}

// ─── Organization ─────────────────────────────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Project ──────────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Queue ────────────────────────────────────────────────────────────────────

export interface Queue {
  id: string;
  projectId: string;
  name: string;
  /** Lower number = higher priority (1 = highest) */
  priority: number;
  concurrencyLimit: number;
  status: QueueStatus;
  retryPolicy: RetryPolicy;
  dlqEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Job ──────────────────────────────────────────────────────────────────────

export interface Job {
  id: string;
  queueId: string;
  batchId: string | null;
  type: JobType;
  name: string;
  /** Arbitrary JSON payload delivered to the handler */
  payload: Record<string, unknown>;
  status: JobStatus;
  /** Job-level priority override (1 highest) */
  priority: number;
  maxAttempts: number;
  attemptCount: number;
  /** When the job should become pending (for delayed/scheduled jobs) */
  scheduledAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  workerId: string | null;
  result: Record<string, unknown> | null;
  errorMessage: string | null;
  errorStack: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Job Log ──────────────────────────────────────────────────────────────────

export interface JobLog {
  id: string;
  jobId: string;
  level: LogLevel;
  message: string;
  loggedAt: Date;
}

// ─── Recurring Job Definition ─────────────────────────────────────────────────

export interface RecurringJobDefinition {
  id: string;
  queueId: string;
  name: string;
  cronExpression: string;
  payloadTemplate: Record<string, unknown>;
  enabled: boolean;
  nextRunAt: Date | null;
  lastFiredAt: Date | null;
  retryPolicy: RetryPolicy | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Batch Job ────────────────────────────────────────────────────────────────

export interface BatchJob {
  id: string;
  projectId: string;
  name: string;
  totalCount: number;
  pendingCount: number;
  completedCount: number;
  failedCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Worker ───────────────────────────────────────────────────────────────────

export interface Worker {
  id: string;
  hostname: string;
  pid: number;
  status: WorkerStatus;
  maxConcurrency: number;
  lastHeartbeatAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ─── User ─────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Org Member ───────────────────────────────────────────────────────────────

export interface OrgMember {
  orgId: string;
  userId: string;
  role: OrgRole;
  createdAt: Date;
}

// ─── API Key ──────────────────────────────────────────────────────────────────

export interface ApiKey {
  id: string;
  projectId: string;
  name: string;
  keyPrefix: string;
  createdAt: Date;
  expiresAt: Date | null;
}

// ─── Job Metrics ─────────────────────────────────────────────────────────────

export interface JobMetrics {
  queueId: string;
  date: string; // YYYY-MM-DD
  completedCount: number;
  failedCount: number;
  deadCount: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
}

// ─── API Response Wrappers ───────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiResponse<T = void> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
