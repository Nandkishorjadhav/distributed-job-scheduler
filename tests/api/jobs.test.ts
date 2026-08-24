import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../backend/api/src/app';
import { JobRepository, getPool } from '@job-scheduler/backend-shared';

const app = createApp();

describe('Job Domain Model & Lifecycle API Tests', () => {
  const time = Date.now();

  const userOwner = {
    email: `job_owner_${time}@example.com`,
    password: 'password123',
    name: 'Job Owner User',
  };

  const userStranger = {
    email: `job_stranger_${time}@example.com`,
    password: 'password123',
    name: 'Job Stranger User',
  };

  let tokenOwner: string;
  let tokenStranger: string;

  let orgId: string;
  let projectId: string;
  let queueId: string;

  let immediateJobId: string;
  let delayedJobId: string;
  let failedJobId: string;

  beforeAll(async () => {
    // 1. Register Owner & Stranger
    const resOwner = await request(app).post('/api/v1/auth/register').send(userOwner);
    tokenOwner = resOwner.body.data.token;

    const resStranger = await request(app).post('/api/v1/auth/register').send(userStranger);
    tokenStranger = resStranger.body.data.token;

    // 2. Create Org
    const orgRes = await request(app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ name: 'Job Test Org', slug: `job-org-${time}` });
    orgId = orgRes.body.data.organization.id;

    // 3. Create Project
    const projRes = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ organizationId: orgId, name: 'Job Test Project', slug: `job-proj-${time}` });
    projectId = projRes.body.data.project.id;

    // 4. Create Queue
    const queueRes = await request(app)
      .post('/api/v1/queues')
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ projectId, name: `job-queue-${time}`, priority: 5 });
    queueId = queueRes.body.data.queue.id;
  });

  describe('Job Creation (Immediate, Delayed, Scheduled, Recurring Cron, Batch)', () => {
    it('creates an immediate job in PENDING status', async () => {
      const response = await request(app)
        .post(`/api/v1/queues/${queueId}/jobs`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          name: 'send-welcome-email',
          type: 'immediate',
          payload: { userId: 'usr_123', email: 'alice@example.com' },
          priority: 3,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.job.id).toBeDefined();
      expect(response.body.data.job.status).toBe('pending');
      expect(response.body.data.job.type).toBe('immediate');
      expect(response.body.data.job.queueId).toBe(queueId);

      immediateJobId = response.body.data.job.id;
    });

    it('creates a job directly using POST /api/v1/jobs with queueId in body', async () => {
      const response = await request(app)
        .post('/api/v1/jobs')
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          queueId,
          name: 'direct-submission-job',
          payload: { data: 'direct' },
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.job.name).toBe('direct-submission-job');
    });

    it('creates a delayed job in SCHEDULED status when scheduledAt is in future', async () => {
      const futureTime = new Date(Date.now() + 3600000).toISOString();
      const response = await request(app)
        .post(`/api/v1/queues/${queueId}/jobs`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          name: 'generate-monthly-report',
          type: 'delayed',
          payload: { reportId: 'rep_99' },
          scheduledAt: futureTime,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.job.status).toBe('scheduled');
      expect(response.body.data.job.type).toBe('delayed');
      expect(response.body.data.job.scheduledAt).toBeDefined();

      delayedJobId = response.body.data.job.id;
    });

    it('creates a scheduled job in SCHEDULED status', async () => {
      const futureTime = new Date(Date.now() + 7200000).toISOString();
      const response = await request(app)
        .post(`/api/v1/queues/${queueId}/jobs`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          name: 'midnight-database-backup',
          type: 'scheduled',
          payload: { target: 's3://backups' },
          scheduledAt: futureTime,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.job.status).toBe('scheduled');
      expect(response.body.data.job.type).toBe('scheduled');
    });

    it('creates a recurring cron job definition', async () => {
      const response = await request(app)
        .post(`/api/v1/queues/${queueId}/recurring`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          name: 'hourly-health-check',
          cronExpression: '0 * * * *',
          payloadTemplate: { check: 'all' },
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.scheduledJob.id).toBeDefined();
      expect(response.body.data.scheduledJob.cronExpression).toBe('0 * * * *');
    });

    it('creates a batch of child jobs in a batch group', async () => {
      const response = await request(app)
        .post(`/api/v1/queues/${queueId}/batch`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          name: 'send-bulk-notifications',
          jobs: [
            { name: 'notify-user-1', payload: { id: 1 } },
            { name: 'notify-user-2', payload: { id: 2 } },
          ],
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.batchGroupId).toBeDefined();
      expect(response.body.data.totalJobs).toBe(2);
      expect(response.body.data.jobs.length).toBe(2);
      expect(response.body.data.jobs[0].type).toBe('batch_child');
    });

    it('rejects job submission by unauthorized user with 403 Forbidden', async () => {
      const response = await request(app)
        .post(`/api/v1/queues/${queueId}/jobs`)
        .set('Authorization', `Bearer ${tokenStranger}`)
        .send({ name: 'unauth-job' });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Job Retrieval & Filtering', () => {
    it('retrieves single job detail by ID', async () => {
      const response = await request(app)
        .get(`/api/v1/jobs/${immediateJobId}`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.job.id).toBe(immediateJobId);
    });

    it('lists jobs for a queue with pagination and filters', async () => {
      const response = await request(app)
        .get(`/api/v1/queues/${queueId}/jobs?status=pending&page=1&pageSize=10`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.pagination).toBeDefined();
    });
  });

  describe('State Machine & Transition Rules', () => {
    it('cancels a pending job and sets status to CANCELLED', async () => {
      const response = await request(app)
        .post(`/api/v1/jobs/${immediateJobId}/cancel`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.job.status).toBe('cancelled');
    });

    it('prevents illegal state transition (cancelling an already cancelled job)', async () => {
      const response = await request(app)
        .post(`/api/v1/jobs/${immediateJobId}/cancel`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('JOB_CANNOT_BE_CANCELLED');
    });
  });

  describe('Job Failure & Retry Logic', () => {
    beforeAll(async () => {
      // Create a job directly and simulate failure in database
      const pool = getPool();
      const res = await pool.query(
        `
        INSERT INTO jobs (queue_id, name, type, status, payload, attempt_count, max_attempts, error_message)
        VALUES ($1, 'failing-job', 'immediate', 'failed', '{}', 1, 3, 'Connection timeout')
        RETURNING id
      `,
        [queueId]
      );
      failedJobId = res.rows[0].id;
    });

    it('retries a failed job, resetting status to PENDING and clearing errors', async () => {
      const response = await request(app)
        .post(`/api/v1/jobs/${failedJobId}/retry`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.job.status).toBe('pending');
      expect(response.body.data.job.errorMessage).toBeNull();
    });

    it('prevents retry of a job that is already pending', async () => {
      const response = await request(app)
        .post(`/api/v1/jobs/${failedJobId}/retry`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('JOB_CANNOT_BE_RETRIED');
    });
  });

  describe('Execution History & Log Recording', () => {
    it('records and retrieves execution history for a job', async () => {
      const jobRepo = new JobRepository(getPool());

      // Simulate recording an attempt
      await jobRepo.recordExecution({
        jobId: delayedJobId,
        attemptNumber: 1,
        status: 'failed',
        startedAt: new Date(Date.now() - 5000),
        finishedAt: new Date(),
        errorMessage: 'Network glitch',
        errorCode: 'ERR_NET_TIMEOUT',
      });

      const response = await request(app)
        .get(`/api/v1/jobs/${delayedJobId}/executions`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.executions)).toBe(true);
      expect(response.body.data.executions.length).toBe(1);
      expect(response.body.data.executions[0].attemptNumber).toBe(1);
      expect(response.body.data.executions[0].status).toBe('failed');
      expect(response.body.data.executions[0].durationMs).toBeGreaterThan(0);
    });

    it('retrieves execution logs for a job', async () => {
      const pool = getPool();
      await pool.query(
        `
        INSERT INTO job_logs (job_id, level, message)
        VALUES ($1, 'info', 'Step 1 completed'), ($1, 'error', 'Failed at step 2')
      `,
        [delayedJobId]
      );

      const response = await request(app)
        .get(`/api/v1/jobs/${delayedJobId}/logs`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.logs)).toBe(true);
      expect(response.body.data.logs.length).toBe(2);
    });

    it('retrieves full job history (details + executions + logs)', async () => {
      const response = await request(app)
        .get(`/api/v1/jobs/${delayedJobId}/history`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.job).toBeDefined();
      expect(Array.isArray(response.body.data.executions)).toBe(true);
      expect(Array.isArray(response.body.data.logs)).toBe(true);
    });
  });
});
