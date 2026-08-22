import { Pool } from 'pg';

/**
 * WorkerRepository — stub.
 */
export class WorkerRepository {
  constructor(private readonly _pool: Pool) {}

  // TODO: register, deregister, heartbeat, findActive, findStale
}
