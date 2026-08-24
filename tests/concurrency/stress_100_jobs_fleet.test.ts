import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getPool,
  JobRepository,
  QueueRepository,
  ProjectRepository,
  OrgRepository,
  DeadLetterJobRepository,
} from '@job-scheduler/backend-shared';
import { Worker } from '@job-scheduler/worker';
import { Scheduler } from '@job-scheduler/scheduler';
import { JobStatus, WorkerStatus } from '@job-scheduler/shared';

describe('Flagship Concurrency & Reliability Stress Test: 100 Jobs Fleet', () => {
  const pool = getPool();
  const jobRepo = new JobRepository(pool);
  const queueRepo = new QueueRepository(pool);
  const projectRepo = new ProjectRepository(pool);
  const orgRepo = new OrgRepository(pool);
  const dlqRepo = new DeadLetterJobRepository(pool);

  const time = Date.now();
  let orgId: string;
  let projectId: string;
  let queueId: string;
  const workers: Worker[] = [];

  const totalSuccessJobs = 60;
  const totalRetryJobs = 20;
  const totalFailJobs = 20;
  const totalJobs = totalSuccessJobs + totalRetryJobs + totalFailJobs; // 100

  beforeAll(async () => {
    // 1. Create Tenant Hierarchy
    const userRes = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'hash100', 'Fleet Tester') RETURNING id`,
      [`fleet_user_${time}@example.com`]
    );
    const userId = userRes.rows[0].id;

    const org = await orgRepo.create({ name: 'Fleet Org', slug: `fleet-org-${time}` }, userId);
    orgId = org.id;

    const project = await projectRepo.create({
      organizationId: orgId,
      name: 'Fleet Project',
      slug: `fleet-proj-${time}`,
    });
    projectId = project.id;

    // 2. Create Stress Queue with concurrency_limit = 10, max_attempts = 2
    const queue = await queueRepo.create({
      projectId,
      name: `fleet-queue-${time}`,
      priority: 5,
      concurrencyLimit: 10,
      dlqEnabled: true,
    });
    queueId = queue.id;

    // 3. Initialize 5 Distributed Worker Nodes
    for (let i = 1; i <= 5; i++) {
      const worker = new Worker(pool, {
        projectId,
        queueId,
        concurrency: 5,
        pollIntervalMs: 50,
        hostname: `fleet-node-0${i}`,
        pid: 4000 + i,
      });

      // Handler A: Normal Success Jobs
      worker.registerHandler('stress-success', async (context) => {
        await new Promise((res) => setTimeout(res, 5));
        return { index: context.payload?.index, status: 'processed_ok' };
      });

      // Handler B: Transient Failure Jobs (Fails attempt 1, succeeds attempt 2)
      worker.registerHandler('stress-retry', async (context) => {
        await new Promise((res) => setTimeout(res, 5));
        if (context.attemptCount === 1) {
          throw new Error('Temporary upstream 503 error');
        }
        return { index: context.payload?.index, status: 'recovered_on_retry' };
      });

      // Handler C: Permanent Failure Jobs (Fails all attempts -> DLQ)
      worker.registerHandler('stress-fail', async () => {
        await new Promise((res) => setTimeout(res, 5));
        throw new Error('Permanent database constraint error');
      });

      workers.push(worker);
    }
  });

  afterAll(async () => {
    for (const w of workers) {
      await w.stop();
    }
  });

  it('submits 100 diverse jobs, processes them across 5 worker instances, and verifies complete invariants', async () => {
    // 1. Enqueue 60 Success Jobs
    const successJobIds: string[] = [];
    for (let i = 1; i <= totalSuccessJobs; i++) {
      const j = await jobRepo.create({
        queueId,
        name: 'stress-success',
        priority: 5,
        maxAttempts: 2,
        payload: { type: 'success', index: i },
      });
      successJobIds.push(j.id);
    }

    // 2. Enqueue 20 Transient Retry Jobs
    const retryJobIds: string[] = [];
    for (let i = 1; i <= totalRetryJobs; i++) {
      const j = await jobRepo.create({
        queueId,
        name: 'stress-retry',
        priority: 5,
        maxAttempts: 2,
        payload: { type: 'retry', index: i },
      });
      retryJobIds.push(j.id);
    }

    // 3. Enqueue 20 Permanent Failure Jobs
    const failJobIds: string[] = [];
    for (let i = 1; i <= totalFailJobs; i++) {
      const j = await jobRepo.create({
        queueId,
        name: 'stress-fail',
        priority: 5,
        maxAttempts: 2,
        payload: { type: 'fail', index: i },
      });
      failJobIds.push(j.id);
    }

    expect(successJobIds.length + retryJobIds.length + failJobIds.length).toBe(100);

    // 4. Start Active Concurrency Monitor to guarantee queue limit is NEVER violated
    let maxObservedRunning = 0;
    const monitorInterval = setInterval(async () => {
      try {
        const countRes = await pool.query(
          `SELECT COUNT(*) FROM jobs WHERE queue_id = $1 AND status = 'running'`,
          [queueId]
        );
        const running = parseInt(countRes.rows[0].count, 10);
        if (running > maxObservedRunning) {
          maxObservedRunning = running;
        }
      } catch {}
    }, 10);

    // 5. Start Worker Fleet
    for (const w of workers) {
      await w.start();
    }

    // 6. Wait for all 100 jobs to reach terminal state (completed or dead/failed)
    const deadline = Date.now() + 25000;
    let completedCount = 0;
    let deadCount = 0;

    while (Date.now() < deadline) {
      // Auto-promote any retrying failed jobs for fast test execution
      await pool.query(
        `UPDATE jobs
         SET status = 'pending', enqueued_at = NOW(), next_attempt_at = NULL
         WHERE queue_id = $1 AND status = 'failed' AND attempt_count < max_attempts`,
        [queueId]
      );

      const statusRes = await pool.query(
        `SELECT status, COUNT(*) FROM jobs WHERE queue_id = $1 GROUP BY status`,
        [queueId]
      );

      completedCount = 0;
      deadCount = 0;
      for (const row of statusRes.rows) {
        if (row.status === 'completed') completedCount = parseInt(row.count, 10);
        if (row.status === 'dead' || row.status === 'failed') deadCount += parseInt(row.count, 10);
      }

      if (completedCount === 80 && deadCount === 20) {
        break;
      }

      await new Promise((res) => setTimeout(res, 50));
    }

    clearInterval(monitorInterval);

    // ─── VERIFICATION 1: All eligible jobs are processed ─────────────────────
    expect(completedCount).toBe(80); // 60 success + 20 retried
    expect(deadCount).toBe(20); // 20 permanently failed / dead (quarantined in DLQ)
    expect(completedCount + deadCount).toBe(100);

    // ─── VERIFICATION 2: Queue Concurrency Limit was strictly respected ─────
    expect(maxObservedRunning).toBeLessThanOrEqual(10);

    // ─── VERIFICATION 3: Zero duplicate claims ───────────────────────────────
    const executionRes = await pool.query(
      `SELECT job_id, attempt_number, COUNT(*)
       FROM job_executions
       WHERE job_id IN (SELECT id FROM jobs WHERE queue_id = $1)
       GROUP BY job_id, attempt_number
       HAVING COUNT(*) > 1`,
      [queueId]
    );
    expect(executionRes.rows.length).toBe(0); // No attempt was ever executed more than once

    // ─── VERIFICATION 4: Permanently failed jobs reach DLQ ───────────────────
    const dlqRes = await pool.query(`SELECT COUNT(*) FROM dead_letter_jobs WHERE queue_id = $1`, [
      queueId,
    ]);
    expect(parseInt(dlqRes.rows[0].count, 10)).toBe(20);

    // Verify DLQ contents match the fail jobs
    const dlqJobs = await dlqRepo.list({ queueId, pageSize: 50 });
    expect(dlqJobs.data.length).toBe(20);
    for (const dlqJob of dlqJobs.data) {
      expect(dlqJob.name).toBe('stress-fail');
      expect(dlqJob.totalAttempts).toBe(2);
      expect(dlqJob.finalErrorMessage).toContain('Permanent database constraint error');
      expect(failJobIds.includes(dlqJob.jobId)).toBe(true);
    }

    // ─── VERIFICATION 5: Retry jobs successfully finished with 2 attempts ───
    const retryDbJobs = await pool.query(
      `SELECT attempt_count, status FROM jobs WHERE id = ANY($1)`,
      [retryJobIds]
    );
    for (const row of retryDbJobs.rows) {
      expect(row.status).toBe(JobStatus.COMPLETED);
      expect(row.attempt_count).toBe(2);
    }

    // ─── VERIFICATION 6: Success jobs finished with 1 attempt ────────────────
    const successDbJobs = await pool.query(
      `SELECT id, attempt_count, status, error_message, error_code FROM jobs WHERE id = ANY($1)`,
      [successJobIds]
    );
    for (const row of successDbJobs.rows) {
      if (row.attempt_count > 1) {
        const execs = await pool.query('SELECT * FROM job_executions WHERE job_id = $1', [row.id]);
        console.error('Success job had multiple attempts:', { job: row, executions: execs.rows });
      }
      expect(row.status).toBe(JobStatus.COMPLETED);
      expect(row.attempt_count).toBe(1);
    }
  }, 30000);
});
