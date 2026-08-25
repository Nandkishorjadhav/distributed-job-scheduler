import 'dotenv/config';
import { app } from './app';
import { getPool, logger } from '@job-scheduler/backend-shared';

const PORT = Number(process.env.PORT ?? process.env.API_PORT ?? 3000);
const HOST = process.env.API_HOST ?? '0.0.0.0';

async function bootstrap(): Promise<void> {
  // Verify DB connectivity before accepting traffic
  const pool = getPool();
  await pool.query('SELECT 1');
  logger.info('PostgreSQL connection verified');

  const server = app.listen(PORT, HOST, () => {
    logger.info(`API service listening on http://${HOST}:${PORT}`);
  });

  // ─── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = (signal: string) => {
    logger.info(`${signal} received — shutting down API gracefully`);
    server.close(async () => {
      const { closePool, closeRedis } = await import('@job-scheduler/backend-shared');
      await closePool();
      await closeRedis();
      logger.info('API service stopped');
      process.exit(0);
    });

    // Force exit if graceful shutdown takes too long
    setTimeout(() => {
      logger.error('Forced exit after timeout');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error('Failed to start API service', { error: err });
  process.exit(1);
});
