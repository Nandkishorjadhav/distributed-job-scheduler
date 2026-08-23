import { Pool } from 'pg';
import { JobStatus, JobType, LogLevel, SubmitJobInput, CreateRecurringJobInput } from '@job-scheduler/shared';
import { assertStateTransition } from '../../domain/JobStateMachine';

export interface JobResponse {
  id: string;
  queueId: string;
  workerId: string | null;
  batchGroupId: string | null;
  scheduledJobId: string | null;
  name: string;
  type: JobType;
  status: JobStatus;
  payload: Record<string, unknown>;
  priority: number;
  scheduledAt: Date | null;
  runAt: Date | null;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: Date | null;
  timeoutMs: number | null;
  result: Record<string, unknown> | null;
  errorMessage: string | null;
  errorCode: string | null;
  enqueuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface JobExecutionResponse {
  id: string;
  jobId: string;
  workerId: string | null;
  attemptNumber: number;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  result: Record<string, unknown> | null;
  errorMessage: string | null;
  errorCode: string | null;
  exitSignal: string | null;
  nextRetryAt: Date | null;
  retryDelayMs: number | null;
  createdAt: Date;
}

export interface JobLogResponse {
  id: string;
  jobId: string;
  executionId: string | null;
  level: LogLevel;
  message: string;
  metadata: Record<string, unknown> | null;
  loggedAt: Date;
}

export interface ScheduledJobResponse {
  id: string;
  queueId: string;
  name: string;
  description: string | null;
  cronExpression: string;
  timezone: string;
  payloadTemplate: Record<string, unknown>;
  priority: number;
  timeoutMs: number | null;
  maxAttempts: number;
  enabled: boolean;
  skipIfRunning: boolean;
  lastFiredAt: Date | null;
  nextRunAt: Date | null;
  lastJobId: string | null;
  runCount: number;
  failCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface JobHistoryResponse {
  job: JobResponse;
  executions: JobExecutionResponse[];
  logs: JobLogResponse[];
}

export class JobRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Create a new job.
   */
  async create(data: {
    queueId: string;
    name: string;
    type?: JobType;
    payload?: Record<string, unknown>;
    priority?: number;
    scheduledAt?: Date | string | null;
    maxAttempts?: number;
    timeoutMs?: number;
    batchGroupId?: string;
    scheduledJobId?: string;
  }): Promise<JobResponse> {
    const jobType = data.type ?? JobType.IMMEDIATE;
    let scheduledAtDate: Date | null = null;

    if (data.scheduledAt) {
      scheduledAtDate = new Date(data.scheduledAt);
    }

    let initialStatus = JobStatus.PENDING;
    if ((jobType === JobType.DELAYED || jobType === JobType.SCHEDULED) && scheduledAtDate && scheduledAtDate.getTime() > Date.now()) {
      initialStatus = JobStatus.SCHEDULED;
    }

    const query = `
      INSERT INTO jobs (
        queue_id, name, type, status, payload, priority, scheduled_at, max_attempts, timeout_ms, batch_group_id, scheduled_job_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id, queue_id, worker_id, batch_group_id, scheduled_job_id, name, type, status, payload, priority,
                scheduled_at, run_at, attempt_count, max_attempts, next_attempt_at, timeout_ms, result, error_message, error_code,
                enqueued_at, started_at, finished_at, created_at, updated_at
    `;

    const values = [
      data.queueId,
      data.name.trim(),
      jobType,
      initialStatus,
      JSON.stringify(data.payload ?? {}),
      data.priority ?? 5,
      scheduledAtDate,
      data.maxAttempts ?? 3,
      data.timeoutMs ?? null,
      data.batchGroupId ?? null,
      data.scheduledJobId ?? null,
    ];

    const result = await this.pool.query(query, values);
    return this.mapToResponse(result.rows[0]);
  }

  /**
   * Create a batch group and all child jobs.
   */
  async createBatch(
    data: { queueId: string; name: string; description?: string; jobs: SubmitJobInput[] },
    projectId: string
  ): Promise<{ batchGroupId: string; totalJobs: number; jobs: JobResponse[] }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const batchQuery = `
        INSERT INTO batch_groups (project_id, name, description)
        VALUES ($1, $2, $3)
        RETURNING id
      `;
      const batchRes = await client.query(batchQuery, [projectId, data.name.trim(), data.description ? data.description.trim() : null]);
      const batchGroupId = batchRes.rows[0].id;

      const createdJobs: JobResponse[] = [];

      for (const jobInput of data.jobs) {
        const scheduledAtDate = jobInput.scheduledAt ? new Date(jobInput.scheduledAt) : null;
        let initialStatus = JobStatus.PENDING;
        if ((jobInput.type === JobType.DELAYED || jobInput.type === JobType.SCHEDULED) && scheduledAtDate && scheduledAtDate.getTime() > Date.now()) {
          initialStatus = JobStatus.SCHEDULED;
        }

        const jobQuery = `
          INSERT INTO jobs (
            queue_id, name, type, status, payload, priority, scheduled_at, max_attempts, timeout_ms, batch_group_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING id, queue_id, worker_id, batch_group_id, scheduled_job_id, name, type, status, payload, priority,
                    scheduled_at, run_at, attempt_count, max_attempts, next_attempt_at, timeout_ms, result, error_message, error_code,
                    enqueued_at, started_at, finished_at, created_at, updated_at
        `;

        const jobValues = [
          data.queueId,
          jobInput.name.trim(),
          JobType.BATCH_CHILD,
          initialStatus,
          JSON.stringify(jobInput.payload ?? {}),
          jobInput.priority ?? 5,
          scheduledAtDate,
          jobInput.maxAttempts ?? 3,
          jobInput.timeoutMs ?? null,
          batchGroupId,
        ];

        const jobRes = await client.query(jobQuery, jobValues);
        createdJobs.push(this.mapToResponse(jobRes.rows[0]));
      }

      await client.query('COMMIT');
      return { batchGroupId, totalJobs: createdJobs.length, jobs: createdJobs };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Create a recurring cron job definition.
   */
  async createRecurring(
    data: CreateRecurringJobInput & { queueId: string }
  ): Promise<ScheduledJobResponse> {
    const query = `
      INSERT INTO scheduled_jobs (
        queue_id, name, description, cron_expression, timezone, payload_template,
        priority, timeout_ms, max_attempts, enabled, skip_if_running
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id, queue_id, name, description, cron_expression, timezone, payload_template,
                priority, timeout_ms, max_attempts, enabled, skip_if_running, last_fired_at,
                next_run_at, last_job_id, run_count, fail_count, created_at, updated_at
    `;

    const values = [
      data.queueId,
      data.name.trim(),
      data.description ? data.description.trim() : null,
      data.cronExpression.trim(),
      data.timezone ?? 'UTC',
      JSON.stringify(data.payloadTemplate ?? {}),
      data.priority ?? 5,
      data.timeoutMs ?? null,
      data.maxAttempts ?? 3,
      data.enabled ?? true,
      data.skipIfRunning ?? false,
    ];

    const result = await this.pool.query(query, values);
    const row = result.rows[0];

    return {
      id: row.id,
      queueId: row.queue_id,
      name: row.name,
      description: row.description,
      cronExpression: row.cron_expression,
      timezone: row.timezone,
      payloadTemplate: row.payload_template ? (typeof row.payload_template === 'string' ? JSON.parse(row.payload_template) : row.payload_template) : {},
      priority: parseInt(row.priority, 10),
      timeoutMs: row.timeout_ms !== null ? parseInt(row.timeout_ms, 10) : null,
      maxAttempts: parseInt(row.max_attempts, 10),
      enabled: row.enabled,
      skipIfRunning: row.skip_if_running,
      lastFiredAt: row.last_fired_at ? new Date(row.last_fired_at) : null,
      nextRunAt: row.next_run_at ? new Date(row.next_run_at) : null,
      lastJobId: row.last_job_id,
      runCount: parseInt(row.run_count, 10),
      failCount: parseInt(row.fail_count, 10),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Find a job by ID.
   */
  async findById(id: string): Promise<JobResponse | null> {
    const query = `
      SELECT id, queue_id, worker_id, batch_group_id, scheduled_job_id, name, type, status, payload, priority,
             scheduled_at, run_at, attempt_count, max_attempts, next_attempt_at, timeout_ms, result, error_message, error_code,
             enqueued_at, started_at, finished_at, created_at, updated_at
      FROM jobs
      WHERE id = $1
    `;
    const result = await this.pool.query(query, [id]);
    if (result.rows.length === 0) return null;
    return this.mapToResponse(result.rows[0]);
  }

  /**
   * List jobs for a queue with pagination and filters.
   */
  async listByQueue(
    queueId: string,
    page: number,
    pageSize: number,
    filters?: { status?: string; type?: string; search?: string }
  ): Promise<{ data: JobResponse[]; total: number }> {
    const offset = (page - 1) * pageSize;
    const params: unknown[] = [queueId];
    const conditions: string[] = ['queue_id = $1'];

    if (filters?.status) {
      params.push(filters.status);
      conditions.push(`status = $${params.length}`);
    }

    if (filters?.type) {
      params.push(filters.type);
      conditions.push(`type = $${params.length}`);
    }

    if (filters?.search) {
      params.push(`%${filters.search.trim()}%`);
      conditions.push(`name ILIKE $${params.length}`);
    }

    const whereClause = conditions.join(' AND ');

    const countQuery = `SELECT COUNT(*) FROM jobs WHERE ${whereClause}`;
    const countResult = await this.pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count, 10);

    params.push(pageSize, offset);
    const dataQuery = `
      SELECT id, queue_id, worker_id, batch_group_id, scheduled_job_id, name, type, status, payload, priority,
             scheduled_at, run_at, attempt_count, max_attempts, next_attempt_at, timeout_ms, result, error_message, error_code,
             enqueued_at, started_at, finished_at, created_at, updated_at
      FROM jobs
      WHERE ${whereClause}
      ORDER BY updated_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;

    const dataResult = await this.pool.query(dataQuery, params);
    const data = dataResult.rows.map((row) => this.mapToResponse(row));

    return { data, total };
  }

  /**
   * List jobs across user's organizations with pagination and filters.
   */
  async listByUser(
    userId: string,
    page: number,
    pageSize: number,
    filters?: { queueId?: string; projectId?: string; status?: string; type?: string; search?: string }
  ): Promise<{ data: JobResponse[]; total: number }> {
    const offset = (page - 1) * pageSize;
    const params: unknown[] = [userId];
    const conditions: string[] = ['m.user_id = $1'];

    if (filters?.queueId) {
      params.push(filters.queueId);
      conditions.push(`j.queue_id = $${params.length}`);
    }

    if (filters?.projectId) {
      params.push(filters.projectId);
      conditions.push(`q.project_id = $${params.length}`);
    }

    if (filters?.status) {
      params.push(filters.status);
      conditions.push(`j.status = $${params.length}`);
    }

    if (filters?.type) {
      params.push(filters.type);
      conditions.push(`j.type = $${params.length}`);
    }

    if (filters?.search) {
      params.push(`%${filters.search.trim()}%`);
      conditions.push(`j.name ILIKE $${params.length}`);
    }

    const whereClause = conditions.join(' AND ');

    const countQuery = `
      SELECT COUNT(*)
      FROM jobs j
      JOIN queues q ON q.id = j.queue_id
      JOIN projects p ON p.id = q.project_id
      JOIN organization_members m ON m.organization_id = p.organization_id
      WHERE ${whereClause}
    `;
    const countResult = await this.pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count, 10);

    params.push(pageSize, offset);
    const dataQuery = `
      SELECT j.id, j.queue_id, j.worker_id, j.batch_group_id, j.scheduled_job_id, j.name, j.type, j.status, j.payload, j.priority,
             j.scheduled_at, j.run_at, j.attempt_count, j.max_attempts, j.next_attempt_at, j.timeout_ms, j.result, j.error_message, j.error_code,
             j.enqueued_at, j.started_at, j.finished_at, j.created_at, j.updated_at
      FROM jobs j
      JOIN queues q ON q.id = j.queue_id
      JOIN projects p ON p.id = q.project_id
      JOIN organization_members m ON m.organization_id = p.organization_id
      WHERE ${whereClause}
      ORDER BY j.updated_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;

    const dataResult = await this.pool.query(dataQuery, params);
    const data = dataResult.rows.map((row) => this.mapToResponse(row));

    return { data, total };
  }

  /**
   * Cancel a job if it is in pending or scheduled status.
   * Enforces state machine transition rules.
   */
  async cancel(id: string): Promise<JobResponse> {
    const job = await this.findById(id);
    if (!job) {
      throw new Error('Job not found');
    }

    if (job.status === JobStatus.CANCELLED || job.status === JobStatus.COMPLETED) {
      throw new Error(`Job cannot be cancelled when status is '${job.status}'`);
    }

    assertStateTransition(job.status, JobStatus.CANCELLED);

    const query = `
      UPDATE jobs
      SET status = 'cancelled', finished_at = NOW()
      WHERE id = $1
      RETURNING id, queue_id, worker_id, batch_group_id, scheduled_job_id, name, type, status, payload, priority,
                scheduled_at, run_at, attempt_count, max_attempts, next_attempt_at, timeout_ms, result, error_message, error_code,
                enqueued_at, started_at, finished_at, created_at, updated_at
    `;

    const result = await this.pool.query(query, [id]);
    return this.mapToResponse(result.rows[0]);
  }

  /**
   * Retry a failed or dead job.
   * Resets status to pending, clears error messages, and re-queues.
   * Enforces state machine transition rules.
   */
  async retry(id: string): Promise<JobResponse> {
    const job = await this.findById(id);
    if (!job) {
      throw new Error('Job not found');
    }

    if (job.status !== JobStatus.FAILED && job.status !== JobStatus.DEAD) {
      throw new Error(`Only failed or dead jobs can be retried. Current status is '${job.status}'`);
    }

    assertStateTransition(job.status, JobStatus.PENDING);

    const query = `
      UPDATE jobs
      SET status = 'pending',
          worker_id = NULL,
          next_attempt_at = NULL,
          finished_at = NULL,
          error_message = NULL,
          error_code = NULL
      WHERE id = $1
      RETURNING id, queue_id, worker_id, batch_group_id, scheduled_job_id, name, type, status, payload, priority,
                scheduled_at, run_at, attempt_count, max_attempts, next_attempt_at, timeout_ms, result, error_message, error_code,
                enqueued_at, started_at, finished_at, created_at, updated_at
    `;

    const result = await this.pool.query(query, [id]);
    return this.mapToResponse(result.rows[0]);
  }

  /**
   * Record an execution attempt in job_executions table.
   */
  async recordExecution(data: {
    jobId: string;
    workerId?: string;
    attemptNumber: number;
    status: string;
    startedAt: Date;
    finishedAt?: Date;
    result?: unknown;
    errorMessage?: string;
    errorCode?: string;
    exitSignal?: string;
    nextRetryAt?: Date;
    retryDelayMs?: number;
  }): Promise<JobExecutionResponse> {
    const query = `
      INSERT INTO job_executions (
        job_id, worker_id, attempt_number, status, started_at, finished_at,
        result, error_message, error_code, exit_signal, next_retry_at, retry_delay_ms
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, job_id, worker_id, attempt_number, status, started_at, finished_at, duration_ms,
                result, error_message, error_code, exit_signal, next_retry_at, retry_delay_ms, created_at
    `;

    const values = [
      data.jobId,
      data.workerId ?? null,
      data.attemptNumber,
      data.status,
      data.startedAt,
      data.finishedAt ?? null,
      data.result ? JSON.stringify(data.result) : null,
      data.errorMessage ?? null,
      data.errorCode ?? null,
      data.exitSignal ?? null,
      data.nextRetryAt ?? null,
      data.retryDelayMs ?? null,
    ];

    const result = await this.pool.query(query, values);
    const row = result.rows[0];

    return {
      id: row.id,
      jobId: row.job_id,
      workerId: row.worker_id,
      attemptNumber: parseInt(row.attempt_number, 10),
      status: row.status,
      startedAt: new Date(row.started_at),
      finishedAt: row.finished_at ? new Date(row.finished_at) : null,
      durationMs: row.duration_ms !== null ? parseInt(row.duration_ms, 10) : null,
      result: row.result ? (typeof row.result === 'string' ? JSON.parse(row.result) : row.result) : null,
      errorMessage: row.error_message,
      errorCode: row.error_code,
      exitSignal: row.exit_signal,
      nextRetryAt: row.next_retry_at ? new Date(row.next_retry_at) : null,
      retryDelayMs: row.retry_delay_ms !== null ? parseInt(row.retry_delay_ms, 10) : null,
      createdAt: new Date(row.created_at),
    };
  }

  /**
   * Get execution history attempts for a job.
   */
  async getExecutionHistory(jobId: string): Promise<JobExecutionResponse[]> {
    const query = `
      SELECT id, job_id, worker_id, attempt_number, status, started_at, finished_at, duration_ms,
             result, error_message, error_code, exit_signal, next_retry_at, retry_delay_ms, created_at
      FROM job_executions
      WHERE job_id = $1
      ORDER BY attempt_number ASC
    `;
    const result = await this.pool.query(query, [jobId]);
    return result.rows.map((row) => ({
      id: row.id,
      jobId: row.job_id,
      workerId: row.worker_id,
      attemptNumber: parseInt(row.attempt_number, 10),
      status: row.status,
      startedAt: new Date(row.started_at),
      finishedAt: row.finished_at ? new Date(row.finished_at) : null,
      durationMs: row.duration_ms !== null ? parseInt(row.duration_ms, 10) : null,
      result: row.result ? (typeof row.result === 'string' ? JSON.parse(row.result) : row.result) : null,
      errorMessage: row.error_message,
      errorCode: row.error_code,
      exitSignal: row.exit_signal,
      nextRetryAt: row.next_retry_at ? new Date(row.next_retry_at) : null,
      retryDelayMs: row.retry_delay_ms !== null ? parseInt(row.retry_delay_ms, 10) : null,
      createdAt: new Date(row.created_at),
    }));
  }

  /**
   * Get execution logs for a job.
   */
  async getJobLogs(jobId: string, level?: LogLevel): Promise<JobLogResponse[]> {
    const params: unknown[] = [jobId];
    let levelCondition = '';

    if (level) {
      params.push(level);
      levelCondition = `AND level = $2`;
    }

    const query = `
      SELECT id, job_id, execution_id, level, message, metadata, logged_at
      FROM job_logs
      WHERE job_id = $1 ${levelCondition}
      ORDER BY logged_at ASC
    `;

    const result = await this.pool.query(query, params);
    return result.rows.map((row) => ({
      id: row.id.toString(),
      jobId: row.job_id,
      executionId: row.execution_id,
      level: row.level as LogLevel,
      message: row.message,
      metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
      loggedAt: new Date(row.logged_at),
    }));
  }

  /**
   * Get full audit history (job details + execution attempts + logs).
   */
  async getJobHistory(jobId: string): Promise<JobHistoryResponse | null> {
    const job = await this.findById(jobId);
    if (!job) return null;

    const [executions, logs] = await Promise.all([
      this.getExecutionHistory(jobId),
      this.getJobLogs(jobId),
    ]);

    return { job, executions, logs };
  }

  private mapToResponse(row: Record<string, unknown>): JobResponse {
    return {
      id: row.id as string,
      queueId: row.queue_id as string,
      workerId: (row.worker_id as string) ?? null,
      batchGroupId: (row.batch_group_id as string) ?? null,
      scheduledJobId: (row.scheduled_job_id as string) ?? null,
      name: row.name as string,
      type: row.type as JobType,
      status: row.status as JobStatus,
      payload: row.payload ? (typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload as Record<string, unknown>)) : {},
      priority: parseInt(row.priority as string, 10),
      scheduledAt: row.scheduled_at ? new Date(row.scheduled_at as string) : null,
      runAt: row.run_at ? new Date(row.run_at as string) : null,
      attemptCount: parseInt(row.attempt_count as string, 10),
      maxAttempts: parseInt(row.max_attempts as string, 10),
      nextAttemptAt: row.next_attempt_at ? new Date(row.next_attempt_at as string) : null,
      timeoutMs: row.timeout_ms !== null ? parseInt(row.timeout_ms as string, 10) : null,
      result: row.result ? (typeof row.result === 'string' ? JSON.parse(row.result) : (row.result as Record<string, unknown>)) : null,
      errorMessage: (row.error_message as string) ?? null,
      errorCode: (row.error_code as string) ?? null,
      enqueuedAt: new Date(row.enqueued_at as string),
      startedAt: row.started_at ? new Date(row.started_at as string) : null,
      finishedAt: row.finished_at ? new Date(row.finished_at as string) : null,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
