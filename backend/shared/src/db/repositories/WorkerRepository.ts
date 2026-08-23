import { Pool } from 'pg';
import { WorkerStatus } from '@job-scheduler/shared';

export interface WorkerResponse {
  id: string;
  projectId: string;
  hostname: string;
  ipAddress: string | null;
  pid: number;
  version: string | null;
  status: WorkerStatus;
  maxConcurrency: number;
  currentJobCount: number;
  lastHeartbeatAt: Date;
  registeredAt: Date;
  createdAt: Date;
  updatedAt: Date;
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
      VALUES ($1, $2, $3, $4, $5, $6, 'active')
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
   * Heartbeat from worker to refresh liveness.
   */
  async heartbeat(workerId: string, currentJobCount?: number): Promise<WorkerResponse | null> {
    const params: unknown[] = [workerId];
    let jobCountSet = '';

    if (currentJobCount !== undefined) {
      params.push(currentJobCount);
      jobCountSet = `, current_job_count = $2`;
    }

    const query = `
      UPDATE workers
      SET last_heartbeat_at = NOW(),
          updated_at = NOW()
          ${jobCountSet}
      WHERE id = $1
      RETURNING id, project_id, hostname, ip_address, pid, version, status,
                max_concurrency, current_job_count, last_heartbeat_at, registered_at,
                created_at, updated_at
    `;

    const result = await this.pool.query(query, params);
    if (result.rows.length === 0) return null;
    return this.mapToResponse(result.rows[0]);
  }

  /**
   * Find a worker by ID.
   */
  async findById(workerId: string): Promise<WorkerResponse | null> {
    const query = `
      SELECT id, project_id, hostname, ip_address, pid, version, status,
             max_concurrency, current_job_count, last_heartbeat_at, registered_at,
             created_at, updated_at
      FROM workers
      WHERE id = $1
    `;
    const result = await this.pool.query(query, [workerId]);
    if (result.rows.length === 0) return null;
    return this.mapToResponse(result.rows[0]);
  }

  /**
   * Update worker status (e.g. active, draining, offline).
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
   * Deregister / mark worker offline on shutdown.
   */
  async deregister(workerId: string): Promise<void> {
    const query = `
      UPDATE workers
      SET status = 'offline', updated_at = NOW()
      WHERE id = $1
    `;
    await this.pool.query(query, [workerId]);
  }

  private mapToResponse(row: Record<string, unknown>): WorkerResponse {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      hostname: row.hostname as string,
      ipAddress: (row.ip_address as string) ?? null,
      pid: parseInt(row.pid as string, 10),
      version: (row.version as string) ?? null,
      status: row.status as WorkerStatus,
      maxConcurrency: parseInt(row.max_concurrency as string, 10),
      currentJobCount: parseInt(row.current_job_count as string, 10),
      lastHeartbeatAt: new Date(row.last_heartbeat_at as string),
      registeredAt: new Date(row.registered_at as string),
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
