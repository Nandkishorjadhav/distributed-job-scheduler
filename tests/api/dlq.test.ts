import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../backend/api/src/app';
import {
  JobClaimService,
  JobRepository,
  WorkerRepository,
  QueueRepository,
  getPool,
} from '@job-scheduler/backend-shared';
import { JobStatus, DLQStatus } from '@job-scheduler/shared';

const app = createApp();

describe('Dead Letter Queue (DLQ) API Tests', () => {
  const pool = getPool();
  const claimService = new JobClaimService(pool);
  const jobRepo = new JobRepository(pool);
  const queueRepo = new QueueRepository(pool);
  const workerRepo = new WorkerRepository(pool);

  const time = Date.now();

  const userOwner = {
    email: `dlq_owner_${time}@example.com`,
    password: 'password123',
    name: 'DLQ Owner User',
  };

  const userStranger = {
    email: `dlq_stranger_${time}@example.com`,
    password: 'password123',
    name: 'DLQ Stranger User',
  };

  let tokenOwner: string;
  let tokenStranger: string;
  let userIdOwner: string;

  let orgId: string;
  let projectId: string;
  let queueId: string;
  let workerId: string;

  let deadJobId: string;
  let dlqRecordId: string;

  beforeAll(async () => {
    // 1. Register users
    const resOwner = await request(app).post('/api/v1/auth/register').send(userOwner);
    tokenOwner = resOwner.body.data.token;
    userIdOwner = resOwner.body.data.user.id;

    const resStranger = await request(app).post('/api/v1/auth/register').send(userStranger);
    tokenStranger = resStranger.body.data.token;

    // 2. Create Org
    const orgRes = await request(app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ name: 'DLQ Test Org', slug: `dlq-org-${time}` });
    orgId = orgRes.body.data.organization.id;

    // 3. Create Project
    const projRes = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ organizationId: orgId, name: 'DLQ Project', slug: `dlq-proj-${time}` });
    projectId = projRes.body.data.project.id;

    // 4. Create Queue with DLQ enabled
    const queueRes = await request(app)
      .post('/api/v1/queues')
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ projectId, name: `dlq-queue-${time}`, dlqEnabled: true });
    queueId = queueRes.body.data.queue.id;

    // 5. Register Worker
    const worker = await workerRepo.register({
      projectId,
      hostname: 'dlq-worker-host',
      pid: 5001,
    });
    workerId = worker.id;

    // 6. Create Job and fail it to exhaust attempts (maxAttempts = 2)
    const job = await jobRepo.create({
      queueId,
      name: 'failing-dlq-job',
      payload: { invoice: 'INV-1001' },
      maxAttempts: 2,
    });
    deadJobId = job.id;

    // Attempt 1: Claim and fail
    const c1 = await claimService.claimJob(workerId, queueId);
    expect(c1).not.toBeNull();
    await claimService.failJob(deadJobId, workerId, {
      message: 'Payment gateway timeout',
      code: 'ERR_GATEWAY_TIMEOUT',
      retryDelayMs: 0,
    });

    // Reset next_attempt_at for attempt 2
    await pool.query(
      `UPDATE jobs SET next_attempt_at = NOW() - INTERVAL '1 second', status = 'pending' WHERE id = $1`,
      [deadJobId]
    );

    // Attempt 2: Claim and fail (exhausts maxAttempts)
    const c2 = await claimService.claimJob(workerId, queueId);
    expect(c2).not.toBeNull();
    await claimService.failJob(deadJobId, workerId, {
      message: 'Account card declined: insufficient funds',
      code: 'ERR_CARD_DECLINED',
    });

    // Add sample execution logs for inspection verification
    await pool.query(
      `INSERT INTO job_logs (job_id, level, message) VALUES ($1, 'error', 'Card decline logged')`,
      [deadJobId]
    );
  });

  describe('DLQ Listing & Filtering', () => {
    it('lists DLQ jobs for the project with pagination', async () => {
      const response = await request(app)
        .get('/api/v1/dlq?page=1&pageSize=10')
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThanOrEqual(1);

      const dlqItem = response.body.data.find((d: any) => d.jobId === deadJobId);
      expect(dlqItem).toBeDefined();
      expect(dlqItem.name).toBe('failing-dlq-job');
      expect(dlqItem.finalErrorCode).toBe('ERR_CARD_DECLINED');
      expect(dlqItem.totalAttempts).toBe(2);
      expect(dlqItem.status).toBe(DLQStatus.UNHANDLED);
      expect(dlqItem.failedWorkerId).toBe(workerId);
      expect(dlqItem.queueName).toBeDefined();

      dlqRecordId = dlqItem.id;
    });

    it('lists DLQ jobs scoped to a specific queue via /api/v1/queues/:queueId/dlq', async () => {
      const response = await request(app)
        .get(`/api/v1/queues/${queueId}/dlq`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBeGreaterThanOrEqual(1);
      expect(response.body.data[0].queueId).toBe(queueId);
    });

    it('filters DLQ jobs by search query', async () => {
      const response = await request(app)
        .get('/api/v1/dlq?search=insufficient')
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeGreaterThanOrEqual(1);
      expect(response.body.data[0].finalErrorMessage).toContain('insufficient funds');
    });

    it('rejects DLQ listing for unauthorized user with 403 Forbidden', async () => {
      const response = await request(app)
        .get(`/api/v1/queues/${queueId}/dlq`)
        .set('Authorization', `Bearer ${tokenStranger}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });
  });

  describe('DLQ Inspection', () => {
    it('inspects a DLQ job returning snapshot, execution history, and logs', async () => {
      const response = await request(app)
        .get(`/api/v1/dlq/${dlqRecordId}`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.dlq).toBeDefined();
      expect(response.body.data.dlq.id).toBe(dlqRecordId);
      expect(response.body.data.dlq.finalErrorCode).toBe('ERR_CARD_DECLINED');

      // Verify execution history
      expect(Array.isArray(response.body.data.executions)).toBe(true);
      expect(response.body.data.executions.length).toBe(2);

      // Verify logs
      expect(Array.isArray(response.body.data.logs)).toBe(true);
      expect(response.body.data.logs.length).toBeGreaterThanOrEqual(1);
    });

    it('returns 404 for non-existent DLQ record', async () => {
      const response = await request(app)
        .get('/api/v1/dlq/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('DLQ_RECORD_NOT_FOUND');
    });
  });

  describe('DLQ Statistics', () => {
    it('returns dashboard-ready DLQ statistics with breakdowns', async () => {
      const response = await request(app)
        .get('/api/v1/dlq/stats')
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.totalDlqJobs).toBeGreaterThanOrEqual(1);
      expect(response.body.data.unhandledCount).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(response.body.data.byQueue)).toBe(true);
      expect(Array.isArray(response.body.data.topErrorCodes)).toBe(true);
      expect(Array.isArray(response.body.data.recentFailures)).toBe(true);

      const errorCodeStat = response.body.data.topErrorCodes.find(
        (e: any) => e.errorCode === 'ERR_CARD_DECLINED'
      );
      expect(errorCodeStat).toBeDefined();
      expect(errorCodeStat.count).toBeGreaterThanOrEqual(1);
    });

    it('returns queue-scoped DLQ statistics via /api/v1/queues/:queueId/dlq/stats', async () => {
      const response = await request(app)
        .get(`/api/v1/queues/${queueId}/dlq/stats`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.totalDlqJobs).toBeGreaterThanOrEqual(1);
    });
  });

  describe('DLQ Job Re-queue (Retry)', () => {
    it('re-queues a dead job back to pending state and updates DLQ status to retried', async () => {
      const response = await request(app)
        .post(`/api/v1/dlq/${dlqRecordId}/retry`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.dlq.status).toBe(DLQStatus.RETRIED);
      expect(response.body.data.dlq.requeuedAt).not.toBeNull();
      expect(response.body.data.dlq.requeuedBy).toBe(userIdOwner);

      // Verify original job state reset to pending
      const job = await jobRepo.findById(deadJobId);
      expect(job).not.toBeNull();
      expect(job!.status).toBe(JobStatus.PENDING);
      expect(job!.attemptCount).toBe(0);
      expect(job!.errorMessage).toBeNull();
    });
  });

  describe('DLQ Job Archive & Delete', () => {
    let secondDlqId: string;
    let secondQueueId: string;

    beforeAll(async () => {
      // Create a separate queue for isolated archive/delete testing
      const q2 = await queueRepo.create({
        projectId,
        name: `dlq-archive-queue-${time}`,
        dlqEnabled: true,
      });
      secondQueueId = q2.id;

      const job2 = await jobRepo.create({
        queueId: secondQueueId,
        name: 'second-dead-job',
        maxAttempts: 1,
      });

      const claimed2 = await claimService.claimJob(workerId, secondQueueId);
      expect(claimed2).not.toBeNull();

      await claimService.failJob(job2.id, workerId, {
        message: 'Permanent parse failure',
        code: 'ERR_PARSE_FAIL',
      });

      const listRes = await request(app)
        .get('/api/v1/dlq')
        .set('Authorization', `Bearer ${tokenOwner}`);
      const item = listRes.body.data.find((d: any) => d.jobId === job2.id);
      secondDlqId = item.id;
    });

    it('archives a DLQ job', async () => {
      const response = await request(app)
        .post(`/api/v1/dlq/${secondDlqId}/archive`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.dlq.status).toBe(DLQStatus.ARCHIVED);
      expect(response.body.data.dlq.archivedAt).not.toBeNull();
    });

    it('permanently deletes a DLQ job', async () => {
      const response = await request(app)
        .delete(`/api/v1/dlq/${secondDlqId}`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify record is gone
      const getRes = await request(app)
        .get(`/api/v1/dlq/${secondDlqId}`)
        .set('Authorization', `Bearer ${tokenOwner}`);
      expect(getRes.status).toBe(404);
    });
  });
});
