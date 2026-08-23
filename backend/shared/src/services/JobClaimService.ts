import { Pool, PoolClient } from 'pg';
import { JobResponse } from '../db/repositories/JobRepository';
import { JobStatus, JobType, RetryStrategy } from '@job-scheduler/shared';
import { assertStateTransition } from '../domain/JobStateMachine';
import { RetryPolicyCalculator, RetryPolicyConfig } from '../domain/RetryPolicyCalculator';

export class JobClaimService {
  constructor(private readonly pool: Pool) {}

  /**
   * Atomically claims a single highest-priority eligible job for a worker.
   * Uses `SELECT ... FOR UPDATE SKIP LOCKED` inside a PostgreSQL transaction.
   */
  async claimJob(workerId: string, queueId?: string): Promise<JobResponse | null> {
    const jobs = await this.claimJobs(workerId, 1, queueId);
    return jobs.length > 0 ? jobs[0] : null;
  }

  /**
   * Atomically claims up to `limit` eligible jobs for a worker.
   */
  async claimJobs(workerId: string, limit: number = 1, queueId?: string): Promise<JobResponse[]> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const claimQuery = `
        WITH eligible_jobs AS (
          SELECT j.id
          FROM jobs j
          JOIN queues q ON q.id = j.queue_id
          WHERE j.status = 'pending'
            AND (j.scheduled_at IS NULL OR j.scheduled_at <= NOW())
            AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= NOW())
            AND j.attempt_count < j.max_attempts
            AND q.status = 'active'
            AND ($1::UUID IS NULL OR j.queue_id = $1::UUID)
            AND (
              SELECT COUNT(*)
              FROM jobs r
              WHERE r.queue_id = q.id AND r.status = 'running'
            ) < q.concurrency_limit
          ORDER BY j.priority DESC, j.enqueued_at ASC
          LIMIT $2
          FOR UPDATE OF j SKIP LOCKED
        )
        UPDATE jobs
        SET status = 'running',
            worker_id = $3::UUID,
            attempt_count = jobs.attempt_count + 1,
            started_at = NOW(),
            run_at = COALESCE(jobs.run_at, NOW()),
            updated_at = NOW()
        FROM eligible_jobs
        WHERE jobs.id = eligible_jobs.id
        RETURNING jobs.id, jobs.queue_id, jobs.worker_id, jobs.batch_group_id, jobs.scheduled_job_id,
                  jobs.name, jobs.type, jobs.status, jobs.payload, jobs.priority,
                  jobs.scheduled_at, jobs.run_at, jobs.attempt_count, jobs.max_attempts,
                  jobs.next_attempt_at, jobs.timeout_ms, jobs.result, jobs.error_message,
                  jobs.error_code, jobs.enqueued_at, jobs.started_at, jobs.finished_at,
                  jobs.created_at, jobs.updated_at
      `;

      const result = await client.query(claimQuery, [
        queueId ?? null,
        limit,
        workerId,
      ]);

      await client.query('COMMIT');
      return result.rows.map((row) => this.mapToJobResponse(row));
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Atomically mark a job as completed and record its execution metrics.
   */
  async completeJob(
    jobId: string,
    workerId: string,
    resultPayload?: Record<string, unknown>
  ): Promise<JobResponse> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const selectRes = await client.query(
        `SELECT * FROM jobs WHERE id = $1 FOR UPDATE`,
        [jobId]
      );
      if (selectRes.rows.length === 0) {
        throw new Error(`Job not found: ${jobId}`);
      }

      const jobRow = selectRes.rows[0];
      assertStateTransition(jobRow.status as JobStatus, JobStatus.COMPLETED);

      const updateQuery = `
        UPDATE jobs
        SET status = 'completed',
            result = $2,
            finished_at = NOW(),
            updated_at = NOW()
        WHERE id = $1 AND worker_id = $3
        RETURNING id, queue_id, worker_id, batch_group_id, scheduled_job_id,
                  name, type, status, payload, priority,
                  scheduled_at, run_at, attempt_count, max_attempts,
                  next_attempt_at, timeout_ms, result, error_message,
                  error_code, enqueued_at, started_at, finished_at,
                  created_at, updated_at
      `;

      const updateRes = await client.query(updateQuery, [
        jobId,
        resultPayload ? JSON.stringify(resultPayload) : null,
        workerId,
      ]);

      if (updateRes.rows.length === 0) {
        throw new Error(`Job ${jobId} not assigned to worker ${workerId} or already completed`);
      }

      const finishedJob = updateRes.rows[0];

      // Record execution entry in job_executions
      const startedAt = finishedJob.started_at ? new Date(finishedJob.started_at) : new Date();
      const finishedAt = finishedJob.finished_at ? new Date(finishedJob.finished_at) : new Date();

      await client.query(
        `
        INSERT INTO job_executions (
          job_id, worker_id, attempt_number, status, started_at, finished_at, result
        )
        VALUES ($1, $2, $3, 'completed', $4, $5, $6)
        ON CONFLICT (job_id, attempt_number) DO UPDATE
        SET status = 'completed', finished_at = EXCLUDED.finished_at, result = EXCLUDED.result
        `,
        [
          jobId,
          workerId,
          finishedJob.attempt_count,
          startedAt,
          finishedAt,
          resultPayload ? JSON.stringify(resultPayload) : null,
        ]
      );

      // Record success log
      await client.query(
        `
        INSERT INTO job_logs (job_id, level, message)
        VALUES ($1, 'info', 'Job execution completed successfully')
        `,
        [jobId]
      );

      await client.query('COMMIT');
      return this.mapToJobResponse(finishedJob);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Atomically mark a job as failed, resolving retry policy, computing backoff delay,
   * scheduling next attempt or transitioning to DLQ if max attempts reached.
   */
  async failJob(
    jobId: string,
    workerId: string,
    error: {
      message: string;
      code?: string;
      retryDelayMs?: number;
      policy?: Partial<RetryPolicyConfig>;
      randomFn?: () => number;
    }
  ): Promise<JobResponse> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const selectQuery = `
        SELECT j.*, q.dlq_enabled, q.retry_policy_id,
               rp.strategy as rp_strategy, rp.max_attempts as rp_max_attempts,
               rp.initial_delay_ms as rp_initial_delay, rp.max_delay_ms as rp_max_delay,
               rp.backoff_multiplier as rp_multiplier, rp.jitter_ms as rp_jitter
        FROM jobs j
        JOIN queues q ON q.id = j.queue_id
        LEFT JOIN retry_policies rp ON rp.id = q.retry_policy_id
        WHERE j.id = $1
        FOR UPDATE OF j
      `;

      const selectRes = await client.query(selectQuery, [jobId]);
      if (selectRes.rows.length === 0) {
        throw new Error(`Job not found: ${jobId}`);
      }

      const jobRow = selectRes.rows[0];
      const attemptCount = parseInt(jobRow.attempt_count, 10);
      const maxAttempts = parseInt(jobRow.max_attempts, 10);
      const isRetryAllowed = RetryPolicyCalculator.isRetryAllowed(maxAttempts, attemptCount);

      const nextStatus = isRetryAllowed ? JobStatus.FAILED : JobStatus.DEAD;
      assertStateTransition(jobRow.status as JobStatus, nextStatus);

      let computedDelayMs: number | null = null;
      let nextAttemptAtDate: Date | null = null;

      if (isRetryAllowed) {
        if (typeof error.retryDelayMs === 'number') {
          computedDelayMs = error.retryDelayMs;
        } else {
          // Resolve effective retry policy configuration
          const effectivePolicy: Partial<RetryPolicyConfig> = {
            maxAttempts,
            strategy: (jobRow.rp_strategy as RetryStrategy) || RetryStrategy.EXPONENTIAL,
            initialDelayMs: jobRow.rp_initial_delay ? parseInt(jobRow.rp_initial_delay, 10) : 1000,
            maxDelayMs: jobRow.rp_max_delay ? parseInt(jobRow.rp_max_delay, 10) : 30000,
            backoffMultiplier: jobRow.rp_multiplier ? parseFloat(jobRow.rp_multiplier) : 2.0,
            jitterMs: jobRow.rp_jitter ? parseInt(jobRow.rp_jitter, 10) : 500,
            ...error.policy,
          };

          computedDelayMs = RetryPolicyCalculator.calculateDelayMs(
            effectivePolicy,
            attemptCount,
            error.randomFn
          );
        }

        nextAttemptAtDate = new Date(Date.now() + computedDelayMs);
      }

      const updateQuery = `
        UPDATE jobs
        SET status = $2::job_status,
            error_message = $3,
            error_code = $4,
            next_attempt_at = $5,
            finished_at = CASE WHEN $2::text = 'dead' THEN NOW() ELSE NULL END,
            updated_at = NOW()
        WHERE id = $1 AND worker_id = $6
        RETURNING id, queue_id, worker_id, batch_group_id, scheduled_job_id,
                  name, type, status, payload, priority,
                  scheduled_at, run_at, attempt_count, max_attempts,
                  next_attempt_at, timeout_ms, result, error_message,
                  error_code, enqueued_at, started_at, finished_at,
                  created_at, updated_at
      `;

      const updateRes = await client.query(updateQuery, [
        jobId,
        nextStatus,
        error.message,
        error.code ?? 'JOB_EXECUTION_FAILED',
        nextAttemptAtDate,
        workerId,
      ]);

      if (updateRes.rows.length === 0) {
        throw new Error(`Job ${jobId} not assigned to worker ${workerId}`);
      }

      const failedJob = updateRes.rows[0];

      // Record execution entry in job_executions
      const startedAt = failedJob.started_at ? new Date(failedJob.started_at) : new Date();
      const finishedAt = new Date();

      await client.query(
        `
        INSERT INTO job_executions (
          job_id, worker_id, attempt_number, status, started_at, finished_at,
          error_message, error_code, next_retry_at, retry_delay_ms
        )
        VALUES ($1, $2, $3, 'failed', $4, $5, $6, $7, $8, $9)
        ON CONFLICT (job_id, attempt_number) DO UPDATE
        SET status = 'failed',
            finished_at = EXCLUDED.finished_at,
            error_message = EXCLUDED.error_message,
            error_code = EXCLUDED.error_code,
            next_retry_at = EXCLUDED.next_retry_at,
            retry_delay_ms = EXCLUDED.retry_delay_ms
        `,
        [
          jobId,
          workerId,
          attemptCount,
          startedAt,
          finishedAt,
          error.message,
          error.code ?? 'JOB_EXECUTION_FAILED',
          nextAttemptAtDate,
          computedDelayMs,
        ]
      );

      // If permanently dead and DLQ is enabled on queue, insert snapshot into dead_letter_jobs
      if (!isRetryAllowed && jobRow.dlq_enabled) {
        await client.query(
          `
          INSERT INTO dead_letter_jobs (
            job_id, queue_id, name, payload, total_attempts,
            final_error_message, final_error_code, first_failed_at, last_failed_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
          ON CONFLICT (job_id) DO UPDATE
          SET total_attempts = EXCLUDED.total_attempts,
              final_error_message = EXCLUDED.final_error_message,
              final_error_code = EXCLUDED.final_error_code,
              last_failed_at = NOW()
          `,
          [
            jobId,
            failedJob.queue_id,
            failedJob.name,
            JSON.stringify(failedJob.payload ?? {}),
            attemptCount,
            error.message,
            error.code ?? 'JOB_EXECUTION_FAILED',
            startedAt,
          ]
        );
      }

      // Record error log
      await client.query(
        `
        INSERT INTO job_logs (job_id, level, message, metadata)
        VALUES ($1, 'error', $2, $3)
        `,
        [
          jobId,
          isRetryAllowed
            ? `Execution attempt ${attemptCount} failed: ${error.message}. Scheduled retry in ${computedDelayMs}ms.`
            : `Execution attempt ${attemptCount} failed: ${error.message}. Exhausted max attempts (${maxAttempts}). Moved to DLQ.`,
          JSON.stringify({
            code: error.code,
            attemptCount,
            maxAttempts,
            willRetry: isRetryAllowed,
            retryDelayMs: computedDelayMs,
            nextAttemptAt: nextAttemptAtDate,
          }),
        ]
      );

      await client.query('COMMIT');
      return this.mapToJobResponse(failedJob);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Release a claimed job back to pending status (e.g. if worker shuts down).
   */
  async releaseJob(jobId: string, workerId: string): Promise<JobResponse> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const updateQuery = `
        UPDATE jobs
        SET status = 'pending',
            worker_id = NULL,
            started_at = NULL,
            updated_at = NOW()
        WHERE id = $1 AND worker_id = $2 AND status = 'running'
        RETURNING id, queue_id, worker_id, batch_group_id, scheduled_job_id,
                  name, type, status, payload, priority,
                  scheduled_at, run_at, attempt_count, max_attempts,
                  next_attempt_at, timeout_ms, result, error_message,
                  error_code, enqueued_at, started_at, finished_at,
                  created_at, updated_at
      `;

      const result = await client.query(updateQuery, [jobId, workerId]);
      if (result.rows.length === 0) {
        throw new Error(`Job ${jobId} not in running state or not assigned to worker ${workerId}`);
      }

      await client.query('COMMIT');
      return this.mapToJobResponse(result.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private mapToJobResponse(row: Record<string, unknown>): JobResponse {
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
