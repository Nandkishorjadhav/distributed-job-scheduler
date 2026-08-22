import { z } from 'zod';
import { RetryStrategy, JobType } from '../enums';

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
  name: z.string().min(1).max(128),
  priority: z.number().int().min(1).max(10).default(5),
  concurrencyLimit: z.number().int().min(1).max(1000).default(10),
  retryPolicy: RetryPolicySchema.default({}),
  dlqEnabled: z.boolean().default(true),
});

export const UpdateQueueSchema = CreateQueueSchema.partial();

// ─── Job Schemas ──────────────────────────────────────────────────────────────

export const SubmitJobSchema = z.object({
  name: z.string().min(1).max(256),
  type: z.nativeEnum(JobType).default(JobType.IMMEDIATE),
  payload: z.record(z.unknown()).default({}),
  priority: z.number().int().min(1).max(10).default(5),
  /** ISO 8601 datetime — required for DELAYED/SCHEDULED types */
  scheduledAt: z.string().datetime().optional(),
  maxAttempts: z.number().int().min(1).max(100).optional(),
  retryPolicy: RetryPolicySchema.optional(),
});

export const SubmitBatchSchema = z.object({
  name: z.string().min(1).max(256),
  jobs: z.array(SubmitJobSchema).min(1).max(1000),
});

// ─── Recurring Job Schemas ────────────────────────────────────────────────────

export const CreateRecurringJobSchema = z.object({
  name: z.string().min(1).max(256),
  cronExpression: z.string().min(1),
  payloadTemplate: z.record(z.unknown()).default({}),
  retryPolicy: RetryPolicySchema.optional(),
  enabled: z.boolean().default(true),
});

// ─── Auth Schemas ─────────────────────────────────────────────────────────────

export const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(256),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ─── Org / Project Schemas ───────────────────────────────────────────────────

export const CreateOrgSchema = z.object({
  name: z.string().min(1).max(128),
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
});

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(128),
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
});

// ─── Query / Pagination Schemas ───────────────────────────────────────────────

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const JobFilterSchema = PaginationSchema.extend({
  status: z.string().optional(),
  search: z.string().optional(),
});

// ─── Inferred Types ───────────────────────────────────────────────────────────

export type CreateQueueInput = z.infer<typeof CreateQueueSchema>;
export type UpdateQueueInput = z.infer<typeof UpdateQueueSchema>;
export type SubmitJobInput = z.infer<typeof SubmitJobSchema>;
export type SubmitBatchInput = z.infer<typeof SubmitBatchSchema>;
export type CreateRecurringJobInput = z.infer<typeof CreateRecurringJobSchema>;
export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type CreateOrgInput = z.infer<typeof CreateOrgSchema>;
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type PaginationInput = z.infer<typeof PaginationSchema>;
export type JobFilterInput = z.infer<typeof JobFilterSchema>;
