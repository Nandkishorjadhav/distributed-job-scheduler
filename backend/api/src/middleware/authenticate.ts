import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getPool } from '@job-scheduler/backend-shared';
import { AppError } from './errorHandler';

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'FATAL SECURITY CONFIGURATION: JWT_SECRET environment variable must be set in production'
      );
    }
    return 'dev_secret_key_change_in_production_32char';
  }
  return secret;
}

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
  apiKey?: {
    id: string;
    projectId: string;
    scopes: string[];
  };
}

/**
 * Middleware that validates a JWT Bearer token or x-api-key header.
 * Attaches the decoded user / api key details to req.user and req.apiKey.
 */
export async function authenticate(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  const rawApiKey = req.headers['x-api-key'] as string | undefined;

  // 1. API Key Authentication (x-api-key header)
  if (rawApiKey) {
    try {
      const keyHash = crypto.createHash('sha256').update(rawApiKey.trim()).digest('hex');
      const pool = getPool();
      const query = `
        SELECT k.id, k.project_id, k.created_by, k.scopes, k.expires_at, k.revoked_at,
               u.id as user_id, u.email as user_email, u.is_active as user_is_active
        FROM api_keys k
        LEFT JOIN users u ON k.created_by = u.id
        WHERE k.key_hash = $1
      `;
      const result = await pool.query(query, [keyHash]);

      if (result.rows.length === 0) {
        return next(new AppError(401, 'Invalid API key', 'INVALID_API_KEY'));
      }

      const row = result.rows[0];

      if (row.revoked_at) {
        return next(new AppError(401, 'API key has been revoked', 'API_KEY_REVOKED'));
      }

      if (row.expires_at && new Date(row.expires_at) < new Date()) {
        return next(new AppError(401, 'API key has expired', 'API_KEY_EXPIRED'));
      }

      if (row.user_is_active === false) {
        return next(
          new AppError(
            401,
            'Account associated with this API key is deactivated',
            'ACCOUNT_INACTIVE'
          )
        );
      }

      // Update last_used_at timestamp asynchronously
      pool
        .query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [row.id])
        .catch(() => {});

      req.user = {
        id: row.user_id || row.created_by,
        email: row.user_email || 'api-key@system',
      };
      req.apiKey = {
        id: row.id,
        projectId: row.project_id,
        scopes: row.scopes || [],
      };
      return next();
    } catch (err) {
      return next(err);
    }
  }

  // 2. JWT Bearer Token Authentication
  if (!authHeader?.startsWith('Bearer ')) {
    return next(new AppError(401, 'Missing or invalid authorization header', 'UNAUTHORIZED'));
  }

  const token = authHeader.slice(7).trim();
  const secret = getJwtSecret();

  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as {
      id: string;
      email: string;
    };
    req.user = { id: payload.id, email: payload.email };
    next();
  } catch (err: unknown) {
    if (err instanceof jwt.TokenExpiredError) {
      return next(new AppError(401, 'Token expired', 'TOKEN_EXPIRED'));
    }
    return next(new AppError(401, 'Invalid token', 'TOKEN_INVALID'));
  }
}
