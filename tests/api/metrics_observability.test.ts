import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../backend/api/src/app';
import {
  JobRepository,
  QueueRepository,
  ProjectRepository,
  OrgRepository,
  UserRepository,
  WorkerRepository,
  JobClaimService,
  getPool,
} from '@job-scheduler/backend-shared';

const app = createApp();

describe('Production Observability & Metrics API Tests', () => {
  const pool = getPool();
  const orgRepo = new OrgRepository(pool);
  const projRepo = new ProjectRepository(pool);
  const queueRepo = new QueueRepository(pool);
  const jobRepo = new JobRepository(pool);
  const workerRepo = new WorkerRepository(pool);
  const claimService = new JobClaimService(pool);

  const time = Date.now();

  let token: string;
  let orgId: string;
  let projectId: string;
  let queueId: string;
  let workerId: string;
  let completedJobId: string;
  let failedJobId: string;

  beforeAll(async () => {
    // 1. Register User & authenticate
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: `metrics_tester_${time}@example.com`,
        password: 'password123',
        name: 'Metrics Tester',
      });
    token = regRes.body.data.token;

    // 2. Create Org, Project & Queue
    const orgRes = await request(app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Observability Org', slug: `obs-org-${time}` });
    orgId = orgRes.body.data.organization.id;

    const projRes = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ organizationId: orgId, name: 'Observability Project', slug: `obs-proj-${time}` });
    projectId = projRes.body.data.project.id;

    const queueRes = await request(app)
      .post('/api/v1/queues')
      .set('Authorization', `Bearer ${token}`)
      .send({
        projectId,
        name: `obs-queue-${time}`,
        priority: 8,
        concurrencyLimit: 10,
        dlqEnabled: true,
      });
    queueId = queueRes.body.data.queue.id;

    // 3. Register Worker node
    const workerRes = await workerRepo.register({
      projectId,
      hostname: 'obs-worker-node-01',
      pid: 24001,
      maxConcurrency: 5,
    });
    workerId = workerRes.id;

    // 4. Create sample jobs and cycle through states
    // Job 1: Completed job with execution duration
    const j1 = await jobRepo.create({ queueId, name: 'job-to-complete' });
    completedJobId = j1.id;
    await claimService.claimJob(workerId, queueId);
    await claimService.completeJob(completedJobId, workerId, { processed: true });

    // Job 2: Failed & retried job
    const j2 = await jobRepo.create({ queueId, name: 'job-to-fail', maxAttempts: 3 });
    failedJobId = j2.id;
    await claimService.claimJob(workerId, queueId);
    await claimService.failJob(failedJobId, workerId, {
      message: 'Temporary connection reset',
      code: 'ERR_CONN_RESET',
      retryDelayMs: 2000,
    });

    // Job 3: Pending job
    await jobRepo.create({ queueId, name: 'job-pending-in-queue' });
  });

  describe('1. Live System & Project Metrics API (GET /api/v1/metrics)', () => {
    it('returns aggregate summary counters, worker health, and queue depths', async () => {
      const response = await request(app)
        .get(`/api/v1/metrics?projectId=${projectId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();

      const { summary, executionDuration, workers, queueDepths } = response.body.data;

      // Summary checks
      expect(summary.totalJobs).toBeGreaterThanOrEqual(3);
      expect(summary.completedJobs).toBeGreaterThanOrEqual(1);
      expect(summary.failedJobs).toBeGreaterThanOrEqual(1);
      expect(summary.pendingJobs).toBeGreaterThanOrEqual(1);
      expect(summary.retryCount).toBeGreaterThanOrEqual(1);

      // Duration percentiles checks
      expect(executionDuration.totalExecutionsCount).toBeGreaterThanOrEqual(1);
      expect(typeof executionDuration.avgDurationMs).toBe('number');
      expect(typeof executionDuration.p50DurationMs).toBe('number');
      expect(typeof executionDuration.p95DurationMs).toBe('number');
      expect(typeof executionDuration.p99DurationMs).toBe('number');

      // Workers health checks
      expect(workers.total).toBeGreaterThanOrEqual(1);
      expect(workers.totalConcurrencyCapacity).toBeGreaterThanOrEqual(5);

      // Queue depth checks
      expect(Array.isArray(queueDepths)).toBe(true);
      const queueDepth = queueDepths.find((q: any) => q.queueId === queueId);
      expect(queueDepth).toBeDefined();
      expect(queueDepth.pendingCount).toBeGreaterThanOrEqual(1);
    });

    it('returns request correlation ID in metrics response', async () => {
      const customTraceId = 'metrics-custom-trace-888';
      const response = await request(app)
        .get(`/api/v1/metrics?projectId=${projectId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Request-Id', customTraceId);

      expect(response.status).toBe(200);
      expect(response.body.requestId).toBe(customTraceId);
      expect(response.headers['x-request-id']).toBe(customTraceId);
    });
  });

  describe('2. Queue-Scoped Metrics (GET /api/v1/metrics/queues/:queueId)', () => {
    it('returns deep metrics isolated to target queue', async () => {
      const response = await request(app)
        .get(`/api/v1/metrics/queues/${queueId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.summary.totalJobs).toBeGreaterThanOrEqual(3);
    });

    it('returns 404 for non-existent queue ID', async () => {
      const response = await request(app)
        .get('/api/v1/metrics/queues/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('QUEUE_NOT_FOUND');
    });
  });

  describe('3. Prometheus Text Exposition (GET /api/v1/metrics/prometheus)', () => {
    it('exports metrics formatted according to Prometheus exposition standard', async () => {
      const response = await request(app)
        .get(`/api/v1/metrics/prometheus?projectId=${projectId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.text).toContain('# HELP job_scheduler_jobs_total');
      expect(response.text).toContain('# TYPE job_scheduler_jobs_total gauge');
      expect(response.text).toContain('job_scheduler_jobs_total{status="completed"}');
      expect(response.text).toContain('job_scheduler_retries_total');
      expect(response.text).toContain('job_scheduler_execution_duration_ms{stat="avg"}');
      expect(response.text).toContain('job_scheduler_workers_total{status="online"}');
      expect(response.text).toContain('job_scheduler_queue_depth{queue=');
    });
  });
});
