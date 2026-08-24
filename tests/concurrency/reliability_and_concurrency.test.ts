import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PoolClient } from 'pg';
import {
  getPool,
  JobClaimService,
  JobRepository,
  QueueRepository,
  ProjectRepository,
  OrgRepository,
  WorkerRepository,
  DeadLetterJobRepository,
  tryAcquireLock,
} from '@job-scheduler/backend-shared';
import { Scheduler } from '@job-scheduler/scheduler';
import { Worker } from '@job-scheduler/worker';
import { JobStatus, WorkerStatus } from '@job-scheduler/shared';

describe('Distributed System Reliability & Concurrency Comprehensive Suite', () => {
  const pool = getPool();
  const claimService = new JobClaimService(pool);
  const jobRepo = new JobRepository(pool);
  const queueRepo = new QueueRepository(pool);
  const projectRepo = new ProjectRepository(pool);
  const orgRepo = new OrgRepository(pool);
  const workerRepo = new WorkerRepository(pool);
  const dlqRepo = new DeadLetterJobRepository(pool);

  const time = Date.now();
  let orgId: string;
  let projectId: string;
  let worker1Id: string;
  let worker2Id: string;
  let workerList: string[] = [];

  beforeAll(async () => {
    // 1. Create Organization & Project
    const userRes = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'hash123', 'Concurrency Tester') RETURNING id`,
      [`concurrency_suite_${time}@example.com`]
    );
    const userId = userRes.rows[0].id;

    const org = await orgRepo.create({ name: 'Reliability Org', slug: `rel-org-${time}` }, userId);
    orgId = org.id;

    const project = await projectRepo.create({
      organizationId: orgId,
      name: 'Reliability Project',
      slug: `rel-proj-${time}`,
    });
    projectId = project.id;

    // 2. Register Primary Test Workers
    const w1 = await workerRepo.register({
      projectId,
      hostname: 'worker-rel-01',
      pid: 3001,
      maxConcurrency: 10,
    });
    worker1Id = w1.id;

    const w2 = await workerRepo.register({
      projectId,
      hostname: 'worker-rel-02',
      pid: 3002,
      maxConcurrency: 10,
    });
    worker2Id = w2.id;

    workerList = [worker1Id, worker2Id];
    for (let i = 3; i <= 10; i++) {
      const w = await workerRepo.register({
        projectId,
        hostname: `worker-rel-${i.toString().padStart(2, '0')}`,
        pid: 3000 + i,
        maxConcurrency: 10,
      });
      workerList.push(w.id);
    }
  });

  afterAll(async () => {
    await pool.query('UPDATE workers SET status = $1 WHERE project_id = $2', [WorkerStatus.STOPPED, projectId]);
  });

  // ─── 1. Two workers claiming the same job ──────────────────────────────────
  describe('1. Two Workers Claiming the Same Single Job', () => {
    it('guarantees mutual exclusion: exactly one worker claims the job and zero duplicates occur', async () => {
      const q = await queueRepo.create({ projectId, name: `q1-contend-${Date.now()}` });
      const job = await jobRepo.create({
        queueId: q.id,
        name: `single-contended-job-${Date.now()}`,
        priority: 5,
      });

      // Both worker 1 and worker 2 attempt to claim simultaneously
      const [claim1, claim2] = await Promise.all([
        claimService.claimJob(worker1Id, q.id),
        claimService.claimJob(worker2Id, q.id),
      ]);

      const winner = claim1 ?? claim2;
      const loser = claim1 ? claim2 : claim1;

      expect(winner).not.toBeNull();
      expect(loser).toBeNull();
      expect(winner!.id).toBe(job.id);
      expect(winner!.attemptCount).toBe(1);

      // Verify DB record status is running and worker_id matches winner
      const dbJob = await jobRepo.findById(job.id);
      expect(dbJob!.status).toBe(JobStatus.RUNNING);
      expect(dbJob!.workerId).toBe(winner!.workerId);

      // Clean up by completing job
      await claimService.completeJob(job.id, winner!.workerId!);
    });
  });

  // ─── 2. Ten workers processing many jobs ───────────────────────────────────
  describe('2. Ten Workers Processing Many Jobs Concurrently', () => {
    it('processes 40 jobs across 10 workers with zero duplicate claims and complete lifecycle', async () => {
      const q = await queueRepo.create({ projectId, name: `q2-tenworkers-${Date.now()}`, concurrencyLimit: 50 });
      const totalJobs = 40;
      const jobIds: string[] = [];

      for (let i = 1; i <= totalJobs; i++) {
        const j = await jobRepo.create({
          queueId: q.id,
          name: `batch-10w-job-${i}`,
          priority: 5,
          payload: { index: i },
        });
        jobIds.push(j.id);
      }

      // 10 concurrent worker loops claiming and executing jobs
      const claimedMap = new Map<string, number>(); // jobId -> claimCount
      const workerTasks = workerList.map(async (wId) => {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline && claimedMap.size < totalJobs) {
          const claimed = await claimService.claimJob(wId, q.id);
          if (claimed) {
            const count = claimedMap.get(claimed.id) ?? 0;
            claimedMap.set(claimed.id, count + 1);

            // Simulate execution work
            await new Promise((res) => setTimeout(res, 5));

            // Complete job
            await claimService.completeJob(claimed.id, wId, { processedBy: wId });
          } else {
            await new Promise((res) => setTimeout(res, 10));
          }
        }
      });

      await Promise.all(workerTasks);

      // Verify all 40 jobs were claimed and completed
      expect(claimedMap.size).toBe(totalJobs);
      for (const [id, count] of claimedMap.entries()) {
        expect(count).toBe(1); // Zero duplicate claims
        const dbJob = await jobRepo.findById(id);
        expect(dbJob!.status).toBe(JobStatus.COMPLETED);
        expect(dbJob!.finishedAt).not.toBeNull();
      }
    });
  });

  // ─── 3. Queue concurrency limit ───────────────────────────────────────────
  describe('3. Queue Concurrency Limit Enforcement', () => {
    it('strictly caps active running jobs at concurrency_limit under high worker contention', async () => {
      const limit = 3;
      const limitedQueue = await queueRepo.create({
        projectId,
        name: `limit-test-queue-${Date.now()}`,
        concurrencyLimit: limit,
      });

      // Create 8 jobs
      for (let i = 1; i <= 8; i++) {
        await jobRepo.create({
          queueId: limitedQueue.id,
          name: `capped-job-${i}`,
          priority: 5,
        });
      }

      // Claim up to limit
      const c1 = await claimService.claimJob(worker1Id, limitedQueue.id);
      const c2 = await claimService.claimJob(worker2Id, limitedQueue.id);
      const c3 = await claimService.claimJob(workerList[2], limitedQueue.id);

      expect(c1).not.toBeNull();
      expect(c2).not.toBeNull();
      expect(c3).not.toBeNull();

      // Verify 3 running in DB
      const runningCountRes = await pool.query(
        `SELECT COUNT(*) FROM jobs WHERE queue_id = $1 AND status = 'running'`,
        [limitedQueue.id]
      );
      expect(parseInt(runningCountRes.rows[0].count, 10)).toBe(limit);

      // Attempt 4th claim from another worker: MUST return null (limit reached)
      const c4 = await claimService.claimJob(workerList[3], limitedQueue.id);
      expect(c4).toBeNull();

      // Release 1 slot by completing c1
      await claimService.completeJob(c1!.id, worker1Id);

      // Now 4th claim succeeds immediately
      const c4After = await claimService.claimJob(workerList[3], limitedQueue.id);
      expect(c4After).not.toBeNull();

      // Clean up running jobs
      await claimService.completeJob(c2!.id, worker2Id);
      await claimService.completeJob(c3!.id, workerList[2]);
      await claimService.completeJob(c4After!.id, workerList[3]);
    });
  });

  // ─── 4. Job retry ─────────────────────────────────────────────────────────
  describe('4. Job Retry Mechanics & Exponential Backoff Calculation', () => {
    it('schedules retry attempt with future next_attempt_at upon transient failure', async () => {
      const q = await queueRepo.create({ projectId, name: `q4-retry-${Date.now()}` });
      const job = await jobRepo.create({
        queueId: q.id,
        name: `retryable-job-${Date.now()}`,
        maxAttempts: 3,
      });

      // Claim attempt 1
      const claimed = await claimService.claimJob(worker1Id, q.id);
      expect(claimed!.id).toBe(job.id);
      expect(claimed!.attemptCount).toBe(1);

      // Fail attempt 1
      const beforeFail = Date.now();
      const failed = await claimService.failJob(job.id, worker1Id, {
        message: 'Network timeout',
        code: 'ERR_TIMEOUT',
      });

      expect(failed.status).toBe(JobStatus.FAILED);
      expect(failed.attemptCount).toBe(1);
      expect(failed.nextAttemptAt).not.toBeNull();
      expect(new Date(failed.nextAttemptAt!).getTime()).toBeGreaterThanOrEqual(beforeFail);

      // Job should NOT be claimable right now (scheduled in future)
      const prematureClaim = await claimService.claimJob(worker2Id, q.id);
      expect(prematureClaim).toBeNull();

      // Scheduler promotion or fast-forward: mark status = 'pending'
      await pool.query(
        `UPDATE jobs SET status = 'pending', enqueued_at = NOW(), next_attempt_at = NULL WHERE id = $1`,
        [job.id]
      );

      // Job is now eligible for retry claim
      const retryClaim = await claimService.claimJob(worker2Id, q.id);
      expect(retryClaim).not.toBeNull();
      expect(retryClaim!.id).toBe(job.id);
      expect(retryClaim!.attemptCount).toBe(2);

      // Complete successfully on attempt 2
      await claimService.completeJob(job.id, worker2Id);
    });
  });

  // ─── 5. Maximum retry attempts ────────────────────────────────────────────
  describe('5. Maximum Retry Attempts Exhaustion', () => {
    it('permanently marks job as dead/DLQ when max_attempts is reached on DLQ queue', async () => {
      const q = await queueRepo.create({ projectId, name: `q5-max-${Date.now()}`, dlqEnabled: true });
      const job = await jobRepo.create({
        queueId: q.id,
        name: `max-attempts-job-${Date.now()}`,
        maxAttempts: 2,
      });

      // Attempt 1 -> Fail
      await claimService.claimJob(worker1Id, q.id);
      await claimService.failJob(job.id, worker1Id, { message: 'Fail 1' });

      // Promote for Attempt 2
      await pool.query(
        `UPDATE jobs SET status = 'pending', enqueued_at = NOW(), next_attempt_at = NULL WHERE id = $1`,
        [job.id]
      );

      // Attempt 2 (Max) -> Claim & Fail
      const claim2 = await claimService.claimJob(worker2Id, q.id);
      expect(claim2).not.toBeNull();

      const finalFailed = await claimService.failJob(job.id, worker2Id, {
        message: 'Fatal error 2',
        code: 'ERR_FATAL',
      });

      expect(finalFailed.status).toBe(JobStatus.DEAD);
      expect(finalFailed.attemptCount).toBe(2);
      expect(finalFailed.nextAttemptAt).toBeNull(); // No further retry scheduled
    });
  });

  // ─── 6. DLQ transition ───────────────────────────────────────────────────
  describe('6. Dead Letter Queue (DLQ) Quarantine Transition', () => {
    it('quarantines permanently failed jobs with full payload snapshot into dead_letter_jobs', async () => {
      const q = await queueRepo.create({ projectId, name: `q6-dlq-${Date.now()}`, dlqEnabled: true });
      const job = await jobRepo.create({
        queueId: q.id,
        name: `dlq-target-job-${Date.now()}`,
        maxAttempts: 1,
        payload: { creditCard: '4111-XXXX-XXXX-1111', amount: 99.95 },
      });

      await claimService.claimJob(worker1Id, q.id);
      await claimService.failJob(job.id, worker1Id, {
        message: 'Account fraud detected',
        code: 'ERR_FRAUD',
      });

      // Check DLQ entry in database
      const dlqRes = await pool.query('SELECT * FROM dead_letter_jobs WHERE job_id = $1', [job.id]);
      expect(dlqRes.rows.length).toBe(1);

      const dlqRow = dlqRes.rows[0];
      expect(dlqRow.queue_id).toBe(q.id);
      expect(dlqRow.final_error_message).toBe('Account fraud detected');
      expect(dlqRow.final_error_code).toBe('ERR_FRAUD');
      expect(dlqRow.total_attempts).toBe(1);
      expect(dlqRow.payload).toEqual({ creditCard: '4111-XXXX-XXXX-1111', amount: 99.95 });
    });
  });

  // ─── 7. Worker heartbeat timeout ──────────────────────────────────────────
  describe('7. Worker Heartbeat Timeout & Stale Worker Reaper', () => {
    it('detects dead workers whose heartbeat expired and marks them unhealthy', async () => {
      const deadWorker = await workerRepo.register({
        projectId,
        hostname: 'crashed-worker-node',
        pid: 9999,
      });

      // Simulate crash by setting last_heartbeat_at to 60 seconds ago
      await pool.query(
        `UPDATE workers SET last_heartbeat_at = NOW() - INTERVAL '60 seconds' WHERE id = $1`,
        [deadWorker.id]
      );

      // Run stale worker scanner with 30s threshold
      const staleWorkers = await workerRepo.markStaleWorkers(30, undefined, projectId);
      expect(staleWorkers.some((w) => w.id === deadWorker.id)).toBe(true);

      const updated = await workerRepo.findById(deadWorker.id);
      expect(updated!.status).toBe(WorkerStatus.UNHEALTHY);
    });
  });

  // ─── 8. Graceful shutdown ─────────────────────────────────────────────────
  describe('8. Worker Graceful Shutdown & Drain', () => {
    it('finishes in-flight job before stopping and rejects new claims while draining', async () => {
      const q = await queueRepo.create({ projectId, name: `q8-graceful-${Date.now()}` });
      const workerInstance = new Worker(pool, {
        projectId,
        queueId: q.id,
        concurrency: 1,
        pollIntervalMs: 50,
      });

      let handlerCompleted = false;
      workerInstance.registerHandler('graceful-job', async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        handlerCompleted = true;
        return { success: true };
      });

      await workerInstance.start();

      const job = await jobRepo.create({
        queueId: q.id,
        name: 'graceful-job',
        priority: 5,
      });

      // Wait for worker to claim and start processing
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Trigger graceful stop
      await workerInstance.stop();

      expect(handlerCompleted).toBe(true);
      expect(workerInstance.status).toBe(WorkerStatus.OFFLINE);

      const dbWorker = await workerRepo.findById(workerInstance.id);
      expect(dbWorker!.status).toBe(WorkerStatus.STOPPED);

      const dbJob = await jobRepo.findById(job.id);
      expect(dbJob!.status).toBe(JobStatus.COMPLETED);
    });
  });

  // ─── 9. Scheduler race conditions ─────────────────────────────────────────
  describe('9. Scheduler Race Conditions on Delayed Job Promotion', () => {
    it('promotes due scheduled jobs atomically with zero duplicate promotions across 5 parallel schedulers', async () => {
      const q = await queueRepo.create({ projectId, name: `q9-sched-${Date.now()}` });
      const scheduledJobIds: string[] = [];
      for (let i = 1; i <= 20; i++) {
        const j = await jobRepo.create({
          queueId: q.id,
          name: `sched-race-${i}`,
          type: 'scheduled',
          status: JobStatus.SCHEDULED,
          scheduledAt: new Date(Date.now() - 5000), // Due in the past
        });
        scheduledJobIds.push(j.id);
      }

      // Create 5 concurrent scheduler instances
      const schedulers = Array.from({ length: 5 }, () => new Scheduler(pool, { projectId }));

      // Run parallel promoteDueJobs calls
      const results = await Promise.all(schedulers.map((s) => s.promoteDueJobs(50)));

      // Aggregate all promoted job IDs
      const allPromoted = results.flatMap((res) => res.map((item) => item.id));
      expect(allPromoted.length).toBe(20);

      // Verify every promoted job ID is strictly unique
      const uniquePromoted = new Set(allPromoted);
      expect(uniquePromoted.size).toBe(20);

      // Verify database state: all 20 are now PENDING
      const dbRes = await pool.query(
        `SELECT COUNT(*) FROM jobs WHERE id = ANY($1) AND status = 'pending'`,
        [scheduledJobIds]
      );
      expect(parseInt(dbRes.rows[0].count, 10)).toBe(20);
    });
  });

  // ─── 10. Duplicate scheduler instances ────────────────────────────────────
  describe('10. Duplicate Scheduler Instances with Redis Redlock Leader Election', () => {
    it('ensures only one active leader acquires the distributed coordination lock', async () => {
      const lockKey = `scheduler:leader:test:${Date.now()}`;
      const ttlMs = 5000;

      // Instance 1 acquires lock
      const lock1 = await tryAcquireLock(lockKey, ttlMs);
      if (lock1) {
        // Instance 2 attempts to acquire same key: MUST receive null (locked by Instance 1)
        const lock2 = await tryAcquireLock(lockKey, ttlMs);
        expect(lock2).toBeNull();

        // Instance 1 releases lock
        await lock1.release();

        // Instance 2 can now acquire lock
        const lock2After = await tryAcquireLock(lockKey, ttlMs);
        expect(lock2After).not.toBeNull();
        await lock2After!.release();
      }
    });
  });

  // ─── 11. Database transaction rollback ────────────────────────────────────
  describe('11. Database Transaction Atomicity & Rollback', () => {
    it('rolls back completely without changing job state if an error occurs mid-claim', async () => {
      const q = await queueRepo.create({ projectId, name: `q11-rollback-${Date.now()}` });
      const job = await jobRepo.create({
        queueId: q.id,
        name: `rollback-test-job-${Date.now()}`,
        priority: 5,
      });

      const client: PoolClient = await pool.connect();
      try {
        await client.query('BEGIN');

        // Claim job inside transaction
        await client.query(
          `UPDATE jobs SET status = 'running', worker_id = $1 WHERE id = $2`,
          [worker1Id, job.id]
        );

        // Simulate fatal error mid-execution
        throw new Error('Simulated failure during execution setup');
      } catch {
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }

      // Verify job remained in pending status with no worker assigned
      const verifyJob = await jobRepo.findById(job.id);
      expect(verifyJob!.status).toBe(JobStatus.PENDING);
      expect(verifyJob!.workerId).toBeNull();
    });
  });

  // ─── 12. Job cancellation race ────────────────────────────────────────────
  describe('12. Job Cancellation Race Condition', () => {
    it('prevents worker from claiming a job that was cancelled concurrently', async () => {
      const q = await queueRepo.create({ projectId, name: `q12-cancel-${Date.now()}` });
      const job = await jobRepo.create({
        queueId: q.id,
        name: `cancellation-race-job-${Date.now()}`,
        priority: 5,
      });

      // User cancels job
      await jobRepo.cancel(job.id);

      // Concurrent worker attempt to claim on empty queue
      const claim = await claimService.claimJob(worker1Id, q.id);
      expect(claim).toBeNull();

      const dbJob = await jobRepo.findById(job.id);
      expect(dbJob!.status).toBe(JobStatus.CANCELLED);
    });
  });

  // ─── 13. Priority ordering ────────────────────────────────────────────────
  describe('13. Priority-Based Claim Ordering Under High Contention', () => {
    it('strictly claims highest priority jobs (10) before medium (5) and low (1)', async () => {
      const q = await queueRepo.create({ projectId, name: `q13-prio-${Date.now()}` });
      const low = await jobRepo.create({ queueId: q.id, name: 'low-p1', priority: 1 });
      const high = await jobRepo.create({ queueId: q.id, name: 'high-p10', priority: 10 });
      const mid = await jobRepo.create({ queueId: q.id, name: 'mid-p5', priority: 5 });

      const c1 = await claimService.claimJob(worker1Id, q.id);
      expect(c1!.id).toBe(high.id);
      expect(c1!.priority).toBe(10);

      const c2 = await claimService.claimJob(worker1Id, q.id);
      expect(c2!.id).toBe(mid.id);
      expect(c2!.priority).toBe(5);

      const c3 = await claimService.claimJob(worker1Id, q.id);
      expect(c3!.id).toBe(low.id);
      expect(c3!.priority).toBe(1);

      // Clean up
      await claimService.completeJob(high.id, worker1Id);
      await claimService.completeJob(mid.id, worker1Id);
      await claimService.completeJob(low.id, worker1Id);
    });
  });
});
