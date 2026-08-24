import 'dotenv/config';
import os from 'os';
import { getPool, logger, closePool, closeRedis } from '@job-scheduler/backend-shared';
import { Worker, WorkerOptions } from './Worker';
import { JobHandlerRegistry, JobHandler, JobExecutionContext } from './handlers';

export { Worker, WorkerOptions, JobHandlerRegistry, JobHandler, JobExecutionContext };

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 5);
const HEARTBEAT_INTERVAL_MS = Number(process.env.WORKER_HEARTBEAT_INTERVAL_MS ?? 10000);
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 1000);
const DRAIN_TIMEOUT_MS = Number(process.env.WORKER_DRAIN_TIMEOUT_MS ?? process.env.WORKER_SHUTDOWN_TIMEOUT_MS ?? 30000);
const PROJECT_ID = process.env.WORKER_PROJECT_ID;
const QUEUE_ID = process.env.WORKER_QUEUE_ID;

const activeWorkers = new Map<string, Worker>();
let syncInterval: NodeJS.Timeout | null = null;

async function syncWorkers(pool: any): Promise<void> {
  try {
    if (PROJECT_ID) {
      if (!activeWorkers.has(PROJECT_ID)) {
        const worker = new Worker(pool, {
          projectId: PROJECT_ID,
          queueId: QUEUE_ID,
          concurrency: CONCURRENCY,
          pollIntervalMs: POLL_INTERVAL_MS,
          heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
          drainTimeoutMs: DRAIN_TIMEOUT_MS,
          hostname: os.hostname(),
          pid: process.pid,
        });
        activeWorkers.set(PROJECT_ID, worker);
        await worker.start();
      }
      return;
    }

    const projRes = await pool.query('SELECT id, name FROM projects');
    for (const row of projRes.rows) {
      if (!activeWorkers.has(row.id)) {
        logger.info(`Auto-discovered project '${row.name}' (${row.id}) — starting worker`);
        const worker = new Worker(pool, {
          projectId: row.id,
          concurrency: CONCURRENCY,
          pollIntervalMs: POLL_INTERVAL_MS,
          heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
          drainTimeoutMs: DRAIN_TIMEOUT_MS,
          hostname: os.hostname(),
          pid: process.pid,
        });
        activeWorkers.set(row.id, worker);
        await worker.start();
      }
    }
  } catch (err: unknown) {
    logger.warn('Failed to sync worker projects', { error: (err as Error).message });
  }
}

async function bootstrap(): Promise<void> {
  logger.info('Starting Worker Service...');

  const pool = getPool();
  await pool.query('SELECT 1');
  logger.info('Database connectivity verified');

  await syncWorkers(pool);

  if (!PROJECT_ID) {
    syncInterval = setInterval(() => syncWorkers(pool), 5000);
  }
}

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received — initiating worker graceful shutdown`);

  if (syncInterval) clearInterval(syncInterval);

  for (const worker of activeWorkers.values()) {
    await worker.stop(DRAIN_TIMEOUT_MS);
  }
  activeWorkers.clear();

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
