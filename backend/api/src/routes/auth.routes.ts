import { Router } from 'express';
import { RegisterSchema, LoginSchema } from '@job-scheduler/shared';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/authenticate';
import { authRateLimiter } from '../middleware/rateLimiter';
import { register, login, logout, getCurrentUser } from '../controllers/auth.controller';

export const authRouter = Router();

// POST /api/v1/auth/register
authRouter.post('/register', authRateLimiter, validate(RegisterSchema), register);

// POST /api/v1/auth/login
authRouter.post('/login', authRateLimiter, validate(LoginSchema), login);

// POST /api/v1/auth/logout
authRouter.post('/logout', authenticate, logout);

// GET /api/v1/auth/me
authRouter.get('/me', authenticate, getCurrentUser);
