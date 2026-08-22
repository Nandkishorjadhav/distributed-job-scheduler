import { Router, Request, Response } from 'express';

export const metricsRouter = Router();

// GET /api/v1/metrics  (project-level, query param: ?projectId=)
metricsRouter.get('/', (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: 'Not implemented' });
});
