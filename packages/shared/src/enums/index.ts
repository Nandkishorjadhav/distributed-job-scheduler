// ─── Job Statuses ────────────────────────────────────────────────────────────

export enum JobStatus {
  PENDING = 'pending',
  DELAYED = 'delayed',
  SCHEDULED = 'scheduled',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  DEAD = 'dead',
  CANCELLED = 'cancelled',
}

// ─── Queue Statuses ───────────────────────────────────────────────────────────

export enum QueueStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  ARCHIVED = 'archived',
}

// ─── Worker Statuses ─────────────────────────────────────────────────────────

export enum WorkerStatus {
  ACTIVE = 'active',
  DRAINING = 'draining',
  OFFLINE = 'offline',
}

// ─── Retry Strategies ────────────────────────────────────────────────────────

export enum RetryStrategy {
  FIXED = 'fixed',
  LINEAR = 'linear',
  EXPONENTIAL = 'exponential',
}

// ─── Job Types ───────────────────────────────────────────────────────────────

export enum JobType {
  IMMEDIATE = 'immediate',
  DELAYED = 'delayed',
  SCHEDULED = 'scheduled',
  RECURRING = 'recurring',
  BATCH = 'batch',
  BATCH_CHILD = 'batch_child',
}

// ─── Log Levels ───────────────────────────────────────────────────────────────

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

// ─── Organization Member Roles ───────────────────────────────────────────────

export enum OrgRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  MEMBER = 'member',
  VIEWER = 'viewer',
}
