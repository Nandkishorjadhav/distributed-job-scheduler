import { Pool } from 'pg';
import { QueueStatus, RetryPolicy, RetryStrategy } from '@job-scheduler/shared';

export interface QueueResponse {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  priority: number;
  concurrencyLimit: number;
  status: QueueStatus;
  retryPolicy: RetryPolicy;
  dlqEnabled: boolean;
  pausedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface QueueStatsResponse {
  queueId: string;
  queuedJobs: number;
  runningJobs: number;
  completedJobs: number;
  failedJobs: number;
  retryingJobs: number;
  deadLetterJobs: number;
  scheduledJobs: number;
  totalJobs: number;
}

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  strategy: RetryStrategy.EXPONENTIAL,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  jitterMs: 500,
};

export class QueueRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Create a new queue within a project.
   */
  async create(data: {
    projectId: string;
    name: string;
    description?: string;
    priority?: number;
    concurrencyLimit?: number;
    retryPolicy?: RetryPolicy;
    dlqEnabled?: boolean;
  }): Promise<QueueResponse> {
    const query = `
      INSERT INTO queues (
        project_id, name, description, priority, concurrency_limit, dlq_enabled
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, project_id, name, description, priority, concurrency_limit, status, dlq_enabled, paused_at, created_at, updated_at
    `;
    const values = [
      data.projectId,
      data.name.trim(),
      data.description ? data.description.trim() : null,
      data.priority ?? 5,
      data.concurrencyLimit ?? 10,
      data.dlqEnabled ?? true,
    ];
    const result = await this.pool.query(query, values);
    return this.mapToResponse(result.rows[0], data.retryPolicy);
  }

  /**
   * Find a queue by ID.
   */
  async findById(id: string): Promise<QueueResponse | null> {
    const query = `
      SELECT id, project_id, name, description, priority, concurrency_limit, status, dlq_enabled, paused_at, created_at, updated_at
      FROM queues
      WHERE id = $1 AND status != 'archived'
    `;
    const result = await this.pool.query(query, [id]);
    if (result.rows.length === 0) return null;
    return this.mapToResponse(result.rows[0]);
  }

  /**
   * Find a queue by Project ID and name.
   */
  async findByProjectAndName(projectId: string, name: string): Promise<QueueResponse | null> {
    const query = `
      SELECT id, project_id, name, description, priority, concurrency_limit, status, dlq_enabled, paused_at, created_at, updated_at
      FROM queues
      WHERE project_id = $1 AND name = $2 AND status != 'archived'
    `;
    const result = await this.pool.query(query, [projectId, name.trim()]);
    if (result.rows.length === 0) return null;
    return this.mapToResponse(result.rows[0]);
  }

  /**
   * Update queue configuration.
   */
  async update(
    id: string,
    data: {
      name?: string;
      description?: string;
      priority?: number;
      concurrencyLimit?: number;
      dlqEnabled?: boolean;
    }
  ): Promise<QueueResponse | null> {
    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(data.name.trim());
    }

    if (data.description !== undefined) {
      updates.push(`description = $${idx++}`);
      values.push(data.description ? data.description.trim() : null);
    }

    if (data.priority !== undefined) {
      updates.push(`priority = $${idx++}`);
      values.push(data.priority);
    }

    if (data.concurrencyLimit !== undefined) {
      updates.push(`concurrency_limit = $${idx++}`);
      values.push(data.concurrencyLimit);
    }

    if (data.dlqEnabled !== undefined) {
      updates.push(`dlq_enabled = $${idx++}`);
      values.push(data.dlqEnabled);
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    const query = `
      UPDATE queues
      SET ${updates.join(', ')}
      WHERE id = $${idx} AND status != 'archived'
      RETURNING id, project_id, name, description, priority, concurrency_limit, status, dlq_enabled, paused_at, created_at, updated_at
    `;

    const result = await this.pool.query(query, values);
    if (result.rows.length === 0) return null;
    return this.mapToResponse(result.rows[0]);
  }

  /**
   * Pause a queue.
   */
  async pause(id: string): Promise<QueueResponse | null> {
    const query = `
      UPDATE queues
      SET status = 'paused', paused_at = NOW()
      WHERE id = $1 AND status != 'archived'
      RETURNING id, project_id, name, description, priority, concurrency_limit, status, dlq_enabled, paused_at, created_at, updated_at
    `;
    const result = await this.pool.query(query, [id]);
    if (result.rows.length === 0) return null;
    return this.mapToResponse(result.rows[0]);
  }

  /**
   * Resume a paused queue.
   */
  async resume(id: string): Promise<QueueResponse | null> {
    const query = `
      UPDATE queues
      SET status = 'active', paused_at = NULL
      WHERE id = $1 AND status != 'archived'
      RETURNING id, project_id, name, description, priority, concurrency_limit, status, dlq_enabled, paused_at, created_at, updated_at
    `;
    const result = await this.pool.query(query, [id]);
    if (result.rows.length === 0) return null;
    return this.mapToResponse(result.rows[0]);
  }

  /**
   * Delete a queue safely where no active or pending jobs exist.
   */
  async delete(id: string): Promise<{ success: boolean; reason?: string }> {
    const checkQuery = `
      SELECT COUNT(*)
      FROM jobs
      WHERE queue_id = $1 AND status IN ('pending', 'running')
    `;
    const checkResult = await this.pool.query(checkQuery, [id]);
    const activeJobs = parseInt(checkResult.rows[0].count, 10);

    if (activeJobs > 0) {
      return {
        success: false,
        reason: `Cannot delete queue with ${activeJobs} pending or running job(s). Wait for jobs to finish or cancel them first.`,
      };
    }

    const deleteQuery = `
      UPDATE queues
      SET status = 'archived'
      WHERE id = $1 AND status != 'archived'
    `;
    const result = await this.pool.query(deleteQuery, [id]);
    return { success: (result.rowCount ?? 0) > 0 };
  }

  /**
   * List queues accessible to a user with pagination and optional projectId filter.
   */
  async listByUser(
    userId: string,
    page: number,
    pageSize: number,
    projectId?: string
  ): Promise<{ data: QueueResponse[]; total: number }> {
    const offset = (page - 1) * pageSize;
    const params: unknown[] = [userId];
    let projectCondition = '';

    if (projectId) {
      params.push(projectId);
      projectCondition = `AND q.project_id = $${params.length}`;
    }

    const countQuery = `
      SELECT COUNT(*)
      FROM queues q
      JOIN projects p ON p.id = q.project_id
      JOIN organization_members m ON m.organization_id = p.organization_id
      WHERE m.user_id = $1 AND q.status != 'archived' AND p.is_active = TRUE ${projectCondition}
    `;
    const countResult = await this.pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count, 10);

    params.push(pageSize, offset);
    const dataQuery = `
      SELECT q.id, q.project_id, q.name, q.description, q.priority, q.concurrency_limit, q.status, q.dlq_enabled, q.paused_at, q.created_at, q.updated_at
      FROM queues q
      JOIN projects p ON p.id = q.project_id
      JOIN organization_members m ON m.organization_id = p.organization_id
      WHERE m.user_id = $1 AND q.status != 'archived' AND p.is_active = TRUE ${projectCondition}
      ORDER BY q.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const dataResult = await this.pool.query(dataQuery, params);

    const data = dataResult.rows.map((row) => this.mapToResponse(row));
    return { data, total };
  }

  /**
   * Retrieve statistics for a queue (queued, running, completed, failed, retrying, dead-letter, total).
   */
  async getQueueStats(queueId: string): Promise<QueueStatsResponse> {
    const query = `
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
        COUNT(*) FILTER (WHERE status = 'scheduled') AS scheduled_count,
        COUNT(*) FILTER (WHERE status = 'running') AS running_count,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed_count,
        COUNT(*) FILTER (WHERE status = 'failed' AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())) AS failed_count,
        COUNT(*) FILTER (WHERE status = 'failed' AND next_attempt_at > NOW()) AS retrying_count,
        COUNT(*) FILTER (WHERE status = 'dead') AS dead_count,
        COUNT(*) AS total_count
      FROM jobs
      WHERE queue_id = $1
    `;
    const result = await this.pool.query(query, [queueId]);
    const row = result.rows[0];

    const pending = parseInt(row.pending_count || '0', 10);
    const scheduled = parseInt(row.scheduled_count || '0', 10);

    return {
      queueId,
      queuedJobs: pending + scheduled,
      runningJobs: parseInt(row.running_count || '0', 10),
      completedJobs: parseInt(row.completed_count || '0', 10),
      failedJobs: parseInt(row.failed_count || '0', 10),
      retryingJobs: parseInt(row.retrying_count || '0', 10),
      deadLetterJobs: parseInt(row.dead_count || '0', 10),
      scheduledJobs: scheduled,
      totalJobs: parseInt(row.total_count || '0', 10),
    };
  }

  private mapToResponse(row: Record<string, unknown>, retryPolicy?: RetryPolicy): QueueResponse {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      name: row.name as string,
      description: (row.description as string) ?? null,
      priority: parseInt(row.priority as string, 10),
      concurrencyLimit: parseInt(row.concurrency_limit as string, 10),
      status: row.status as QueueStatus,
      retryPolicy: retryPolicy ?? DEFAULT_RETRY_POLICY,
      dlqEnabled: row.dlq_enabled as boolean,
      pausedAt: row.paused_at ? new Date(row.paused_at as string) : null,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
