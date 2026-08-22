import { Router, Request, Response } from 'express';

export const orgsRouter = Router();

// POST /api/v1/orgs
orgsRouter.post('/', (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: 'Not implemented' });
});

// GET /api/v1/orgs/:orgId
orgsRouter.get('/:orgId', (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: 'Not implemented' });
});

// GET /api/v1/orgs/:orgId/members
orgsRouter.get('/:orgId/members', (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: 'Not implemented' });
});

// POST /api/v1/orgs/:orgId/members
orgsRouter.post('/:orgId/members', (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: 'Not implemented' });
});
