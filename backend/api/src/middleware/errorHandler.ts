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
    let parsedDetails: any = err.message;
    let fieldMsg = '';
    try {
      parsedDetails = JSON.parse(err.message);
      if (Array.isArray(parsedDetails) && parsedDetails.length > 0) {
        const first = parsedDetails[0];
        const path = first.path && first.path.length > 0 ? first.path.join('.') : '';
        fieldMsg = path ? `: [${path}] ${first.message}` : `: ${first.message}`;
      }
    } catch {
      // Keep as string if not JSON
    }
    res.status(400).json({
      success: false,
      error: `Validation failed${fieldMsg}`,
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

  // PostgreSQL Check Constraint Violation
  if (err.code === '23514') {
    const constraint = (err as any).constraint;
    let customMsg = 'Field value failed validation constraint rules.';
    if (constraint === 'chk_jobs_scheduled_has_time') {
      customMsg = 'Delayed and scheduled jobs require a scheduledAt execution timestamp.';
    } else if (constraint === 'chk_jobs_priority' || constraint === 'chk_queues_priority') {
      customMsg = 'Priority must be an integer between 1 (lowest) and 10 (highest).';
    } else if (constraint === 'chk_jobs_max_attempts' || constraint === 'chk_rp_max_attempts') {
      customMsg = 'Max attempts must be an integer between 1 and 100.';
    } else if (constraint === 'chk_jobs_timeout') {
      customMsg = 'Timeout must be at least 100 milliseconds.';
    } else if (constraint === 'chk_projects_slug_format' || constraint === 'chk_orgs_slug_format') {
      customMsg =
        'Slug must be 2-64 lowercase alphanumeric characters with no leading/trailing hyphens.';
    } else if (constraint === 'chk_queues_concurrency') {
      customMsg = 'Concurrency limit must be between 1 and 1000.';
    } else if (err.message) {
      customMsg = err.message;
    }

    res.status(400).json({
      success: false,
      error: customMsg,
      code: 'CONSTRAINT_VIOLATION',
      constraint,
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
