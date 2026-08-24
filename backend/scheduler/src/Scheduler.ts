import { Pool, PoolClient } from 'pg';
import cronParser from 'cron-parser';
import { logger, tryAcquireLock } from '@job-scheduler/backend-shared';
import { JobStatus, JobType } from '@job-scheduler/shared';

export interface SchedulerOptions {
  projectId?: string;
  pollIntervalMs?: number;
  cronIntervalMs?: number;
  batchSize?: number;
}

export interface PromotedJobSummary {
  id: string;
  name: string;
  queueId: string;
  scheduledAt: Date | null;
}

export interface DispatchedRecurringJobSummary {
  jobId: string;
  scheduledJobId: string;
  name: string;
  queueId: string;
  nextRunAt: Date;
}

export class Scheduler {
  private isRunning = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private cronTimer: NodeJS.Timeout | null = null;
  private isTickInProgress = false;
  private isCronInProgress = false;

  readonly projectId?: string;
  readonly pollIntervalMs: number;
  readonly cronIntervalMs: number;
  readonly batchSize: number;

  constructor(
    private readonly pool: Pool,
    options: SchedulerOptions = {}
  ) {
    this.projectId = options.projectId;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.cronIntervalMs = options.cronIntervalMs ?? 1000;
    this.batchSize = options.batchSize ?? 50;
  }

  /**
   * Start the scheduler loops for delayed/scheduled jobs and recurring cron jobs.
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    logger.info('Scheduler started', {
      projectId: this.projectId,
      pollIntervalMs: this.pollIntervalMs,
      cronIntervalMs: this.cronIntervalMs,
      batchSize: this.batchSize,
    });

    // Run initial ticks immediately
    this.tickDelayedJobs().catch((err) => {
      logger.error('Error during initial delayed jobs tick', { error: err });
    });

    this.tickCronJobs().catch((err) => {
      logger.error('Error during initial cron jobs tick', { error: err });
    });

    // Schedule recurring loops
    this.pollTimer = setInterval(() => {
      this.tickDelayedJobs().catch((err) => {
        logger.error('Error during delayed jobs tick', { error: err });
      });
    }, this.pollIntervalMs);

    this.cronTimer = setInterval(() => {
      this.tickCronJobs().catch((err) => {
        logger.error('Error during cron jobs tick', { error: err });
      });
    }, this.cronIntervalMs);
  }

  /**
   * Stop the scheduler cleanly.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.cronTimer) {
      clearInterval(this.cronTimer);
      this.cronTimer = null;
    }

    logger.info('Scheduler stopped');
  }

  /**
   * Identifies delayed and scheduled jobs whose execution time has arrived
   * and atomically transitions them from SCHEDULED to PENDING (QUEUED).
   *
   * Uses `FOR UPDATE SKIP LOCKED` for zero-conflict multi-instance safety.
   */
  async promoteDueJobs(batchLimit = this.batchSize): Promise<PromotedJobSummary[]> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const projectFilter = this.projectId ? `AND q.project_id = $2::UUID` : '';
      const params: unknown[] = [batchLimit];
      if (this.projectId) params.push(this.projectId);

      const query = `
        WITH due_jobs AS (
          SELECT j.id
          FROM jobs j
          JOIN queues q ON q.id = j.queue_id
          WHERE (
              (j.status = 'scheduled' AND j.scheduled_at <= NOW())
              OR (j.status = 'failed' AND j.next_attempt_at IS NOT NULL AND j.next_attempt_at <= NOW() AND j.attempt_count < j.max_attempts)
            )
            AND q.status != 'archived'
            ${projectFilter}
          ORDER BY COALESCE(j.scheduled_at, j.next_attempt_at) ASC
          LIMIT $1
          FOR UPDATE OF j SKIP LOCKED
        )
        UPDATE jobs
        SET status = 'pending',
            enqueued_at = NOW(),
            updated_at = NOW()
        FROM due_jobs
        WHERE jobs.id = due_jobs.id
        RETURNING jobs.id, jobs.name, jobs.queue_id, jobs.scheduled_at
      `;

      const result = await client.query(query, params);
      const promotedJobs: PromotedJobSummary[] = result.rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        queueId: row.queue_id,
        scheduledAt: row.scheduled_at ? new Date(row.scheduled_at) : null,
      }));

      // Append audit logs for promoted jobs
      for (const job of promotedJobs) {
        await client.query(
          `
          INSERT INTO job_logs (job_id, level, message, metadata)
          VALUES ($1, 'info', 'Job promoted from scheduled to queued (pending) for worker execution', $2)
          `,
          [
            job.id,
            JSON.stringify({
              promotedAt: new Date().toISOString(),
              scheduledAt: job.scheduledAt?.toISOString() ?? null,
            }),
          ]
        );
      }

      await client.query('COMMIT');

      if (promotedJobs.length > 0) {
        logger.info(`Promoted ${promotedJobs.length} due jobs to pending state`);
      }

      return promotedJobs;
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('Failed to promote due jobs', { error: err });
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Identifies recurring cron job definitions that are due, creates child job instances in PENDING state,
   * updates next_run_at metadata, handles missed schedules and overlap avoidance.
   *
   * Uses `FOR UPDATE SKIP LOCKED` for zero-conflict multi-instance safety.
   */
  async dispatchDueRecurringJobs(
    batchLimit = this.batchSize
  ): Promise<DispatchedRecurringJobSummary[]> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const projectFilter = this.projectId ? `AND q.project_id = $2::UUID` : '';
      const params: unknown[] = [batchLimit];
      if (this.projectId) params.push(this.projectId);

      // Select due scheduled jobs with row-level lock
      const selectQuery = `
        SELECT s.*, q.project_id
        FROM scheduled_jobs s
        JOIN queues q ON q.id = s.queue_id
        WHERE s.enabled = TRUE
          AND q.status != 'archived'
          AND (s.next_run_at IS NULL OR s.next_run_at <= NOW())
          ${projectFilter}
        ORDER BY s.next_run_at ASC NULLS FIRST
        LIMIT $1
        FOR UPDATE OF s SKIP LOCKED
      `;

      const dueRes = await client.query(selectQuery, params);
      const dispatchedJobs: DispatchedRecurringJobSummary[] = [];

      for (const sched of dueRes.rows) {
        // 1. Check skip_if_running overlap rule
        if (sched.skip_if_running && sched.last_job_id) {
          const lastJobRes = await client.query(`SELECT status FROM jobs WHERE id = $1`, [
            sched.last_job_id,
          ]);

          if (
            lastJobRes.rows.length > 0 &&
            (lastJobRes.rows[0].status === JobStatus.PENDING ||
              lastJobRes.rows[0].status === JobStatus.RUNNING)
          ) {
            // Compute next run and skip this execution to avoid overlap
            const nextRunAt = this.calculateNextRun(
              sched.cron_expression,
              sched.timezone,
              new Date()
            );

            await client.query(
              `UPDATE scheduled_jobs SET next_run_at = $1, updated_at = NOW() WHERE id = $2`,
              [nextRunAt, sched.id]
            );

            logger.warn(
              `Skipping scheduled job '${sched.name}' (${sched.id}) - previous instance ${sched.last_job_id} is still running`
            );
            continue;
          }
        }

        // 2. Missed Schedule Handling: calculate the upcoming run date relative to NOW()
        // If the schedule was missed (e.g. downtime), we fire the single latest execution and advance to the next future slot
        const nextRunAt = this.calculateNextRun(sched.cron_expression, sched.timezone, new Date());

        // 3. Create the job instance in 'pending' status
        const insertJobQuery = `
          INSERT INTO jobs (
            queue_id, scheduled_job_id, name, type, status,
            payload, priority, scheduled_at, timeout_ms, max_attempts,
            enqueued_at, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, 'pending', $5, $6, NOW(), $7, $8, NOW(), NOW(), NOW())
          RETURNING id, name, queue_id, scheduled_job_id
        `;

        const jobValues = [
          sched.queue_id,
          sched.id,
          sched.name,
          JobType.RECURRING,
          JSON.stringify(sched.payload_template ?? {}),
          sched.priority ?? 5,
          sched.timeout_ms ?? null,
          sched.max_attempts ?? 3,
        ];

        const newJobRes = await client.query(insertJobQuery, jobValues);
        const newJob = newJobRes.rows[0];

        // 4. Update scheduled_jobs metadata
        await client.query(
          `
          UPDATE scheduled_jobs
          SET last_fired_at = NOW(),
              last_job_id = $1,
              next_run_at = $2,
              run_count = run_count + 1,
              updated_at = NOW()
          WHERE id = $3
          `,
          [newJob.id, nextRunAt, sched.id]
        );

        // 5. Append audit log
        await client.query(
          `
          INSERT INTO job_logs (job_id, level, message, metadata)
          VALUES ($1, 'info', 'Spawned recurring job execution from template', $2)
          `,
          [
            newJob.id,
            JSON.stringify({
              scheduledJobId: sched.id,
              cronExpression: sched.cron_expression,
              timezone: sched.timezone,
              firedAt: new Date().toISOString(),
              nextRunAt: nextRunAt.toISOString(),
            }),
          ]
        );

        dispatchedJobs.push({
          jobId: newJob.id,
          scheduledJobId: sched.id,
          name: sched.name,
          queueId: sched.queue_id,
          nextRunAt,
        });
      }

      await client.query('COMMIT');

      if (dispatchedJobs.length > 0) {
        logger.info(`Dispatched ${dispatchedJobs.length} recurring cron jobs to pending state`);
      }

      return dispatchedJobs;
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('Failed to dispatch recurring cron jobs', { error: err });
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Helper to calculate next execution timestamp from cron expression.
   */
  calculateNextRun(cronExpression: string, timezone = 'UTC', baseDate = new Date()): Date {
    try {
      const interval = cronParser.parseExpression(cronExpression, {
        currentDate: baseDate,
        tz: timezone,
      });
      return interval.next().toDate();
    } catch (err) {
      logger.error(`Invalid cron expression '${cronExpression}'`, { error: err });
      // Fallback: 1 hour from now if parsing fails
      return new Date(Date.now() + 3600000);
    }
  }

  /**
   * Internal tick runner for delayed jobs with Redis leader-election coordination.
   */
  private async tickDelayedJobs(): Promise<void> {
    if (!this.isRunning || this.isTickInProgress) return;
    this.isTickInProgress = true;
    let lock: { release: () => Promise<unknown> } | null = null;
    try {
      try {
        const lockKey = this.projectId
          ? `scheduler:delayed_jobs:${this.projectId}:leader`
          : 'scheduler:delayed_jobs:global:leader';
        lock = await tryAcquireLock(lockKey, Math.max(3000, this.pollIntervalMs * 2));
      } catch {
        // Standalone mode or Redis offline — fall back to transactional SKIP LOCKED
      }

      await this.promoteDueJobs();
    } finally {
      if (lock) {
        lock.release().catch(() => {});
      }
      this.isTickInProgress = false;
    }
  }

  /**
   * Internal tick runner for cron jobs with Redis leader-election coordination.
   */
  private async tickCronJobs(): Promise<void> {
    if (!this.isRunning || this.isCronInProgress) return;
    this.isCronInProgress = true;
    let lock: { release: () => Promise<unknown> } | null = null;
    try {
      try {
        const lockKey = this.projectId
          ? `scheduler:cron_jobs:${this.projectId}:leader`
          : 'scheduler:cron_jobs:global:leader';
        lock = await tryAcquireLock(lockKey, Math.max(3000, this.cronIntervalMs * 2));
      } catch {
        // Standalone mode or Redis offline — fall back to transactional SKIP LOCKED
      }

      await this.dispatchDueRecurringJobs();
    } finally {
      if (lock) {
        lock.release().catch(() => {});
      }
      this.isCronInProgress = false;
    }
  }

  getStatus(): { isRunning: boolean; pollIntervalMs: number; cronIntervalMs: number } {
    return {
      isRunning: this.isRunning,
      pollIntervalMs: this.pollIntervalMs,
      cronIntervalMs: this.cronIntervalMs,
    };
  }
}
