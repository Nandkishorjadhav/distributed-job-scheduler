import { Pool } from 'pg';
import { RetryStrategy } from '@job-scheduler/shared';

export interface RetryPolicyEntity {
  id: string;
  projectId: string;
  name: string;
  strategy: RetryStrategy;
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterMs: number;
  createdAt: Date;
  updatedAt: Date;
}

export class RetryPolicyRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Create a reusable retry policy in a project.
   */
  async create(data: {
    projectId: string;
    name: string;
    strategy?: RetryStrategy;
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
    jitterMs?: number;
  }): Promise<RetryPolicyEntity> {
    const query = `
      INSERT INTO retry_policies (
        project_id, name, strategy, max_attempts, initial_delay_ms, max_delay_ms, backoff_multiplier, jitter_ms
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, project_id, name, strategy, max_attempts, initial_delay_ms, max_delay_ms,
                backoff_multiplier, jitter_ms, created_at, updated_at
    `;

    const values = [
      data.projectId,
      data.name,
      data.strategy ?? RetryStrategy.EXPONENTIAL,
      data.maxAttempts ?? 3,
      data.initialDelayMs ?? 1000,
      data.maxDelayMs ?? 30000,
      data.backoffMultiplier ?? 2.0,
      data.jitterMs ?? 500,
    ];

    const result = await this.pool.query(query, values);
    return this.mapToEntity(result.rows[0]);
  }

  /**
   * Find retry policy by ID.
   */
  async findById(id: string): Promise<RetryPolicyEntity | null> {
    const query = `
      SELECT id, project_id, name, strategy, max_attempts, initial_delay_ms, max_delay_ms,
             backoff_multiplier, jitter_ms, created_at, updated_at
      FROM retry_policies
      WHERE id = $1
    `;
    const result = await this.pool.query(query, [id]);
    if (result.rows.length === 0) return null;
    return this.mapToEntity(result.rows[0]);
  }

  /**
   * List retry policies for a project.
   */
  async listByProject(projectId: string): Promise<RetryPolicyEntity[]> {
    const query = `
      SELECT id, project_id, name, strategy, max_attempts, initial_delay_ms, max_delay_ms,
             backoff_multiplier, jitter_ms, created_at, updated_at
      FROM retry_policies
      WHERE project_id = $1
      ORDER BY name ASC
    `;
    const result = await this.pool.query(query, [projectId]);
    return result.rows.map((row) => this.mapToEntity(row));
  }

  private mapToEntity(row: Record<string, unknown>): RetryPolicyEntity {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      name: row.name as string,
      strategy: row.strategy as RetryStrategy,
      maxAttempts: parseInt(row.max_attempts as string, 10),
      initialDelayMs: parseInt(row.initial_delay_ms as string, 10),
      maxDelayMs: parseInt(row.max_delay_ms as string, 10),
      backoffMultiplier: parseFloat(row.backoff_multiplier as string),
      jitterMs: parseInt(row.jitter_ms as string, 10),
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
