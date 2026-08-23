import { Router } from 'express';
import {
  RegisterWorkerSchema,
  WorkerHeartbeatSchema,
  WorkerQuerySchema,
} from '@job-scheduler/shared';
import { validate, validateQuery } from '../middleware/validate';
import {
  listWorkers,
  getWorker,
  registerWorker,
  sendWorkerHeartbeat,
  stopWorker,
  scanStaleWorkers,
} from '../controllers/workers.controller';

export const workersRouter = Router();

// GET /api/v1/workers — List all workers with pagination and filters
workersRouter.get('/', validateQuery(WorkerQuerySchema), listWorkers);

// POST /api/v1/workers/register — Register a new worker process
workersRouter.post('/register', validate(RegisterWorkerSchema), registerWorker);

// POST /api/v1/workers/stale/scan — Scan and detect stale workers
workersRouter.post('/stale/scan', scanStaleWorkers);

// GET /api/v1/workers/:workerId — Get single worker details with running jobs & heartbeats
workersRouter.get('/:workerId', getWorker);

// POST /api/v1/workers/:workerId/heartbeat — Send periodic heartbeat from worker
workersRouter.post('/:workerId/heartbeat', validate(WorkerHeartbeatSchema), sendWorkerHeartbeat);

// POST /api/v1/workers/:workerId/stop — Mark worker as stopped
workersRouter.post('/:workerId/stop', stopWorker);
