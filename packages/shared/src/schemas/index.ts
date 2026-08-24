import { z } from 'zod';
import { RetryStrategy, JobType, DLQStatus, WorkerStatus } from '../enums';

// ─── Retry Policy Schema ──────────────────────────────────────────────────────

export const RetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(100).default(3),
  strategy: z.nativeEnum(RetryStrategy).default(RetryStrategy.EXPONENTIAL),
  initialDelayMs: z.number().int().min(0).default(1000),
  maxDelayMs: z.number().int().min(0).default(30000),
  jitterMs: z.number().int().min(0).default(500),
});

// ─── Queue Schemas ────────────────────────────────────────────────────────────

export const CreateQueueSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(128),
  description: z.string().max(1024).optional(),
  priority: z.number().int().min(1).max(10).default(5),
  concurrencyLimit: z.number().int().min(1).max(1000).default(10),
  retryPolicy: RetryPolicySchema.optional(),
  dlqEnabled: z.boolean().default(true),
});

export const UpdateQueueSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(1024).optional(),
  priority: z.number().int().min(1).max(10).optional(),
  concurrencyLimit: z.number().int().min(1).max(1000).optional(),
  retryPolicy: RetryPolicySchema.optional(),
  dlqEnabled: z.boolean().optional(),
});

// ─── Job Schemas ──────────────────────────────────────────────────────────────

export const SubmitJobSchema = z.object({
  name: z.string().min(1).max(256),
  type: z.nativeEnum(JobType).default(JobType.IMMEDIATE),
  payload: z.record(z.unknown()).optional().default({}),
  priority: z.number().int().min(1).max(10).default(5),
  /** ISO 8601 datetime — required for DELAYED/SCHEDULED types */
  scheduledAt: z.string().datetime().optional(),
  maxAttempts: z.number().int().min(1).max(100).optional(),
  timeoutMs: z.number().int().min(100).optional(),
  retryPolicy: RetryPolicySchema.optional(),
});

export const CreateJobDirectSchema = SubmitJobSchema.extend({
  queueId: z.string().uuid(),
});

export const SubmitBatchSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().max(1024).optional(),
  jobs: z.array(SubmitJobSchema).min(1).max(1000),
});

// ─── Recurring Job Schemas ────────────────────────────────────────────────────

export const CreateRecurringJobSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().max(1024).optional(),
  cronExpression: z.string().min(1).max(128),
  timezone: z.string().max(64).default('UTC'),
  payloadTemplate: z.record(z.unknown()).default({}),
  priority: z.number().int().min(1).max(10).default(5),
  timeoutMs: z.number().int().min(100).optional(),
  maxAttempts: z.number().int().min(1).max(100).default(3),
  enabled: z.boolean().default(true),
  skipIfRunning: z.boolean().default(true),
  retryPolicy: RetryPolicySchema.optional(),
});

// ─── Auth & User Schemas ──────────────────────────────────────────────────────

export const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(128),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ─── Organization & Project Schemas ──────────────────────────────────────────

export const SlugSchema = z
  .string()
  .min(2, 'Slug must be at least 2 characters')
  .max(64)
  .regex(
    /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
    'Slug must start and end with an alphanumeric character and contain only lowercase letters, numbers, and hyphens'
  );

export const CreateOrgSchema = z.object({
  name: z.string().min(1).max(128),
  slug: SlugSchema,
});

export const UpdateOrgSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  slug: SlugSchema.optional(),
});

export const CreateProjectSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(128),
  slug: SlugSchema,
  description: z.string().max(1024).optional(),
});

export const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  slug: SlugSchema.optional(),
  description: z.string().max(1024).optional(),
});

// ─── Worker Schemas ───────────────────────────────────────────────────────────

export const RegisterWorkerSchema = z.object({
  projectId: z.string().uuid(),
  hostname: z.string().min(1).max(255),
  pid: z.number().int().min(1),
  ipAddress: z.string().optional(),
  version: z.string().max(32).optional().default('1.0.0'),
  maxConcurrency: z.number().int().min(1).max(1000).optional().default(5),
});

export const WorkerHeartbeatSchema = z.object({
  currentJobCount: z.number().int().min(0).optional(),
  metadata: z.record(z.unknown()).optional(),
  status: z.nativeEnum(WorkerStatus).optional(),
});

// ─── Query / Pagination Schemas ───────────────────────────────────────────────

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const ProjectQuerySchema = PaginationSchema.extend({
  organizationId: z.string().uuid().optional(),
});

export const QueueQuerySchema = PaginationSchema.extend({
  projectId: z.string().uuid().optional(),
});

export const WorkerQuerySchema = PaginationSchema.extend({
  projectId: z.string().uuid().optional(),
  status: z.string().optional(),
});

export const JobFilterSchema = PaginationSchema.extend({
  queueId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  search: z.string().optional(),
});

export const DLQFilterSchema = PaginationSchema.extend({
  queueId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  status: z.nativeEnum(DLQStatus).optional(),
  search: z.string().optional(),
});

export const DLQStatsQuerySchema = z.object({
  queueId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
});

// ─── Inferred Types ───────────────────────────────────────────────────────────

export type CreateQueueInput = z.infer<typeof CreateQueueSchema>;
export type UpdateQueueInput = z.infer<typeof UpdateQueueSchema>;
export type SubmitJobInput = z.infer<typeof SubmitJobSchema>;
export type CreateJobDirectInput = z.infer<typeof CreateJobDirectSchema>;
export type SubmitBatchInput = z.infer<typeof SubmitBatchSchema>;
export type CreateRecurringJobInput = z.infer<typeof CreateRecurringJobSchema>;
export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type CreateOrgInput = z.infer<typeof CreateOrgSchema>;
export type UpdateOrgInput = z.infer<typeof UpdateOrgSchema>;
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;
export type RegisterWorkerInput = z.infer<typeof RegisterWorkerSchema>;
export type WorkerHeartbeatInput = z.infer<typeof WorkerHeartbeatSchema>;
export type PaginationInput = z.infer<typeof PaginationSchema>;
export type ProjectQueryInput = z.infer<typeof ProjectQuerySchema>;
export type QueueQueryInput = z.infer<typeof QueueQuerySchema>;
export type WorkerQueryInput = z.infer<typeof WorkerQuerySchema>;
export type JobFilterInput = z.infer<typeof JobFilterSchema>;
export type DLQFilterInput = z.infer<typeof DLQFilterSchema>;
export type DLQStatsQueryInput = z.infer<typeof DLQStatsQuerySchema>;
