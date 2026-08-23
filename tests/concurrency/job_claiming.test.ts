import { describe, it, expect, beforeAll } from 'vitest';
import {
  getPool,
  JobClaimService,
  JobRepository,
  QueueRepository,
  ProjectRepository,
  OrgRepository,
  WorkerRepository,
} from '@job-scheduler/backend-shared';
import { JobStatus, WorkerStatus } from '@job-scheduler/shared';

describe('Distributed Worker Job-Claiming Concurrency Tests', () => {
  const pool = getPool();
  const claimService = new JobClaimService(pool);
  const jobRepo = new JobRepository(pool);
  const queueRepo = new QueueRepository(pool);
  const projectRepo = new ProjectRepository(pool);
  const orgRepo = new OrgRepository(pool);
  const workerRepo = new WorkerRepository(pool);

  const time = Date.now();
  let orgId: string;
  let projectId: string;
  let queueId: string;
  let workerIds: string[] = [];

  beforeAll(async () => {
    // 1. Create Org & Project
    const userRes = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'hash', 'Claim Test User') RETURNING id`,
      [`claim_user_${time}@example.com`]
    );
    const userId = userRes.rows[0].id;

    const org = await orgRepo.create({ name: 'Claim Org', slug: `claim-org-${time}` }, userId);
    orgId = org.id;

    const project = await projectRepo.create({
      organizationId: orgId,
      name: 'Claim Project',
      slug: `claim-proj-${time}`,
    });
    projectId = project.id;

    // 2. Create Primary Queue
    const queue = await queueRepo.create({
      projectId,
      name: `claim-queue-${time}`,
      priority: 5,
      concurrencyLimit: 50,
      dlqEnabled: true,
    });
    queueId = queue.id;

    // 3. Register 10 Workers
    for (let i = 1; i <= 10; i++) {
      const worker = await workerRepo.register({
        projectId,
        hostname: `worker-node-${i}`,
        pid: 1000 + i,
        maxConcurrency: 5,
      });
      workerIds.push(worker.id);
    }
  });

  describe('Atomic High-Concurrency Job Claiming (Zero Duplicate Claims)', () => {
    it('ensures 10 concurrent workers claiming 30 jobs claim each job at most once', async () => {
      const totalJobs = 30;
      const createdJobIds: string[] = [];

      // Create 30 pending jobs
      for (let i = 1; i <= totalJobs; i++) {
        const job = await jobRepo.create({
          queueId,
          name: `concurrent-job-${i}`,
          priority: 5,
          payload: { index: i },
        });
        createdJobIds.push(job.id);
      }

      // Simulate 10 workers concurrently claiming jobs until none left
      const allClaimedIds: string[] = [];
      const workerClaimTasks = workerIds.map(async (workerId) => {
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline && allClaimedIds.length < totalJobs) {
          const claimed = await claimService.claimJob(workerId, queueId);
          if (claimed) {
            allClaimedIds.push(claimed.id);
          } else {
            await new Promise((resolve) => setTimeout(resolve, 15));
          }
        }
      });

      await Promise.all(workerClaimTasks);

      // 1. Total claimed must equal total jobs submitted
      expect(allClaimedIds.length).toBe(totalJobs);

      // 2. Every claimed job ID must be strictly UNIQUE (No two workers claimed the same job)
      const uniqueClaimedIds = new Set(allClaimedIds);
      expect(uniqueClaimedIds.size).toBe(totalJobs);

      // 3. Verify all created jobs were claimed
      for (const id of createdJobIds) {
        expect(uniqueClaimedIds.has(id)).toBe(true);
      }

      // 4. Verify database state for each claimed job
      for (const id of createdJobIds) {
        const job = await jobRepo.findById(id);
        expect(job).not.toBeNull();
        expect(job!.status).toBe(JobStatus.RUNNING);
        expect(job!.workerId).not.toBeNull();
        expect(workerIds).toContain(job!.workerId);
        expect(job!.attemptCount).toBe(1);
        expect(job!.startedAt).not.toBeNull();
      }
    });
  });

  describe('Priority-Based Claim Ordering', () => {
    it('claims highest priority jobs before lower priority jobs', async () => {
      const lowPriorityJob = await jobRepo.create({
        queueId,
        name: 'low-priority-job',
        priority: 1,
      });

      const highPriorityJob = await jobRepo.create({
        queueId,
        name: 'high-priority-job',
        priority: 10,
      });

      const mediumPriorityJob = await jobRepo.create({
        queueId,
        name: 'medium-priority-job',
        priority: 5,
      });

      // Claim 1st job: must be priority 10
      const claim1 = await claimService.claimJob(workerIds[0], queueId);
      expect(claim1).not.toBeNull();
      expect(claim1!.id).toBe(highPriorityJob.id);
      expect(claim1!.priority).toBe(10);

      // Claim 2nd job: must be priority 5
      const claim2 = await claimService.claimJob(workerIds[0], queueId);
      expect(claim2).not.toBeNull();
      expect(claim2!.id).toBe(mediumPriorityJob.id);
      expect(claim2!.priority).toBe(5);

      // Claim 3rd job: must be priority 1
      const claim3 = await claimService.claimJob(workerIds[0], queueId);
      expect(claim3).not.toBeNull();
      expect(claim3!.id).toBe(lowPriorityJob.id);
      expect(claim3!.priority).toBe(1);
    });
  });

  describe('Paused Queue Isolation', () => {
    it('does not claim jobs from a paused queue', async () => {
      const pausedQueue = await queueRepo.create({
        projectId,
        name: `paused-queue-${time}`,
        priority: 5,
      });

      await jobRepo.create({
        queueId: pausedQueue.id,
        name: 'job-in-paused-queue',
        priority: 10,
      });

      // Pause queue
      await queueRepo.pause(pausedQueue.id);

      // Attempt to claim from paused queue
      const claim = await claimService.claimJob(workerIds[0], pausedQueue.id);
      expect(claim).toBeNull();

      // Resume queue and verify job becomes claimable
      await queueRepo.resume(pausedQueue.id);
      const resumedClaim = await claimService.claimJob(workerIds[0], pausedQueue.id);
      expect(resumedClaim).not.toBeNull();
      expect(resumedClaim!.name).toBe('job-in-paused-queue');
    });
  });

  describe('Queue Concurrency Limit Enforcement', () => {
    it('strictly respects queue concurrency limit and rejects claims when limit is reached', async () => {
      // Create a queue with concurrency_limit = 2
      const limitedQueue = await queueRepo.create({
        projectId,
        name: `limited-queue-${time}`,
        concurrencyLimit: 2,
      });

      // Insert 4 jobs
      const j1 = await jobRepo.create({ queueId: limitedQueue.id, name: 'lim-1' });
      const j2 = await jobRepo.create({ queueId: limitedQueue.id, name: 'lim-2' });
      const j3 = await jobRepo.create({ queueId: limitedQueue.id, name: 'lim-3' });
      await jobRepo.create({ queueId: limitedQueue.id, name: 'lim-4' });

      // Worker 1 claims job 1 (running = 1)
      const claim1 = await claimService.claimJob(workerIds[0], limitedQueue.id);
      expect(claim1).not.toBeNull();
      expect(claim1!.id).toBe(j1.id);

      // Worker 2 claims job 2 (running = 2 == limit)
      const claim2 = await claimService.claimJob(workerIds[1], limitedQueue.id);
      expect(claim2).not.toBeNull();
      expect(claim2!.id).toBe(j2.id);

      // Worker 3 attempts to claim from limited queue: MUST return null because running count == 2
      const claimBlocked = await claimService.claimJob(workerIds[2], limitedQueue.id);
      expect(claimBlocked).toBeNull();

      // Worker 1 completes job 1 (running count drops to 1)
      await claimService.completeJob(claim1!.id, workerIds[0], { processed: true });

      // Worker 3 attempts to claim again: MUST succeed and claim job 3!
      const claim3 = await claimService.claimJob(workerIds[2], limitedQueue.id);
      expect(claim3).not.toBeNull();
      expect(claim3!.id).toBe(j3.id);
    });
  });

  describe('Job Completion & Failure Lifecycle', () => {
    it('completes a claimed job and records execution metrics', async () => {
      const job = await jobRepo.create({
        queueId,
        name: 'job-to-complete',
      });

      const claimed = await claimService.claimJob(workerIds[0], queueId);
      expect(claimed).not.toBeNull();
      expect(claimed!.id).toBe(job.id);

      const completed = await claimService.completeJob(job.id, workerIds[0], { output: 'success_data' });
      expect(completed.status).toBe(JobStatus.COMPLETED);
      expect(completed.result).toEqual({ output: 'success_data' });
      expect(completed.finishedAt).not.toBeNull();

      // Verify execution history
      const history = await jobRepo.getExecutionHistory(job.id);
      expect(history.length).toBe(1);
      expect(history[0].status).toBe('completed');
      expect(history[0].workerId).toBe(workerIds[0]);
    });

    it('fails a job, schedules retry, and moves to DLQ upon exhausting max attempts', async () => {
      const job = await jobRepo.create({
        queueId,
        name: 'job-to-fail',
        maxAttempts: 2,
      });

      // Attempt 1: Claim and fail
      const claimAttempt1 = await claimService.claimJob(workerIds[0], queueId);
      expect(claimAttempt1!.attemptCount).toBe(1);

      const failedAttempt1 = await claimService.failJob(job.id, workerIds[0], {
        message: 'External API 500 error',
        code: 'ERR_UPSTREAM_500',
        retryDelayMs: 100,
      });
      expect(failedAttempt1.status).toBe(JobStatus.FAILED);
      expect(failedAttempt1.nextAttemptAt).not.toBeNull();

      // Reset next_attempt_at to past so it is eligible for retry
      await pool.query(`UPDATE jobs SET next_attempt_at = NOW() - INTERVAL '1 second', status = 'pending' WHERE id = $1`, [job.id]);

      // Attempt 2: Claim and fail again (reaches maxAttempts = 2)
      const claimAttempt2 = await claimService.claimJob(workerIds[1], queueId);
      expect(claimAttempt2!.attemptCount).toBe(2);

      const failedAttempt2 = await claimService.failJob(job.id, workerIds[1], {
        message: 'Fatal unrecoverable error',
        code: 'ERR_FATAL',
      });
      expect(failedAttempt2.status).toBe(JobStatus.DEAD);
      expect(failedAttempt2.finishedAt).not.toBeNull();

      // Verify DLQ snapshot created in dead_letter_jobs
      const dlqRes = await pool.query(`SELECT * FROM dead_letter_jobs WHERE job_id = $1`, [job.id]);
      expect(dlqRes.rows.length).toBe(1);
      expect(dlqRes.rows[0].final_error_message).toBe('Fatal unrecoverable error');
      expect(dlqRes.rows[0].total_attempts).toBe(2);
    });

    it('releases a claimed job back to pending status cleanly', async () => {
      const job = await jobRepo.create({
        queueId,
        name: 'job-to-release',
      });

      const claimed = await claimService.claimJob(workerIds[0], queueId);
      expect(claimed!.status).toBe(JobStatus.RUNNING);

      const released = await claimService.releaseJob(job.id, workerIds[0]);
      expect(released.status).toBe(JobStatus.PENDING);
      expect(released.workerId).toBeNull();
      expect(released.startedAt).toBeNull();

      // Verify it can be re-claimed by another worker
      const reClaimed = await claimService.claimJob(workerIds[1], queueId);
      expect(reClaimed).not.toBeNull();
      expect(reClaimed!.id).toBe(job.id);
      expect(reClaimed!.workerId).toBe(workerIds[1]);
    });
  });
});
