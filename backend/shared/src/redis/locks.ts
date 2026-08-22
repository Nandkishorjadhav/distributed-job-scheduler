import Redlock from 'redlock';
import { getRedisClient } from './client';
import { logger } from '../logger';

let redlock: Redlock | null = null;

/**
 * Returns the singleton Redlock instance for distributed locking.
 * Used exclusively by the Scheduler for leader election.
 */
export function getRedlock(): Redlock {
  if (redlock) return redlock;

  redlock = new Redlock([getRedisClient()], {
    driftFactor: 0.01,
    retryCount: 3,
    retryDelay: 200,
    retryJitter: 100,
  });

  redlock.on('error', (err) => {
    logger.warn('Redlock error (lock contention expected)', { error: err.message });
  });

  return redlock;
}

/**
 * Acquires a distributed lock by key for the given TTL in milliseconds.
 * Returns null if the lock cannot be acquired (another instance holds it).
 */
export async function tryAcquireLock(
  key: string,
  ttlMs: number
): Promise<Awaited<ReturnType<Redlock['acquire']>> | null> {
  try {
    const lock = await getRedlock().acquire([key], ttlMs);
    return lock;
  } catch {
    // Lock is held by another process — expected in leader election
    return null;
  }
}
