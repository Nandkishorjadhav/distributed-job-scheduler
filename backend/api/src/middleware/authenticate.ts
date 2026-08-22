import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from './errorHandler';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

/**
 * Middleware that validates a JWT Bearer token or x-api-key header.
 * Attaches the decoded user to req.user.
 */
export function authenticate(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key'] as string | undefined;

  if (apiKey) {
    // TODO: look up hashed API key in DB
    // For now, stub — will be implemented with business logic
    next();
    return;
  }

  if (!authHeader?.startsWith('Bearer ')) {
    return next(new AppError(401, 'Missing or invalid authorization header', 'UNAUTHORIZED'));
  }

  const token = authHeader.slice(7);
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    return next(new AppError(500, 'JWT secret not configured', 'SERVER_MISCONFIGURED'));
  }

  try {
    const payload = jwt.verify(token, secret) as { id: string; email: string };
    req.user = { id: payload.id, email: payload.email };
    next();
  } catch {
    next(new AppError(401, 'Invalid or expired token', 'TOKEN_INVALID'));
  }
}
