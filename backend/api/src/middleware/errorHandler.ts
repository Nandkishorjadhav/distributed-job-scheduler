import { Request, Response, NextFunction } from 'express';
import { logger } from '@job-scheduler/backend-shared';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: Error & { code?: string; details?: unknown },
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = req.id;

  // Custom AppError
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: err.code || 'APP_ERROR',
      details: err.details,
      requestId,
    });
    return;
  }

  // Zod validation errors
  if (err.name === 'ZodError') {
    let parsedDetails: unknown = err.message;
    try {
      parsedDetails = JSON.parse(err.message);
    } catch {
      // Keep as string if not JSON
    }
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsedDetails,
      requestId,
    });
    return;
  }

  // PostgreSQL Duplicate Key Error
  if (err.code === '23505') {
    res.status(409).json({
      success: false,
      error: 'Resource already exists with conflicting unique field',
      code: 'CONFLICT',
      requestId,
    });
    return;
  }

  // PostgreSQL Foreign Key Violation
  if (err.code === '23503') {
    res.status(404).json({
      success: false,
      error: 'Referenced foreign resource not found',
      code: 'RESOURCE_NOT_FOUND',
      requestId,
    });
    return;
  }

  // PostgreSQL Check Constraint Violation (e.g. slug format, priority bounds)
  if (err.code === '23514') {
    res.status(400).json({
      success: false,
      error: 'Field value failed format or boundary constraints (e.g. slug must be 2-64 alphanumeric chars with no trailing hyphens)',
      code: 'CONSTRAINT_VIOLATION',
      requestId,
    });
    return;
  }

  // PostgreSQL Not-Null Violation
  if (err.code === '23502') {
    res.status(400).json({
      success: false,
      error: 'Missing required field or received null value',
      code: 'MISSING_REQUIRED_FIELD',
      requestId,
    });
    return;
  }

  logger.error('Unhandled API error', {
    requestId,
    path: req.path,
    method: req.method,
    error: err.message,
    stack: err.stack,
  });

  res.status(500).json({
    success: false,
    error: 'Internal server error',
    code: 'INTERNAL_SERVER_ERROR',
    requestId,
  });
}
