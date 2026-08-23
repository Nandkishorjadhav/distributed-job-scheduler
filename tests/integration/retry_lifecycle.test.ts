import { describe, it, expect, beforeAll } from 'vitest';
import {
  getPool,
  JobClaimService,
  JobRepository,
  QueueRepository,
  ProjectRepository,
  OrgRepository,
  WorkerRepository,
  RetryPolicyRepository,
} from '@job-scheduler/backend-shared';
import { JobStatus, RetryStrategy } from '@job-scheduler/shared';

describe('End-to-End Retry Lifecycle & DLQ Integration Tests', () => {
  const pool = getPool();
  const claimService = new JobClaimService(pool);
  const jobRepo = new JobRepository(pool);
  const queueRepo = new QueueRepository(pool);
  const projectRepo = new ProjectRepository(pool);
  const orgRepo = new OrgRepository(pool);
  const workerRepo = new WorkerRepository(pool);
  const retryRepo = new RetryPolicyRepository(pool);

  const time = Date.now();
  let projectId: string;
  let queueId: string;
  let workerId: string;
  let retryPolicyId: string;

  beforeAll(async () => {
    // 1. Create Org & Project
    const userRes = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'hash', 'Retry Test User') RETURNING id`,
      [`retry_user_${time}@example.com`]
    );
    const userId = userRes.rows[0].id;

    const org = await orgRepo.create({ name: 'Retry Org', slug: `retry-org-${time}` }, userId);
    const project = await projectRepo.create({
      organizationId: org.id,
      name: 'Retry Project',
      slug: `retry-proj-${time}`,
    });
    projectId = project.id;

    // 2. Create Reusable Retry Policy: Linear backoff, 3 max attempts, 1000ms initial, 10000ms max, 0 jitter
    const retryPolicy = await retryRepo.create({
      projectId,
      name: `linear-retry-policy-${time}`,
      strategy: RetryStrategy.LINEAR,
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      jitterMs: 0,
    });
    retryPolicyId = retryPolicy.id;

    // 3. Create Queue with linked Retry Policy and DLQ enabled
    const queueRes = await pool.query(
      `INSERT INTO queues (project_id, retry_policy_id, name, priority, concurrency_limit, dlq_enabled)
       VALUES ($1, $2, $3, 5, 10, true)
       RETURNING id`,
      [projectId, retryPolicyId, `retry-queue-${time}`]
    );
    queueId = queueRes.rows[0].id;

    // 4. Register Worker
    const worker = await workerRepo.register({
      projectId,
      hostname: 'retry-worker-node',
      pid: 4001,
    });
    workerId = worker.id;
  });

  it('progresses job through retry lifecycle: Attempt 1 -> Attempt 2 -> Attempt 3 -> DLQ', async () => {
    // 1. Create Job with maxAttempts = 3
    const job = await jobRepo.create({
      queueId,
      name: 'critical-payment-webhook',
      payload: { transactionId: 'txn_999' },
      maxAttempts: 3,
    });

    expect(job.status).toBe(JobStatus.PENDING);
    expect(job.attemptCount).toBe(0);

    // ── Attempt 1 ─────────────────────────────────────────────────────────────
    const claim1 = await claimService.claimJob(workerId, queueId);
    expect(claim1).not.toBeNull();
    expect(claim1!.id).toBe(job.id);
    expect(claim1!.status).toBe(JobStatus.RUNNING);
    expect(claim1!.attemptCount).toBe(1);

    // Fail Attempt 1 with deterministic linear calculation
    const beforeFail1 = Date.now();
    const fail1 = await claimService.failJob(job.id, workerId, {
      message: 'Network socket timeout',
      code: 'ERR_SOCKET_TIMEOUT',
      randomFn: () => 0, // deterministic 0 jitter
    });

    expect(fail1.status).toBe(JobStatus.FAILED);
    expect(fail1.nextAttemptAt).not.toBeNull();
    // Linear delay: Attempt 1 -> 1 * 1000ms = 1000ms delay
    const delay1 = fail1.nextAttemptAt!.getTime() - beforeFail1;
    expect(delay1).toBeGreaterThanOrEqual(950);
    expect(delay1).toBeLessThanOrEqual(1200);

    // Verify 1st execution record created
    let history = await jobRepo.getExecutionHistory(job.id);
    expect(history.length).toBe(1);
    expect(history[0].attemptNumber).toBe(1);
    expect(history[0].status).toBe('failed');
    expect(history[0].errorMessage).toBe('Network socket timeout');
    expect(history[0].nextRetryAt).not.toBeNull();

    // ── Simulate Next Run Time Due for Attempt 2 ───────────────────────────────
    await pool.query(
      `UPDATE jobs SET next_attempt_at = NOW() - INTERVAL '1 second', status = 'pending' WHERE id = $1`,
      [job.id]
    );

    const claim2 = await claimService.claimJob(workerId, queueId);
    expect(claim2).not.toBeNull();
    expect(claim2!.id).toBe(job.id);
    expect(claim2!.attemptCount).toBe(2);

    // Fail Attempt 2: Linear delay -> 2 * 1000ms = 2000ms delay
    const beforeFail2 = Date.now();
    const fail2 = await claimService.failJob(job.id, workerId, {
      message: 'Remote gateway HTTP 502',
      code: 'ERR_BAD_GATEWAY',
      randomFn: () => 0,
    });

    expect(fail2.status).toBe(JobStatus.FAILED);
    const delay2 = fail2.nextAttemptAt!.getTime() - beforeFail2;
    expect(delay2).toBeGreaterThanOrEqual(1950);
    expect(delay2).toBeLessThanOrEqual(2200);

    // Verify 2nd execution record created
    history = await jobRepo.getExecutionHistory(job.id);
    expect(history.length).toBe(2);
    expect(history[1].attemptNumber).toBe(2);
    expect(history[1].errorMessage).toBe('Remote gateway HTTP 502');

    // ── Simulate Next Run Time Due for Attempt 3 (Final Attempt) ───────────────
    await pool.query(
      `UPDATE jobs SET next_attempt_at = NOW() - INTERVAL '1 second', status = 'pending' WHERE id = $1`,
      [job.id]
    );

    const claim3 = await claimService.claimJob(workerId, queueId);
    expect(claim3).not.toBeNull();
    expect(claim3!.id).toBe(job.id);
    expect(claim3!.attemptCount).toBe(3);

    // Fail Attempt 3: Exhausts maxAttempts (3 of 3) -> Moves to DEAD (DLQ)
    const fail3 = await claimService.failJob(job.id, workerId, {
      message: 'Permanent upstream rejection',
      code: 'ERR_PERMANENT_REJECT',
      randomFn: () => 0,
    });

    expect(fail3.status).toBe(JobStatus.DEAD);
    expect(fail3.finishedAt).not.toBeNull();

    // ── Verify Dead Letter Queue Snapshot ─────────────────────────────────────
    const dlqRows = await pool.query(
      `SELECT * FROM dead_letter_jobs WHERE job_id = $1`,
      [job.id]
    );
    expect(dlqRows.rows.length).toBe(1);
    const dlq = dlqRows.rows[0];
    expect(dlq.total_attempts).toBe(3);
    expect(dlq.final_error_message).toBe('Permanent upstream rejection');
    expect(dlq.final_error_code).toBe('ERR_PERMANENT_REJECT');
    expect(dlq.first_failed_at).not.toBeNull();
    expect(dlq.last_failed_at).not.toBeNull();

    // ── Verify Complete Preserved Retry History ───────────────────────────────
    const fullHistory = await jobRepo.getJobHistory(job.id);
    expect(fullHistory).not.toBeNull();
    expect(fullHistory!.job.status).toBe(JobStatus.DEAD);
    expect(fullHistory!.executions.length).toBe(3);
    expect(fullHistory!.executions.map((e) => e.attemptNumber)).toEqual([1, 2, 3]);
    expect(fullHistory!.logs.length).toBeGreaterThanOrEqual(3);
  });
});
