import { Router, Request, Response } from 'express';

export const workersRouter = Router();

// GET /api/v1/workers/:workerId
workersRouter.get('/:workerId', (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: 'Not implemented' });
});
