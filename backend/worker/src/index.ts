import 'dotenv/config';
import os from 'os';
import { getPool, logger, closePool, closeRedis } from '@job-scheduler/backend-shared';
import { Worker, WorkerOptions } from './Worker';
import { JobHandlerRegistry, JobHandler, JobExecutionContext } from './handlers';

export { Worker, WorkerOptions, JobHandlerRegistry, JobHandler, JobExecutionContext };

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 5);
const HEARTBEAT_INTERVAL_MS = Number(process.env.WORKER_HEARTBEAT_INTERVAL_MS ?? 10000);
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 1000);
const DRAIN_TIMEOUT_MS = Number(process.env.WORKER_DRAIN_TIMEOUT_MS ?? 30000);
const PROJECT_ID = process.env.WORKER_PROJECT_ID;
const QUEUE_ID = process.env.WORKER_QUEUE_ID;

let activeWorker: Worker | null = null;

async function bootstrap(): Promise<void> {
  logger.info('Starting Worker Service...');

  const pool = getPool();
  await pool.query('SELECT 1');
  logger.info('Database connectivity verified');

  let targetProjectId = PROJECT_ID;
  if (!targetProjectId) {
    // If PROJECT_ID not provided, pick first project in database for default worker instance
    const projRes = await pool.query('SELECT id FROM projects LIMIT 1');
    if (projRes.rows.length > 0) {
      targetProjectId = projRes.rows[0].id;
    } else {
      logger.warn('No projects found in database. Worker will wait for project creation.');
    }
  }

  if (targetProjectId) {
    activeWorker = new Worker(pool, {
      projectId: targetProjectId,
      queueId: QUEUE_ID,
      concurrency: CONCURRENCY,
      pollIntervalMs: POLL_INTERVAL_MS,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      drainTimeoutMs: DRAIN_TIMEOUT_MS,
      hostname: os.hostname(),
      pid: process.pid,
    });

    await activeWorker.start();
  }
}

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received — initiating worker graceful shutdown`);

  if (activeWorker) {
    await activeWorker.stop(DRAIN_TIMEOUT_MS);
  }

  await closePool();
  await closeRedis().catch(() => {});
  logger.info('Worker service terminated');
  process.exit(0);
}

if (process.env.NODE_ENV !== 'test') {
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  bootstrap().catch((err) => {
    logger.error('Worker failed to start', { error: err });
    process.exit(1);
  });
}
