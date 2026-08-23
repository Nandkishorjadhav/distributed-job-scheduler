import { Router } from 'express';
import { authRouter } from './auth.routes';
import { orgsRouter } from './orgs.routes';
import { projectsRouter } from './projects.routes';
import { queuesRouter } from './queues.routes';
import { jobsRouter } from './jobs.routes';
import { workersRouter } from './workers.routes';
import { metricsRouter } from './metrics.routes';
import { dlqRouter } from './dlq.routes';
import { authenticate } from '../middleware/authenticate';

export const router = Router();

// Public routes
router.use('/auth', authRouter);

// Protected routes — all require authentication
router.use(authenticate);
router.use('/orgs', orgsRouter);
router.use('/projects', projectsRouter);
router.use('/queues', queuesRouter);
router.use('/jobs', jobsRouter);
router.use('/dlq', dlqRouter);
router.use('/workers', workersRouter);
router.use('/metrics', metricsRouter);
