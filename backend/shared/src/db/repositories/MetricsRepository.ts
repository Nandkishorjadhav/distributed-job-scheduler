import { Pool } from 'pg';

/**
 * MetricsRepository — stub.
 */
export class MetricsRepository {
  constructor(private readonly _pool: Pool) {}

  // TODO: recordCompletion, recordFailure, recordDead, getByQueue, getByProject
}
