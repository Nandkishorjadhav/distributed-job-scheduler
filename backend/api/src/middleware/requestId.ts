import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

/**
 * Middleware that assigns or preserves a unique correlation ID per request.
 * Sets the 'X-Request-Id' response header.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingId = req.headers['x-request-id'] || req.headers['x-correlation-id'];
  const requestId =
    typeof incomingId === 'string' && incomingId.trim().length > 0 ? incomingId.trim() : uuidv4();

  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}
