import { Router, Request, Response } from 'express';

export const jobsRouter = Router();

// GET /api/v1/jobs/:jobId
jobsRouter.get('/:jobId', (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: 'Not implemented' });
});

// DELETE /api/v1/jobs/:jobId
jobsRouter.delete('/:jobId', (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: 'Not implemented' });
});

// POST /api/v1/jobs/:jobId/retry
jobsRouter.post('/:jobId/retry', (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: 'Not implemented' });
});

// GET /api/v1/jobs/:jobId/logs
jobsRouter.get('/:jobId/logs', (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: 'Not implemented' });
});
