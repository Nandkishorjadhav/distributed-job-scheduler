import 'dotenv/config';
import os from 'os';
import { getPool, getRedisClient, logger, closePool, closeRedis } from '@job-scheduler/backend-shared';

/**
 * Worker Service Entry Point
 *
 * Responsibilities:
 * 1. Register self in the workers table on startup
 * 2. Poll subscribed queues for pending jobs (priority-ordered)
 * 3. Atomically claim a job using SELECT ... FOR UPDATE SKIP LOCKED
 * 4. Execute job handler, capture logs
 * 5. Mark job completed / failed, apply retry policy
 * 6. Send periodic heartbeats
 * 7. Graceful shutdown on SIGTERM
 */

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 5);
const HEARTBEAT_INTERVAL_MS = Number(process.env.WORKER_HEARTBEAT_INTERVAL_MS ?? 10000);
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 1000);
const DRAIN_TIMEOUT_MS = Number(process.env.WORKER_DRAIN_TIMEOUT_MS ?? 30000);

let isShuttingDown = false;
let activeJobs = 0;

async function bootstrap(): Promise<void> {
  logger.info('Worker service starting...');
  logger.info(`Host: ${os.hostname()} | PID: ${process.pid} | Concurrency: ${CONCURRENCY}`);

  // Verify connectivity
  await getPool().query('SELECT 1');
  logger.info('PostgreSQL connection verified');

  await getRedisClient().ping();
  logger.info('Redis connection verified');

  // TODO: Register worker in DB (WorkerRepository.register)
  // TODO: Start heartbeat loop
  // TODO: Start poll loop

  logger.info('Worker service running (stubs — business logic pending)');
}

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`${signal} received — draining worker (active jobs: ${activeJobs})`);

  // Wait for in-flight jobs to complete, up to drain timeout
  const deadline = Date.now() + DRAIN_TIMEOUT_MS;
  while (activeJobs > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    logger.info(`Waiting for ${activeJobs} job(s) to finish...`);
  }

  if (activeJobs > 0) {
    logger.warn(`Drain timeout reached with ${activeJobs} job(s) still active — forcing exit`);
  }

  // TODO: Deregister worker from DB
  await closePool();
  await closeRedis();
  logger.info('Worker stopped');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

bootstrap().catch((err) => {
  logger.error('Worker failed to start', { error: err });
  process.exit(1);
});
