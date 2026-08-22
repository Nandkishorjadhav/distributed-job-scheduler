import { Pool } from 'pg';

export interface ProjectResponse {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class ProjectRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Create a new project within an organization.
   */
  async create(data: {
    organizationId: string;
    name: string;
    slug: string;
    description?: string;
  }): Promise<ProjectResponse> {
    const query = `
      INSERT INTO projects (organization_id, name, slug, description)
      VALUES ($1, $2, $3, $4)
      RETURNING id, organization_id, name, slug, description, is_active, created_at, updated_at
    `;
    const values = [
      data.organizationId,
      data.name.trim(),
      data.slug.toLowerCase().trim(),
      data.description ? data.description.trim() : null,
    ];
    const result = await this.pool.query(query, values);
    return this.mapToResponse(result.rows[0]);
  }

  /**
   * Find a project by ID.
   */
  async findById(id: string): Promise<ProjectResponse | null> {
    const query = `
      SELECT id, organization_id, name, slug, description, is_active, created_at, updated_at
      FROM projects
      WHERE id = $1 AND is_active = TRUE
    `;
    const result = await this.pool.query(query, [id]);
    if (result.rows.length === 0) return null;
    return this.mapToResponse(result.rows[0]);
  }

  /**
   * Find a project by Organization ID and slug.
   */
  async findByOrgAndSlug(organizationId: string, slug: string): Promise<ProjectResponse | null> {
    const query = `
      SELECT id, organization_id, name, slug, description, is_active, created_at, updated_at
      FROM projects
      WHERE organization_id = $1 AND slug = $2 AND is_active = TRUE
    `;
    const result = await this.pool.query(query, [organizationId, slug.toLowerCase().trim()]);
    if (result.rows.length === 0) return null;
    return this.mapToResponse(result.rows[0]);
  }

  /**
   * Update project details.
   */
  async update(
    id: string,
    data: { name?: string; slug?: string; description?: string }
  ): Promise<ProjectResponse | null> {
    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(data.name.trim());
    }

    if (data.slug !== undefined) {
      updates.push(`slug = $${idx++}`);
      values.push(data.slug.toLowerCase().trim());
    }

    if (data.description !== undefined) {
      updates.push(`description = $${idx++}`);
      values.push(data.description ? data.description.trim() : null);
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    const query = `
      UPDATE projects
      SET ${updates.join(', ')}
      WHERE id = $${idx} AND is_active = TRUE
      RETURNING id, organization_id, name, slug, description, is_active, created_at, updated_at
    `;

    const result = await this.pool.query(query, values);
    if (result.rows.length === 0) return null;
    return this.mapToResponse(result.rows[0]);
  }

  /**
   * Delete a project where safe.
   * Checks if there are active queues associated with the project.
   */
  async delete(id: string): Promise<{ success: boolean; reason?: string }> {
    // Safety check: check for existing queues in project
    const checkQuery = `
      SELECT COUNT(*) FROM queues WHERE project_id = $1 AND status != 'archived'
    `;
    const checkResult = await this.pool.query(checkQuery, [id]);
    const queueCount = parseInt(checkResult.rows[0].count, 10);

    if (queueCount > 0) {
      return {
        success: false,
        reason: `Cannot delete project with ${queueCount} active queue(s). Archive or delete queues first.`,
      };
    }

    const deleteQuery = `
      UPDATE projects
      SET is_active = FALSE
      WHERE id = $1 AND is_active = TRUE
    `;
    const result = await this.pool.query(deleteQuery, [id]);
    return { success: (result.rowCount ?? 0) > 0 };
  }

  /**
   * List projects for a given user with pagination and optional organization filter.
   */
  async listByUser(
    userId: string,
    page: number,
    pageSize: number,
    organizationId?: string
  ): Promise<{ data: ProjectResponse[]; total: number }> {
    const offset = (page - 1) * pageSize;
    const params: unknown[] = [userId];
    let orgCondition = '';

    if (organizationId) {
      params.push(organizationId);
      orgCondition = `AND p.organization_id = $${params.length}`;
    }

    const countQuery = `
      SELECT COUNT(*)
      FROM projects p
      JOIN organization_members m ON m.organization_id = p.organization_id
      WHERE m.user_id = $1 AND p.is_active = TRUE ${orgCondition}
    `;
    const countResult = await this.pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count, 10);

    params.push(pageSize, offset);
    const dataQuery = `
      SELECT p.id, p.organization_id, p.name, p.slug, p.description, p.is_active, p.created_at, p.updated_at
      FROM projects p
      JOIN organization_members m ON m.organization_id = p.organization_id
      WHERE m.user_id = $1 AND p.is_active = TRUE ${orgCondition}
      ORDER BY p.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const dataResult = await this.pool.query(dataQuery, params);

    const data = dataResult.rows.map((row) => this.mapToResponse(row));
    return { data, total };
  }

  private mapToResponse(row: Record<string, unknown>): ProjectResponse {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      name: row.name as string,
      slug: row.slug as string,
      description: (row.description as string) ?? null,
      isActive: row.is_active as boolean,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
