import { Pool } from 'pg';
import { DLQStatus } from '@job-scheduler/shared';

export interface DLQJobResponse {
  id: string;
  jobId: string;
  queueId: string;
  queueName?: string;
  projectId?: string;
  projectName?: string;
  name: string;
  payload: Record<string, unknown>;
  totalAttempts: number;
  finalErrorMessage: string | null;
  finalErrorCode: string | null;
  failedWorkerId: string | null;
  failedWorkerHostname?: string | null;
  status: DLQStatus;
  firstFailedAt: Date;
  lastFailedAt: Date;
  movedToDlqAt: Date;
  requeuedAt: Date | null;
  requeuedJobId: string | null;
  requeuedBy: string | null;
  archivedAt: Date | null;
  archivedBy: string | null;
  createdAt: Date;
}

export interface DLQStatsResponse {
  totalDlqJobs: number;
  unhandledCount: number;
  retriedCount: number;
  archivedCount: number;
  byQueue: Array<{
    queueId: string;
    queueName: string;
    count: number;
  }>;
  topErrorCodes: Array<{
    errorCode: string;
    count: number;
  }>;
  recentFailures: DLQJobResponse[];
}

export interface DLQListFilters {
  queueId?: string;
  projectId?: string;
  status?: DLQStatus;
  search?: string;
  page?: number;
  pageSize?: number;
  userId?: string;
}

export class DeadLetterJobRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Insert or update a Dead Letter Queue snapshot record.
   */
  async create(data: {
    jobId: string;
    queueId: string;
    name: string;
    payload?: Record<string, unknown>;
    totalAttempts: number;
    finalErrorMessage?: string | null;
    finalErrorCode?: string | null;
    failedWorkerId?: string | null;
    firstFailedAt?: Date;
    lastFailedAt?: Date;
  }): Promise<DLQJobResponse> {
    const query = `
      INSERT INTO dead_letter_jobs (
        job_id, queue_id, name, payload, total_attempts,
        final_error_message, final_error_code, failed_worker_id,
        first_failed_at, last_failed_at, moved_to_dlq_at, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), 'unhandled')
      ON CONFLICT (job_id) DO UPDATE
      SET total_attempts = EXCLUDED.total_attempts,
          final_error_message = EXCLUDED.final_error_message,
          final_error_code = EXCLUDED.final_error_code,
          failed_worker_id = EXCLUDED.failed_worker_id,
          last_failed_at = EXCLUDED.last_failed_at,
          moved_to_dlq_at = NOW(),
          status = 'unhandled'
      RETURNING id, job_id, queue_id, name, payload, total_attempts,
                final_error_message, final_error_code, failed_worker_id,
                status, first_failed_at, last_failed_at, moved_to_dlq_at,
                requeued_at, requeued_job_id, requeued_by,
                archived_at, archived_by, created_at
    `;

    const values = [
      data.jobId,
      data.queueId,
      data.name,
      JSON.stringify(data.payload ?? {}),
      data.totalAttempts,
      data.finalErrorMessage ?? null,
      data.finalErrorCode ?? null,
      data.failedWorkerId ?? null,
      data.firstFailedAt ?? new Date(),
      data.lastFailedAt ?? new Date(),
    ];

    const result = await this.pool.query(query, values);
    return this.mapToResponse(result.rows[0]);
  }

  /**
   * List DLQ jobs with filtering and pagination.
   */
  async list(filters: DLQListFilters): Promise<{
    data: DLQJobResponse[];
    pagination: { total: number; page: number; pageSize: number; totalPages: number };
  }> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.max(1, Math.min(100, filters.pageSize ?? 20));
    const offset = (page - 1) * pageSize;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    // RBAC: If userId is provided, ensure user has access via org_members
    if (filters.userId) {
      params.push(filters.userId);
      conditions.push(`
        q.project_id IN (
          SELECT p2.id FROM projects p2
          JOIN organization_members om ON om.organization_id = p2.organization_id
          WHERE om.user_id = $${paramIndex++}
        )
      `);
    }

    if (filters.queueId) {
      params.push(filters.queueId);
      conditions.push(`d.queue_id = $${paramIndex++}`);
    }

    if (filters.projectId) {
      params.push(filters.projectId);
      conditions.push(`q.project_id = $${paramIndex++}`);
    }

    if (filters.status) {
      params.push(filters.status);
      conditions.push(`d.status = $${paramIndex++}`);
    }

    if (filters.search) {
      params.push(`%${filters.search}%`);
      conditions.push(
        `(d.name ILIKE $${paramIndex} OR d.final_error_message ILIKE $${paramIndex} OR d.final_error_code ILIKE $${paramIndex})`
      );
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countQuery = `
      SELECT COUNT(*)
      FROM dead_letter_jobs d
      JOIN queues q ON q.id = d.queue_id
      ${whereClause}
    `;

    const countRes = await this.pool.query(countQuery, params);
    const total = parseInt(countRes.rows[0].count, 10);

    const query = `
      SELECT d.id, d.job_id, d.queue_id, d.name, d.payload, d.total_attempts,
             d.final_error_message, d.final_error_code, d.failed_worker_id,
             d.status, d.first_failed_at, d.last_failed_at, d.moved_to_dlq_at,
             d.requeued_at, d.requeued_job_id, d.requeued_by,
             d.archived_at, d.archived_by, d.created_at,
             q.name as queue_name, q.project_id, p.name as project_name,
             w.hostname as failed_worker_hostname
      FROM dead_letter_jobs d
      JOIN queues q ON q.id = d.queue_id
      JOIN projects p ON p.id = q.project_id
      LEFT JOIN workers w ON w.id = d.failed_worker_id
      ${whereClause}
      ORDER BY d.moved_to_dlq_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    params.push(pageSize, offset);
    const result = await this.pool.query(query, params);

    return {
      data: result.rows.map((row) => this.mapToResponse(row)),
      pagination: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize) || 1,
      },
    };
  }

  /**
   * Find DLQ item by DLQ ID.
   */
  async findById(id: string): Promise<DLQJobResponse | null> {
    const query = `
      SELECT d.id, d.job_id, d.queue_id, d.name, d.payload, d.total_attempts,
             d.final_error_message, d.final_error_code, d.failed_worker_id,
             d.status, d.first_failed_at, d.last_failed_at, d.moved_to_dlq_at,
             d.requeued_at, d.requeued_job_id, d.requeued_by,
             d.archived_at, d.archived_by, d.created_at,
             q.name as queue_name, q.project_id, p.name as project_name,
             w.hostname as failed_worker_hostname
      FROM dead_letter_jobs d
      JOIN queues q ON q.id = d.queue_id
      JOIN projects p ON p.id = q.project_id
      LEFT JOIN workers w ON w.id = d.failed_worker_id
      WHERE d.id = $1
    `;
    const result = await this.pool.query(query, [id]);
    if (result.rows.length === 0) return null;
    return this.mapToResponse(result.rows[0]);
  }

  /**
   * Find DLQ item by original Job ID.
   */
  async findByJobId(jobId: string): Promise<DLQJobResponse | null> {
    const query = `
      SELECT d.id, d.job_id, d.queue_id, d.name, d.payload, d.total_attempts,
             d.final_error_message, d.final_error_code, d.failed_worker_id,
             d.status, d.first_failed_at, d.last_failed_at, d.moved_to_dlq_at,
             d.requeued_at, d.requeued_job_id, d.requeued_by,
             d.archived_at, d.archived_by, d.created_at,
             q.name as queue_name, q.project_id, p.name as project_name,
             w.hostname as failed_worker_hostname
      FROM dead_letter_jobs d
      JOIN queues q ON q.id = d.queue_id
      JOIN projects p ON p.id = q.project_id
      LEFT JOIN workers w ON w.id = d.failed_worker_id
      WHERE d.job_id = $1
    `;
    const result = await this.pool.query(query, [jobId]);
    if (result.rows.length === 0) return null;
    return this.mapToResponse(result.rows[0]);
  }

  /**
   * Re-queue a DLQ job back into active queue for execution.
   */
  async requeue(
    dlqId: string,
    requeuedByUserId: string
  ): Promise<{ dlq: DLQJobResponse; jobId: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const dlqRes = await client.query(`SELECT * FROM dead_letter_jobs WHERE id = $1 FOR UPDATE`, [
        dlqId,
      ]);
      if (dlqRes.rows.length === 0) {
        throw new Error(`DLQ record not found: ${dlqId}`);
      }

      const dlqRow = dlqRes.rows[0];
      const jobId = dlqRow.job_id;

      // 1. Reset original job back to pending state
      await client.query(
        `
        UPDATE jobs
        SET status = 'pending',
            worker_id = NULL,
            attempt_count = 0,
            error_message = NULL,
            error_code = NULL,
            next_attempt_at = NULL,
            started_at = NULL,
            finished_at = NULL,
            updated_at = NOW()
        WHERE id = $1
        `,
        [jobId]
      );

      // 2. Update DLQ row marking it retried
      const updateDlqQuery = `
        UPDATE dead_letter_jobs
        SET status = 'retried',
            requeued_at = NOW(),
            requeued_by = $2,
            requeued_job_id = $3
        WHERE id = $1
        RETURNING id, job_id, queue_id, name, payload, total_attempts,
                  final_error_message, final_error_code, failed_worker_id,
                  status, first_failed_at, last_failed_at, moved_to_dlq_at,
                  requeued_at, requeued_job_id, requeued_by,
                  archived_at, archived_by, created_at
      `;

      const updatedDlqRes = await client.query(updateDlqQuery, [dlqId, requeuedByUserId, jobId]);

      // 3. Record audit log
      await client.query(
        `
        INSERT INTO job_logs (job_id, level, message, metadata)
        VALUES ($1, 'info', 'Job re-queued from Dead Letter Queue', $2)
        `,
        [
          jobId,
          JSON.stringify({
            dlqId,
            requeuedBy: requeuedByUserId,
            timestamp: new Date().toISOString(),
          }),
        ]
      );

      await client.query('COMMIT');
      return {
        dlq: this.mapToResponse(updatedDlqRes.rows[0]),
        jobId,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Mark a DLQ job as archived.
   */
  async archive(dlqId: string, archivedByUserId?: string): Promise<DLQJobResponse | null> {
    const query = `
      UPDATE dead_letter_jobs
      SET status = 'archived',
          archived_at = NOW(),
          archived_by = $2
      WHERE id = $1
      RETURNING id, job_id, queue_id, name, payload, total_attempts,
                final_error_message, final_error_code, failed_worker_id,
                status, first_failed_at, last_failed_at, moved_to_dlq_at,
                requeued_at, requeued_job_id, requeued_by,
                archived_at, archived_by, created_at
    `;
    const result = await this.pool.query(query, [dlqId, archivedByUserId ?? null]);
    if (result.rows.length === 0) return null;
    return this.mapToResponse(result.rows[0]);
  }

  /**
   * Permanently delete a DLQ record.
   */
  async delete(dlqId: string): Promise<boolean> {
    const result = await this.pool.query(`DELETE FROM dead_letter_jobs WHERE id = $1`, [dlqId]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Get dashboard-ready DLQ statistics.
   */
  async getStats(
    options: { projectId?: string; queueId?: string; userId?: string } = {}
  ): Promise<DLQStatsResponse> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (options.userId) {
      params.push(options.userId);
      conditions.push(`
        q.project_id IN (
          SELECT p2.id FROM projects p2
          JOIN organization_members om ON om.organization_id = p2.organization_id
          WHERE om.user_id = $${paramIndex++}
        )
      `);
    }

    if (options.queueId) {
      params.push(options.queueId);
      conditions.push(`d.queue_id = $${paramIndex++}`);
    }

    if (options.projectId) {
      params.push(options.projectId);
      conditions.push(`q.project_id = $${paramIndex++}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // 1. Overall counts by status
    const statusQuery = `
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE d.status = 'unhandled') as unhandled,
        COUNT(*) FILTER (WHERE d.status = 'retried') as retried,
        COUNT(*) FILTER (WHERE d.status = 'archived') as archived
      FROM dead_letter_jobs d
      JOIN queues q ON q.id = d.queue_id
      ${whereClause}
    `;
    const statusRes = await this.pool.query(statusQuery, params);
    const statusRow = statusRes.rows[0];

    // 2. Breakdown by queue
    const queueBreakdownQuery = `
      SELECT d.queue_id, q.name as queue_name, COUNT(*) as count
      FROM dead_letter_jobs d
      JOIN queues q ON q.id = d.queue_id
      ${whereClause}
      GROUP BY d.queue_id, q.name
      ORDER BY count DESC
      LIMIT 10
    `;
    const queueRes = await this.pool.query(queueBreakdownQuery, params);

    // 3. Top error codes
    const errorCodesQuery = `
      SELECT COALESCE(d.final_error_code, 'UNKNOWN_ERROR') as error_code, COUNT(*) as count
      FROM dead_letter_jobs d
      JOIN queues q ON q.id = d.queue_id
      ${whereClause}
      GROUP BY COALESCE(d.final_error_code, 'UNKNOWN_ERROR')
      ORDER BY count DESC
      LIMIT 10
    `;
    const errorRes = await this.pool.query(errorCodesQuery, params);

    // 4. 5 Most recent DLQ failures
    const recentQuery = `
      SELECT d.id, d.job_id, d.queue_id, d.name, d.payload, d.total_attempts,
             d.final_error_message, d.final_error_code, d.failed_worker_id,
             d.status, d.first_failed_at, d.last_failed_at, d.moved_to_dlq_at,
             d.requeued_at, d.requeued_job_id, d.requeued_by,
             d.archived_at, d.archived_by, d.created_at,
             q.name as queue_name, q.project_id, p.name as project_name,
             w.hostname as failed_worker_hostname
      FROM dead_letter_jobs d
      JOIN queues q ON q.id = d.queue_id
      JOIN projects p ON p.id = q.project_id
      LEFT JOIN workers w ON w.id = d.failed_worker_id
      ${whereClause}
      ORDER BY d.moved_to_dlq_at DESC
      LIMIT 5
    `;
    const recentRes = await this.pool.query(recentQuery, params);

    return {
      totalDlqJobs: parseInt(statusRow.total || '0', 10),
      unhandledCount: parseInt(statusRow.unhandled || '0', 10),
      retriedCount: parseInt(statusRow.retried || '0', 10),
      archivedCount: parseInt(statusRow.archived || '0', 10),
      byQueue: queueRes.rows.map((r) => ({
        queueId: r.queue_id,
        queueName: r.queue_name,
        count: parseInt(r.count, 10),
      })),
      topErrorCodes: errorRes.rows.map((r) => ({
        errorCode: r.error_code,
        count: parseInt(r.count, 10),
      })),
      recentFailures: recentRes.rows.map((r) => this.mapToResponse(r)),
    };
  }

  private mapToResponse(row: Record<string, unknown>): DLQJobResponse {
    return {
      id: row.id as string,
      jobId: row.job_id as string,
      queueId: row.queue_id as string,
      queueName: (row.queue_name as string) ?? undefined,
      projectId: (row.project_id as string) ?? undefined,
      projectName: (row.project_name as string) ?? undefined,
      name: row.name as string,
      payload: row.payload
        ? typeof row.payload === 'string'
          ? JSON.parse(row.payload)
          : (row.payload as Record<string, unknown>)
        : {},
      totalAttempts: parseInt(row.total_attempts as string, 10),
      finalErrorMessage: (row.final_error_message as string) ?? null,
      finalErrorCode: (row.final_error_code as string) ?? null,
      failedWorkerId: (row.failed_worker_id as string) ?? null,
      failedWorkerHostname: (row.failed_worker_hostname as string) ?? null,
      status: (row.status as DLQStatus) || DLQStatus.UNHANDLED,
      firstFailedAt: new Date(row.first_failed_at as string),
      lastFailedAt: new Date(row.last_failed_at as string),
      movedToDlqAt: new Date(row.moved_to_dlq_at as string),
      requeuedAt: row.requeued_at ? new Date(row.requeued_at as string) : null,
      requeuedJobId: (row.requeued_job_id as string) ?? null,
      requeuedBy: (row.requeued_by as string) ?? null,
      archivedAt: row.archived_at ? new Date(row.archived_at as string) : null,
      archivedBy: (row.archived_by as string) ?? null,
      createdAt: new Date(row.created_at as string),
    };
  }
}
