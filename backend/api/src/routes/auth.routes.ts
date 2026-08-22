import { Router, Request, Response } from 'express';

export const authRouter = Router();

// POST /api/v1/auth/register
authRouter.post('/register', (_req: Request, res: Response) => {
  // TODO: implement registration
  res.status(501).json({ success: false, error: 'Not implemented' });
});

// POST /api/v1/auth/login
authRouter.post('/login', (_req: Request, res: Response) => {
  // TODO: implement login
  res.status(501).json({ success: false, error: 'Not implemented' });
});

// POST /api/v1/auth/logout
authRouter.post('/logout', (_req: Request, res: Response) => {
  // TODO: implement logout
  res.status(501).json({ success: false, error: 'Not implemented' });
});
