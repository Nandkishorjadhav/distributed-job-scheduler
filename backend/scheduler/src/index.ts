import 'dotenv/config';
import { getPool, getRedisClient, logger, closePool, closeRedis } from '@job-scheduler/backend-shared';

/**
 * Scheduler Service Entry Point
 *
 * Responsibilities:
 * 1. Leader election via Redis distributed lock (only one scheduler active at a time)
 * 2. Delayed Job Poller — promotes delayed → pending when scheduled_at is due
 * 3. Cron Dispatcher — fires recurring job definitions on their cron schedule
 * 4. Stale Job Reaper — re-queues jobs stuck in 'running' due to dead workers
 */

const POLL_INTERVAL_MS = Number(process.env.SCHEDULER_POLL_INTERVAL_MS ?? 5000);
const CRON_INTERVAL_MS = Number(process.env.SCHEDULER_CRON_INTERVAL_MS ?? 60000);

async function bootstrap(): Promise<void> {
  logger.info('Scheduler service starting...');

  // Verify DB and Redis connectivity
  await getPool().query('SELECT 1');
  logger.info('PostgreSQL connection verified');

  await getRedisClient().ping();
  logger.info('Redis connection verified');

  logger.info(`Delayed job poll interval: ${POLL_INTERVAL_MS}ms`);
  logger.info(`Cron dispatch interval: ${CRON_INTERVAL_MS}ms`);

  // TODO: Start DelayedJobPoller
  // TODO: Start CronDispatcher (with leader election)
  // TODO: Start StaleJobReaper

  logger.info('Scheduler service running (stubs — business logic pending)');
}

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received — shutting down scheduler`);
  await closePool();
  await closeRedis();
  logger.info('Scheduler stopped');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

bootstrap().catch((err) => {
  logger.error('Scheduler failed to start', { error: err });
  process.exit(1);
});
