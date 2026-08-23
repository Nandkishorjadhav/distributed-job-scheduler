// Public exports from @job-scheduler/backend-shared

export { getPool, closePool } from './db/client';
export { getRedisClient, closeRedis } from './redis/client';
export { getRedlock, tryAcquireLock } from './redis/locks';
export { logger } from './logger';

// Domain
export { isValidStateTransition, assertStateTransition } from './domain/JobStateMachine';
export {
  RetryPolicyCalculator,
  RetryPolicyConfig,
  DEFAULT_RETRY_POLICY,
} from './domain/RetryPolicyCalculator';

// Services
export { JobClaimService } from './services/JobClaimService';

// Repositories & Types
export {
  JobRepository,
  JobResponse,
  JobExecutionResponse,
  JobLogResponse,
  JobHistoryResponse,
  ScheduledJobResponse,
} from './db/repositories/JobRepository';
export { QueueRepository, QueueResponse, QueueStatsResponse } from './db/repositories/QueueRepository';
export { WorkerRepository, WorkerResponse } from './db/repositories/WorkerRepository';
export { OrgRepository, OrgResponse } from './db/repositories/OrgRepository';
export { ProjectRepository, ProjectResponse } from './db/repositories/ProjectRepository';
export { UserRepository, UserResponse } from './db/repositories/UserRepository';
export { MetricsRepository } from './db/repositories/MetricsRepository';
export {
  RetryPolicyRepository,
  RetryPolicyEntity,
} from './db/repositories/RetryPolicyRepository';
