import { JobStatus } from '@job-scheduler/shared';

/**
 * Valid Job State Transitions Matrix.
 * Maps current status -> set of allowed next statuses.
 */
const ALLOWED_TRANSITIONS: Record<JobStatus, Set<JobStatus>> = {
  [JobStatus.SCHEDULED]: new Set([JobStatus.PENDING, JobStatus.CANCELLED]),
  [JobStatus.DELAYED]: new Set([JobStatus.PENDING, JobStatus.CANCELLED]),
  [JobStatus.PENDING]: new Set([JobStatus.RUNNING, JobStatus.CANCELLED]),
  [JobStatus.RUNNING]: new Set([
    JobStatus.COMPLETED,
    JobStatus.FAILED,
    JobStatus.DEAD,
    JobStatus.CANCELLED,
  ]),
  [JobStatus.FAILED]: new Set([JobStatus.PENDING, JobStatus.DEAD]),
  [JobStatus.DEAD]: new Set([JobStatus.PENDING]),
  [JobStatus.COMPLETED]: new Set([]), // Terminal state
  [JobStatus.CANCELLED]: new Set([]), // Terminal state
};

/**
 * Checks if a transition from `fromState` to `toState` is valid according to FSM rules.
 */
export function isValidStateTransition(fromState: JobStatus, toState: JobStatus): boolean {
  const allowed = ALLOWED_TRANSITIONS[fromState];
  return allowed ? allowed.has(toState) : false;
}

/**
 * Asserts that a state transition is valid. Throws Error if invalid.
 */
export function assertStateTransition(fromState: JobStatus, toState: JobStatus): void {
  if (!isValidStateTransition(fromState, toState)) {
    throw new Error(`Invalid job state transition from '${fromState}' to '${toState}'`);
  }
}
