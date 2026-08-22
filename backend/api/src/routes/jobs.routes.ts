import { Router } from 'express';
import { JobFilterSchema } from '@job-scheduler/shared';
import { validateQuery } from '../middleware/validate';
import {
  getJob,
  listJobs,
  cancelJob,
  retryJob,
  getExecutionHistory,
  getJobLogs,
} from '../controllers/job.controller';

export const jobsRouter = Router();

// GET /api/v1/jobs — List jobs across user's organizations with filters & pagination
jobsRouter.get('/', validateQuery(JobFilterSchema), listJobs);

// GET /api/v1/jobs/:jobId — Get job details
jobsRouter.get('/:jobId', getJob);

// POST /api/v1/jobs/:jobId/cancel — Cancel job
jobsRouter.post('/:jobId/cancel', cancelJob);

// DELETE /api/v1/jobs/:jobId — Cancel job (alias)
jobsRouter.delete('/:jobId', cancelJob);

// POST /api/v1/jobs/:jobId/retry — Retry failed or dead job
jobsRouter.post('/:jobId/retry', retryJob);

// GET /api/v1/jobs/:jobId/executions — Get execution history attempts
jobsRouter.get('/:jobId/executions', getExecutionHistory);

// GET /api/v1/jobs/:jobId/logs — Get execution logs
jobsRouter.get('/:jobId/logs', getJobLogs);
