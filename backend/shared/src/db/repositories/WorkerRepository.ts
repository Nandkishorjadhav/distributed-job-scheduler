import { Pool } from 'pg';
import { WorkerStatus } from '@job-scheduler/shared';

export interface WorkerResponse {
  id: string;
  projectId: string;
  projectName?: string;
  hostname: string;
  ipAddress: string | null;
  pid: number;
  version: string | null;
  status: WorkerStatus;
  calculatedStatus?: WorkerStatus;
  maxConcurrency: number;
  currentJobCount: number;
  lastHeartbeatAt: Date;
  registeredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkerHeartbeatRecord {
  id: number;
  workerId: string;
  status: WorkerStatus;
  currentJobCount: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface WorkerListFilters {
  projectId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
  userId?: string;
  heartbeatTimeoutSeconds?: number;
}

export class WorkerRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Register a new worker process.
   */
  async register(data: {
    projectId: string;
    hostname: string;
    ipAddress?: string | null;
    pid: number;
    version?: string | null;
    maxConcurrency?: number;
  }): Promise<WorkerResponse> {
    const query = `
      INSERT INTO workers (
        project_id, hostname, ip_address, pid, version, max_concurrency, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'online')
      RETURNING id, project_id, hostname, ip_address, pid, version, status,
                max_concurrency, current_job_count, last_heartbeat_at, registered_at,
                created_at, updated_at
    `;

    const values = [
      data.projectId,
      data.hostname,
      data.ipAddress ?? null,
      data.pid,
      data.version ?? '1.0.0',
      data.maxConcurrency ?? 5,
    ];

    const result = await this.pool.query(query, values);
    return this.mapToResponse(result.rows[0]);
  }

  /**
   * Heartbeat from worker to refresh liveness and record telemetry.
   */
  async heartbeat(
    workerId: string,
    data: {
      currentJobCount?: number;
      metadata?: Record<string, unknown>;
      status?: WorkerStatus;
    } = {}
  ): Promise<WorkerResponse | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Fetch worker to calculate status if not explicitly given
      const currentWorkerRes = await client.query(
        `SELECT max_concurrency, status FROM workers WHERE id = $1 FOR UPDATE`,
        [workerId]
      );
      if (currentWorkerRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      const maxConcurrency = parseInt(currentWorkerRes.rows[0].max_concurrency, 10);
      const jobCount = data.currentJobCount ?? 0;

      let resolvedStatus: WorkerStatus = WorkerStatus.ONLINE;
      if (data.status) {
        resolvedStatus = data.status;
      } else if (jobCount >= maxConcurrency) {
        resolvedStatus = WorkerStatus.BUSY;
      } else {
        resolvedStatus = WorkerStatus.ONLINE;
      }

      // Update worker row
      const updateQuery = `
        UPDATE workers
        SET last_heartbeat_at = NOW(),
            current_job_count = $2,
            status = $3,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, project_id, hostname, ip_address, pid, version, status,
                  max_concurrency, current_job_count, last_heartbeat_at, registered_at,
                  created_at, updated_at
      `;

      const updateRes = await client.query(updateQuery, [workerId, jobCount, resolvedStatus]);

      // Record time-series heartbeat log
      await client.query(
        `
        INSERT INTO worker_heartbeats (worker_id, status, current_job_count, metadata)
        VALUES ($1, $2, $3, $4)
        `,
        [workerId, resolvedStatus, jobCount, JSON.stringify(data.metadata ?? {})]
      );

      await client.query('COMMIT');
      return this.mapToResponse(updateRes.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * List workers with pagination and filtering.
   */
  async list(filters: WorkerListFilters): Promise<{
    data: WorkerResponse[];
    pagination: { total: number; page: number; pageSize: number; totalPages: number };
  }> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.max(1, Math.min(100, filters.pageSize ?? 20));
    const offset = (page - 1) * pageSize;
    const timeoutSec = filters.heartbeatTimeoutSeconds ?? 30;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    // RBAC: If userId is provided, filter by project membership
    if (filters.userId) {
      params.push(filters.userId);
      conditions.push(`
        w.project_id IN (
          SELECT p.id FROM projects p
          JOIN organization_members om ON om.organization_id = p.organization_id
          WHERE om.user_id = $${paramIndex++}
        )
      `);
    }

    if (filters.projectId) {
      params.push(filters.projectId);
      conditions.push(`w.project_id = $${paramIndex++}`);
    }

    if (filters.status) {
      params.push(filters.status);
      conditions.push(`w.status = $${paramIndex++}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countQuery = `
      SELECT COUNT(*)
      FROM workers w
      ${whereClause}
    `;

    const countRes = await this.pool.query(countQuery, params);
    const total = parseInt(countRes.rows[0].count, 10);

    const query = `
      SELECT w.id, w.project_id, w.hostname, w.ip_address, w.pid, w.version, w.status,
             w.max_concurrency, w.current_job_count, w.last_heartbeat_at, w.registered_at,
             w.created_at, w.updated_at,
             p.name as project_name,
             CASE
               WHEN w.status IN ('stopped', 'offline') THEN 'stopped'
               WHEN w.last_heartbeat_at < NOW() - make_interval(secs => ${timeoutSec}) THEN 'unhealthy'
               WHEN w.current_job_count >= w.max_concurrency THEN 'busy'
               ELSE 'online'
             END as calculated_status
      FROM workers w
      JOIN projects p ON p.id = w.project_id
      ${whereClause}
      ORDER BY w.last_heartbeat_at DESC
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
   * Find a worker by ID with calculated health status.
   */
  async findById(workerId: string, timeoutSeconds = 30): Promise<WorkerResponse | null> {
    const query = `
      SELECT w.id, w.project_id, w.hostname, w.ip_address, w.pid, w.version, w.status,
             w.max_concurrency, w.current_job_count, w.last_heartbeat_at, w.registered_at,
             w.created_at, w.updated_at,
             p.name as project_name,
             CASE
               WHEN w.status IN ('stopped', 'offline') THEN 'stopped'
               WHEN w.last_heartbeat_at < NOW() - make_interval(secs => ${timeoutSeconds}) THEN 'unhealthy'
               WHEN w.current_job_count >= w.max_concurrency THEN 'busy'
               ELSE 'online'
             END as calculated_status
      FROM workers w
      JOIN projects p ON p.id = w.project_id
      WHERE w.id = $1
    `;
    const result = await this.pool.query(query, [workerId]);
    if (result.rows.length === 0) return null;
    return this.mapToResponse(result.rows[0]);
  }

  /**
   * Retrieve recent heartbeat records for a worker.
   */
  async getRecentHeartbeats(workerId: string, limit = 20): Promise<WorkerHeartbeatRecord[]> {
    const query = `
      SELECT id, worker_id, status, current_job_count, metadata, created_at
      FROM worker_heartbeats
      WHERE worker_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;
    const result = await this.pool.query(query, [workerId, limit]);
    return result.rows.map((r) => ({
      id: parseInt(r.id, 10),
      workerId: r.worker_id,
      status: r.status as WorkerStatus,
      currentJobCount: parseInt(r.current_job_count, 10),
      metadata: r.metadata
        ? typeof r.metadata === 'string'
          ? JSON.parse(r.metadata)
          : r.metadata
        : {},
      createdAt: new Date(r.created_at),
    }));
  }

  /**
   * Retrieve all currently running jobs assigned to this worker.
   */
  async getRunningJobs(workerId: string): Promise<
    Array<{
      id: string;
      queueId: string;
      name: string;
      status: string;
      startedAt: Date | null;
      timeoutMs: number | null;
    }>
  > {
    const query = `
      SELECT id, queue_id, name, status, started_at, timeout_ms
      FROM jobs
      WHERE worker_id = $1 AND status = 'running'
      ORDER BY started_at ASC
    `;
    const result = await this.pool.query(query, [workerId]);
    return result.rows.map((r) => ({
      id: r.id,
      queueId: r.queue_id,
      name: r.name,
      status: r.status,
      startedAt: r.started_at ? new Date(r.started_at) : null,
      timeoutMs: r.timeout_ms ? parseInt(r.timeout_ms, 10) : null,
    }));
  }

  /**
   * Scan for workers whose heartbeat has expired and mark them as 'unhealthy'.
   * Scoped to user's authorized projects if userId or projectId is provided.
   */
  async markStaleWorkers(
    timeoutSeconds = 30,
    userId?: string,
    projectId?: string
  ): Promise<WorkerResponse[]> {
    let whereClause = `
      WHERE w.status NOT IN ('unhealthy', 'stopped', 'offline')
        AND w.last_heartbeat_at < NOW() - make_interval(secs => $1)
    `;
    const params: unknown[] = [timeoutSeconds];
    let paramIndex = 2;

    if (projectId) {
      whereClause += ` AND w.project_id = $${paramIndex++}`;
      params.push(projectId);
    } else if (userId) {
      whereClause += ` AND w.project_id IN (
        SELECT p.id FROM projects p
        JOIN organization_members om ON om.organization_id = p.organization_id
        WHERE om.user_id = $${paramIndex++}
      )`;
      params.push(userId);
    }

    const query = `
      UPDATE workers w
      SET status = 'unhealthy',
          updated_at = NOW()
      ${whereClause}
      RETURNING w.id, w.project_id, w.hostname, w.ip_address, w.pid, w.version, w.status,
                w.max_concurrency, w.current_job_count, w.last_heartbeat_at, w.registered_at,
                w.created_at, w.updated_at
    `;
    const result = await this.pool.query(query, params);
    return result.rows.map((r) => this.mapToResponse(r));
  }

  /**
   * Update worker status (e.g. online, busy, unhealthy, stopped).
   */
  async updateStatus(workerId: string, status: WorkerStatus): Promise<WorkerResponse | null> {
    const query = `
      UPDATE workers
      SET status = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING id, project_id, hostname, ip_address, pid, version, status,
                max_concurrency, current_job_count, last_heartbeat_at, registered_at,
                created_at, updated_at
    `;
    const result = await this.pool.query(query, [workerId, status]);
    if (result.rows.length === 0) return null;
    return this.mapToResponse(result.rows[0]);
  }

  /**
   * Deregister / mark worker stopped on shutdown.
   */
  async deregister(workerId: string): Promise<void> {
    const query = `
      UPDATE workers
      SET status = 'stopped', updated_at = NOW()
      WHERE id = $1
    `;
    await this.pool.query(query, [workerId]);
  }

  private mapToResponse(row: Record<string, unknown>): WorkerResponse {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      projectName: (row.project_name as string) ?? undefined,
      hostname: row.hostname as string,
      ipAddress: (row.ip_address as string) ?? null,
      pid: parseInt(row.pid as string, 10),
      version: (row.version as string) ?? null,
      status: row.status as WorkerStatus,
      calculatedStatus: (row.calculated_status as WorkerStatus) ?? (row.status as WorkerStatus),
      maxConcurrency: parseInt(row.max_concurrency as string, 10),
      currentJobCount: parseInt(row.current_job_count as string, 10),
      lastHeartbeatAt: new Date(row.last_heartbeat_at as string),
      registeredAt: new Date(row.registered_at as string),
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
