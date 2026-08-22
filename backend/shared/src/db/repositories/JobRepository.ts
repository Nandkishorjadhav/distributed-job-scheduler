import { Pool } from 'pg';

/**
 * JobRepository — stub.
 * All job persistence logic will be implemented here.
 */
export class JobRepository {
  constructor(private readonly _pool: Pool) {}

  // TODO: findById, findByQueueId, create, claimNext, updateStatus,
  //       markCompleted, markFailed, markDead, requeueStale
}
