import Redis from 'ioredis';
import { logger } from '../logger';

let redisClient: Redis | null = null;

/**
 * Returns the singleton ioredis client.
 * Created lazily on first call.
 */
export function getRedisClient(): Redis {
  if (redisClient) return redisClient;

  if (process.env.REDIS_URL) {
    let redisUrl = process.env.REDIS_URL.trim();
    const cliTlsPrefix = /^redis-cli\s+--tls\s+-u\s+/i;
    const wasCliTlsUrl = cliTlsPrefix.test(redisUrl);
    redisUrl = redisUrl.replace(cliTlsPrefix, '');
    if (wasCliTlsUrl && redisUrl.startsWith('redis://')) {
      redisUrl = `rediss://${redisUrl.slice('redis://'.length)}`;
    }

    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 10) return null;
        return Math.min(times * 200, 3000);
      },
    });
  } else {
    redisClient = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 10) return null;
        return Math.min(times * 200, 3000);
      },
    });
  }

  redisClient.on('connect', () => {
    logger.info('Redis connected');
  });

  redisClient.on('error', (err) => {
    logger.error('Redis error', { error: err.message });
  });

  redisClient.on('close', () => {
    logger.warn('Redis connection closed');
  });

  return redisClient;
}

/**
 * Gracefully disconnects from Redis.
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis connection closed');
  }
}
