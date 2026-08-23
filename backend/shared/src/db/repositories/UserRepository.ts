import { Pool } from 'pg';

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  is_active: boolean;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface UserResponse {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class UserRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Create a new user.
   */
  async create(data: { email: string; passwordHash: string; name: string }): Promise<UserResponse> {
    const query = `
      INSERT INTO users (email, password_hash, name)
      VALUES ($1, $2, $3)
      RETURNING id, email, name, is_active, last_login_at, created_at, updated_at
    `;
    const values = [data.email.toLowerCase().trim(), data.passwordHash, data.name.trim()];
    const result = await this.pool.query(query, values);
    return this.mapToResponse(result.rows[0]);
  }

  /**
   * Find a user by email, including password_hash for authentication.
   */
  async findByEmail(email: string): Promise<UserRecord | null> {
    const query = `
      SELECT id, email, password_hash, name, is_active, last_login_at, created_at, updated_at
      FROM users
      WHERE email = $1
    `;
    const result = await this.pool.query(query, [email.toLowerCase().trim()]);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  /**
   * Find a user by ID.
   */
  async findById(id: string): Promise<UserResponse | null> {
    const query = `
      SELECT id, email, name, is_active, last_login_at, created_at, updated_at
      FROM users
      WHERE id = $1 AND is_active = TRUE
    `;
    const result = await this.pool.query(query, [id]);
    if (result.rows.length === 0) return null;
    return this.mapToResponse(result.rows[0]);
  }

  /**
   * Update last login timestamp for a user.
   */
  async updateLastLogin(id: string): Promise<void> {
    const query = `
      UPDATE users
      SET last_login_at = NOW()
      WHERE id = $1
    `;
    await this.pool.query(query, [id]);
  }

  private mapToResponse(row: Record<string, unknown>): UserResponse {
    return {
      id: row.id as string,
      email: row.email as string,
      name: row.name as string,
      isActive: row.is_active as boolean,
      lastLoginAt: row.last_login_at ? new Date(row.last_login_at as string) : null,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
