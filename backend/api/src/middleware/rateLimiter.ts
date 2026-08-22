import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';

export const rateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please slow down.' },
  handler: (_req: Request, res: Response) => {
    res.status(429).json({ success: false, error: 'Too many requests, please slow down.' });
  },
  skip: (req: Request) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  },
});
