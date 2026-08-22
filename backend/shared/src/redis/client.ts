import Redis from 'ioredis';
import { logger } from '../logger';

let redisClient: Redis | null = null;

/**
 * Returns the singleton ioredis client.
 * Created lazily on first call.
 */
export function getRedisClient(): Redis {
  if (redisClient) return redisClient;

  redisClient = new Redis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 10) {
        logger.error('Redis: unable to reconnect after 10 attempts');
        return null; // stop retrying
      }
      return Math.min(times * 200, 3000);
    },
    lazyConnect: true,
  });

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
