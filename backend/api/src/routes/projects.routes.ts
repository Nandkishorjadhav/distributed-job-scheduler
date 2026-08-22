import { Router, Request, Response } from 'express';

export const projectsRouter = Router();

// POST /api/v1/projects  (org context via body or header)
projectsRouter.post('/', (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: 'Not implemented' });
});

// GET /api/v1/projects/:projectId
projectsRouter.get('/:projectId', (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: 'Not implemented' });
});

// GET /api/v1/projects/:projectId/queues
projectsRouter.get('/:projectId/queues', (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: 'Not implemented' });
});

// GET /api/v1/projects/:projectId/workers
projectsRouter.get('/:projectId/workers', (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: 'Not implemented' });
});

// GET /api/v1/projects/:projectId/metrics
projectsRouter.get('/:projectId/metrics', (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: 'Not implemented' });
});
