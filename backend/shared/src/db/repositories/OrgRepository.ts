import { Pool } from 'pg';
import { OrgRole } from '@job-scheduler/shared';

export interface OrgResponse {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  role?: OrgRole;
  createdAt: Date;
  updatedAt: Date;
}

export class OrgRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Create an organization and assign the creator as 'owner'.
   */
  async create(data: { name: string; slug: string }, userId: string): Promise<OrgResponse> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const orgQuery = `
        INSERT INTO organizations (name, slug)
        VALUES ($1, $2)
        RETURNING id, name, slug, is_active, created_at, updated_at
      `;
      const orgResult = await client.query(orgQuery, [
        data.name.trim(),
        data.slug.toLowerCase().trim(),
      ]);
      const org = orgResult.rows[0];

      const memberQuery = `
        INSERT INTO organization_members (organization_id, user_id, role)
        VALUES ($1, $2, 'owner')
      `;
      await client.query(memberQuery, [org.id, userId]);

      await client.query('COMMIT');

      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        isActive: org.is_active,
        role: OrgRole.OWNER,
        createdAt: new Date(org.created_at),
        updatedAt: new Date(org.updated_at),
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Find an organization by ID.
   */
  async findById(id: string): Promise<OrgResponse | null> {
    const query = `
      SELECT id, name, slug, is_active, created_at, updated_at
      FROM organizations
      WHERE id = $1 AND is_active = TRUE
    `;
    const result = await this.pool.query(query, [id]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      isActive: row.is_active,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Find an organization by slug.
   */
  async findBySlug(slug: string): Promise<OrgResponse | null> {
    const query = `
      SELECT id, name, slug, is_active, created_at, updated_at
      FROM organizations
      WHERE slug = $1 AND is_active = TRUE
    `;
    const result = await this.pool.query(query, [slug.toLowerCase().trim()]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      isActive: row.is_active,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Update organization details.
   */
  async update(id: string, data: { name?: string; slug?: string }): Promise<OrgResponse | null> {
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

    if (updates.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    const query = `
      UPDATE organizations
      SET ${updates.join(', ')}
      WHERE id = $${idx} AND is_active = TRUE
      RETURNING id, name, slug, is_active, created_at, updated_at
    `;

    const result = await this.pool.query(query, values);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      isActive: row.is_active,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Get the role of a user in a specific organization.
   */
  async getUserRole(orgId: string, userId: string): Promise<OrgRole | null> {
    const query = `
      SELECT role
      FROM organization_members
      WHERE organization_id = $1 AND user_id = $2
    `;
    const result = await this.pool.query(query, [orgId, userId]);
    if (result.rows.length === 0) return null;
    return result.rows[0].role as OrgRole;
  }

  /**
   * List organizations a user belongs to with pagination.
   */
  async listUserOrgs(
    userId: string,
    page: number,
    pageSize: number
  ): Promise<{ data: OrgResponse[]; total: number }> {
    const offset = (page - 1) * pageSize;

    const countQuery = `
      SELECT COUNT(*)
      FROM organizations o
      JOIN organization_members m ON m.organization_id = o.id
      WHERE m.user_id = $1 AND o.is_active = TRUE
    `;
    const countResult = await this.pool.query(countQuery, [userId]);
    const total = parseInt(countResult.rows[0].count, 10);

    const dataQuery = `
      SELECT o.id, o.name, o.slug, o.is_active, o.created_at, o.updated_at, m.role
      FROM organizations o
      JOIN organization_members m ON m.organization_id = o.id
      WHERE m.user_id = $1 AND o.is_active = TRUE
      ORDER BY o.created_at DESC
      LIMIT $2 OFFSET $3
    `;
    const dataResult = await this.pool.query(dataQuery, [userId, pageSize, offset]);

    const data = dataResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      isActive: row.is_active,
      role: row.role as OrgRole,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));

    return { data, total };
  }
}
