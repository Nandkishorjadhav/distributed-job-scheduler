import { Router } from 'express';
import { DLQFilterSchema, DLQStatsQuerySchema } from '@job-scheduler/shared';
import { validateQuery } from '../middleware/validate';
import {
  listDlqJobs,
  getDlqStats,
  getDlqJob,
  requeueDlqJob,
  archiveDlqJob,
  deleteDlqJob,
} from '../controllers/dlq.controller';

export const dlqRouter = Router();

// GET /api/v1/dlq/stats — Get dashboard-ready DLQ statistics
dlqRouter.get('/stats', validateQuery(DLQStatsQuerySchema), getDlqStats);

// GET /api/v1/dlq — List DLQ jobs with filtering and pagination
dlqRouter.get('/', validateQuery(DLQFilterSchema), listDlqJobs);

// GET /api/v1/dlq/:dlqId — Inspect single DLQ job
dlqRouter.get('/:dlqId', getDlqJob);

// POST /api/v1/dlq/:dlqId/retry — Re-queue a DLQ job
dlqRouter.post('/:dlqId/retry', requeueDlqJob);

// POST /api/v1/dlq/:dlqId/archive — Archive a DLQ job
dlqRouter.post('/:dlqId/archive', archiveDlqJob);

// DELETE /api/v1/dlq/:dlqId — Delete a DLQ job
dlqRouter.delete('/:dlqId', deleteDlqJob);
