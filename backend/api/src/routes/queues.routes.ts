import { Router } from 'express';
import {
  CreateQueueSchema,
  UpdateQueueSchema,
  QueueQuerySchema,
  SubmitJobSchema,
  SubmitBatchSchema,
  CreateRecurringJobSchema,
  JobFilterSchema,
  DLQFilterSchema,
} from '@job-scheduler/shared';
import { validate, validateQuery } from '../middleware/validate';
import {
  createQueue,
  listQueues,
  getQueue,
  updateQueue,
  pauseQueue,
  resumeQueue,
  deleteQueue,
  getQueueStats,
} from '../controllers/queue.controller';
import { createJob, createBatchJobs, createRecurringJob, listJobs } from '../controllers/job.controller';
import { listDlqJobs, getDlqStats } from '../controllers/dlq.controller';

export const queuesRouter = Router();

// POST /api/v1/queues — Create a new queue
queuesRouter.post('/', validate(CreateQueueSchema), createQueue);

// GET /api/v1/queues — List queues (optional ?projectId=...)
queuesRouter.get('/', validateQuery(QueueQuerySchema), listQueues);

// GET /api/v1/queues/:queueId — Get queue details
queuesRouter.get('/:queueId', getQueue);

// PATCH /api/v1/queues/:queueId — Update queue configuration
queuesRouter.patch('/:queueId', validate(UpdateQueueSchema), updateQueue);

// POST /api/v1/queues/:queueId/pause — Pause job processing
queuesRouter.post('/:queueId/pause', pauseQueue);

// POST /api/v1/queues/:queueId/resume — Resume job processing
queuesRouter.post('/:queueId/resume', resumeQueue);

// DELETE /api/v1/queues/:queueId — Safely delete queue
queuesRouter.delete('/:queueId', deleteQueue);

// GET /api/v1/queues/:queueId/stats — Get queue statistics
queuesRouter.get('/:queueId/stats', getQueueStats);

// ── Job Submission & Queue-scoped Jobs ───────────────────────────────────────

// POST /api/v1/queues/:queueId/jobs — Submit a job to a queue
queuesRouter.post('/:queueId/jobs', validate(SubmitJobSchema), createJob);

// POST /api/v1/queues/:queueId/batch — Submit a batch of jobs to a queue
queuesRouter.post('/:queueId/batch', validate(SubmitBatchSchema), createBatchJobs);

// POST /api/v1/queues/:queueId/recurring — Create recurring cron job template
queuesRouter.post('/:queueId/recurring', validate(CreateRecurringJobSchema), createRecurringJob);

// GET /api/v1/queues/:queueId/jobs — List jobs in a queue
queuesRouter.get('/:queueId/jobs', validateQuery(JobFilterSchema), listJobs);

// ── Queue-scoped Dead Letter Queue ───────────────────────────────────────────

// GET /api/v1/queues/:queueId/dlq — List DLQ jobs for this queue
queuesRouter.get('/:queueId/dlq', validateQuery(DLQFilterSchema), listDlqJobs);

// GET /api/v1/queues/:queueId/dlq/stats — Get DLQ stats for this queue
queuesRouter.get('/:queueId/dlq/stats', getDlqStats);
