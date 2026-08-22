import { Router, Request, Response } from 'express';

export const queuesRouter = Router();

// POST /api/v1/queues
queuesRouter.post('/', (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: 'Not implemented' });
});

// GET /api/v1/queues/:queueId
queuesRouter.get('/:queueId', (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: 'Not implemented' });
});

// PATCH /api/v1/queues/:queueId
queuesRouter.patch('/:queueId', (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: 'Not implemented' });
});

// DELETE /api/v1/queues/:queueId
queuesRouter.delete('/:queueId', (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: 'Not implemented' });
});

// POST /api/v1/queues/:queueId/pause
queuesRouter.post('/:queueId/pause', (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: 'Not implemented' });
});

// POST /api/v1/queues/:queueId/resume
queuesRouter.post('/:queueId/resume', (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: 'Not implemented' });
});

// POST /api/v1/queues/:queueId/jobs
queuesRouter.post('/:queueId/jobs', (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: 'Not implemented' });
});

// GET /api/v1/queues/:queueId/jobs
queuesRouter.get('/:queueId/jobs', (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: 'Not implemented' });
});

// GET /api/v1/queues/:queueId/dlq
queuesRouter.get('/:queueId/dlq', (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: 'Not implemented' });
});

// POST /api/v1/queues/:queueId/dlq/requeue
queuesRouter.post('/:queueId/dlq/requeue', (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: 'Not implemented' });
});

// GET /api/v1/queues/:queueId/metrics
queuesRouter.get('/:queueId/metrics', (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: 'Not implemented' });
});

// POST /api/v1/queues/:queueId/recurring
queuesRouter.post('/:queueId/recurring', (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: 'Not implemented' });
});

// GET /api/v1/queues/:queueId/recurring
queuesRouter.get('/:queueId/recurring', (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: 'Not implemented' });
});
