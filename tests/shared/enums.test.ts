import { describe, it, expect } from 'vitest';
import { JobStatus, QueueStatus, WorkerStatus } from '@job-scheduler/shared';

describe('Shared enums', () => {
  it('JobStatus has all expected values', () => {
    expect(JobStatus.PENDING).toBe('pending');
    expect(JobStatus.DELAYED).toBe('delayed');
    expect(JobStatus.RUNNING).toBe('running');
    expect(JobStatus.COMPLETED).toBe('completed');
    expect(JobStatus.FAILED).toBe('failed');
    expect(JobStatus.DEAD).toBe('dead');
    expect(JobStatus.CANCELLED).toBe('cancelled');
  });

  it('QueueStatus has expected values', () => {
    expect(QueueStatus.ACTIVE).toBe('active');
    expect(QueueStatus.PAUSED).toBe('paused');
  });

  it('WorkerStatus has expected values', () => {
    expect(WorkerStatus.ACTIVE).toBe('active');
    expect(WorkerStatus.DRAINING).toBe('draining');
    expect(WorkerStatus.OFFLINE).toBe('offline');
  });
});
