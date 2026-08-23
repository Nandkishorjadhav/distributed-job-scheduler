import 'dotenv/config';
import { getPool, getRedisClient, logger, closePool, closeRedis } from '@job-scheduler/backend-shared';
import { Scheduler } from './Scheduler';

export {
  Scheduler,
  SchedulerOptions,
  PromotedJobSummary,
  DispatchedRecurringJobSummary,
} from './Scheduler';

/**
 * Scheduler Service Process Bootstrap
 */
const POLL_INTERVAL_MS = Number(process.env.SCHEDULER_POLL_INTERVAL_MS ?? 1000);
const CRON_INTERVAL_MS = Number(process.env.SCHEDULER_CRON_INTERVAL_MS ?? 1000);
const BATCH_SIZE = Number(process.env.SCHEDULER_BATCH_SIZE ?? 50);

let scheduler: Scheduler | null = null;

async function bootstrap(): Promise<void> {
  logger.info('Scheduler service starting...');

  // Verify PostgreSQL connectivity
  await getPool().query('SELECT 1');
  logger.info('PostgreSQL connection verified');

  try {
    // Verify Redis connectivity if configured
    await getRedisClient().ping();
    logger.info('Redis connection verified');
  } catch (err) {
    logger.warn('Redis connection not available, proceeding in standalone mode', { error: err });
  }

  scheduler = new Scheduler(getPool(), {
    pollIntervalMs: POLL_INTERVAL_MS,
    cronIntervalMs: CRON_INTERVAL_MS,
    batchSize: BATCH_SIZE,
  });

  await scheduler.start();
  logger.info('Scheduler service running');
}

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received — shutting down scheduler service`);
  if (scheduler) {
    await scheduler.stop();
  }
  await closePool();
  await closeRedis();
  logger.info('Scheduler stopped');
  process.exit(0);
}

if (process.env.NODE_ENV !== 'test') {
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  bootstrap().catch((err) => {
    logger.error('Scheduler failed to start', { error: err });
    process.exit(1);
  });
}
