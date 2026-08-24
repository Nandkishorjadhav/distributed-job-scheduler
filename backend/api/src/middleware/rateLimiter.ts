import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';

export const rateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please slow down.' },
  handler: (_req: Request, res: Response) => {
    res
      .status(429)
      .json({
        success: false,
        error: 'Too many requests, please slow down.',
        code: 'TOO_MANY_REQUESTS',
      });
  },
  skip: (req: Request) => {
    // Skip rate limiting for health checks and tests
    return req.path === '/health' || process.env.NODE_ENV === 'test';
  },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 attempts per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      error: 'Too many authentication attempts. Please try again later.',
      code: 'TOO_MANY_REQUESTS',
    });
  },
  skip: () => process.env.NODE_ENV === 'test',
});
