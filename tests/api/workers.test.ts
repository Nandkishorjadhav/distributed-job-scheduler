import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../backend/api/src/app';
import {
  WorkerRepository,
  JobRepository,
  QueueRepository,
  ProjectRepository,
  OrgRepository,
  UserRepository,
  getPool,
} from '@job-scheduler/backend-shared';
import { WorkerStatus, JobStatus } from '@job-scheduler/shared';

const app = createApp();

describe('Worker Heartbeat Monitoring API Tests', () => {
  const pool = getPool();
  const userRepo = new UserRepository(pool);
  const orgRepo = new OrgRepository(pool);
  const projRepo = new ProjectRepository(pool);
  const queueRepo = new QueueRepository(pool);
  const jobRepo = new JobRepository(pool);
  const workerRepo = new WorkerRepository(pool);

  const time = Date.now();

  let tokenOwner: string;
  let tokenStranger: string;
  let userIdOwner: string;

  let orgId: string;
  let projectId: string;
  let queueId: string;
  let workerId: string;

  beforeAll(async () => {
    // 1. Register users
    const ownerRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: `worker_owner_${time}@example.com`,
        password: 'password123',
        name: 'Worker Owner User',
      });
    tokenOwner = ownerRes.body.data.token;
    userIdOwner = ownerRes.body.data.user.id;

    const strangerRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: `worker_stranger_${time}@example.com`,
        password: 'password123',
        name: 'Worker Stranger User',
      });
    tokenStranger = strangerRes.body.data.token;

    // 2. Create Org & Project
    const orgRes = await request(app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ name: 'Worker Telemetry Org', slug: `worker-org-${time}` });
    orgId = orgRes.body.data.organization.id;

    const projRes = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({
        organizationId: orgId,
        name: 'Worker Telemetry Project',
        slug: `worker-proj-${time}`,
      });
    projectId = projRes.body.data.project.id;

    const queueRes = await request(app)
      .post('/api/v1/queues')
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ projectId, name: `worker-queue-${time}` });
    queueId = queueRes.body.data.queue.id;
  });

  describe('1. Worker Registration', () => {
    it('registers a new worker node process with initial ONLINE status', async () => {
      const response = await request(app)
        .post('/api/v1/workers/register')
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          projectId,
          hostname: 'node-alpha-01',
          pid: 14002,
          version: '1.2.0',
          maxConcurrency: 5,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.worker).toBeDefined();
      expect(response.body.data.worker.hostname).toBe('node-alpha-01');
      expect(response.body.data.worker.maxConcurrency).toBe(5);
      expect(response.body.data.worker.status).toBe(WorkerStatus.ONLINE);
      expect(response.body.data.worker.currentJobCount).toBe(0);

      workerId = response.body.data.worker.id;
    });

    it('rejects worker registration by unauthorized user with 403 Forbidden', async () => {
      const response = await request(app)
        .post('/api/v1/workers/register')
        .set('Authorization', `Bearer ${tokenStranger}`)
        .send({
          projectId,
          hostname: 'unauthorized-node',
          pid: 9999,
        });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });
  });

  describe('2. Periodic Heartbeat Updates & State Transitions', () => {
    it('records heartbeat and keeps status ONLINE when running below max concurrency', async () => {
      const response = await request(app)
        .post(`/api/v1/workers/${workerId}/heartbeat`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          currentJobCount: 2,
          metadata: { cpu: 18.5, memMb: 120 },
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.worker.status).toBe(WorkerStatus.ONLINE);
      expect(response.body.data.worker.currentJobCount).toBe(2);
      expect(response.body.data.worker.lastHeartbeatAt).toBeDefined();
    });

    it('dynamically transitions status to BUSY when running at full concurrency capacity', async () => {
      const response = await request(app)
        .post(`/api/v1/workers/${workerId}/heartbeat`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          currentJobCount: 5, // equal to maxConcurrency 5
          metadata: { cpu: 88.0, memMb: 450 },
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.worker.status).toBe(WorkerStatus.BUSY);
      expect(response.body.data.worker.currentJobCount).toBe(5);
    });

    it('transitions back to ONLINE when job count drops below concurrency limit', async () => {
      const response = await request(app)
        .post(`/api/v1/workers/${workerId}/heartbeat`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          currentJobCount: 1,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.worker.status).toBe(WorkerStatus.ONLINE);
      expect(response.body.data.worker.currentJobCount).toBe(1);
    });
  });

  describe('3. Worker Listing & Health Status Evaluation', () => {
    it('lists workers for the project with pagination and calculated health status', async () => {
      const response = await request(app)
        .get(`/api/v1/workers?projectId=${projectId}`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThanOrEqual(1);

      const workerItem = response.body.data.find((w: any) => w.id === workerId);
      expect(workerItem).toBeDefined();
      expect(workerItem.hostname).toBe('node-alpha-01');
      expect(workerItem.calculatedStatus).toBe(WorkerStatus.ONLINE);
    });
  });

  describe('4. Worker Inspection & Telemetry', () => {
    it('retrieves detailed worker telemetry with recent heartbeats and assigned running jobs', async () => {
      // Assign a sample running job to this worker
      const job = await jobRepo.create({
        queueId,
        name: 'active-processing-task',
        timeoutMs: 30000,
      });
      await pool.query(
        `UPDATE jobs SET worker_id = $1, status = 'running', started_at = NOW() WHERE id = $2`,
        [workerId, job.id]
      );

      const response = await request(app)
        .get(`/api/v1/workers/${workerId}`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.worker.id).toBe(workerId);
      expect(Array.isArray(response.body.data.runningJobs)).toBe(true);
      expect(response.body.data.runningJobs.length).toBeGreaterThanOrEqual(1);
      expect(response.body.data.runningJobs[0].name).toBe('active-processing-task');

      // Verify time-series heartbeats are recorded
      expect(Array.isArray(response.body.data.recentHeartbeats)).toBe(true);
      expect(response.body.data.recentHeartbeats.length).toBeGreaterThanOrEqual(3);
    });

    it('returns 404 for non-existent worker ID', async () => {
      const response = await request(app)
        .get('/api/v1/workers/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('WORKER_NOT_FOUND');
    });
  });

  describe('5. Stale Worker Detection (Heartbeat Expiry)', () => {
    let staleWorkerId: string;

    beforeAll(async () => {
      // Create a worker with a stale last_heartbeat_at timestamp (e.g. 60 seconds in the past)
      const staleWorker = await workerRepo.register({
        projectId,
        hostname: 'node-stale-02',
        pid: 14099,
      });
      staleWorkerId = staleWorker.id;

      await pool.query(
        `UPDATE workers SET last_heartbeat_at = NOW() - INTERVAL '60 seconds' WHERE id = $1`,
        [staleWorkerId]
      );
    });

    it('scans and identifies workers whose heartbeat has expired and transitions them to UNHEALTHY', async () => {
      const response = await request(app)
        .post('/api/v1/workers/stale/scan?timeoutSeconds=30')
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.count).toBeGreaterThanOrEqual(1);

      const foundStale = response.body.data.staleWorkers.find((w: any) => w.id === staleWorkerId);
      expect(foundStale).toBeDefined();
      expect(foundStale.status).toBe(WorkerStatus.UNHEALTHY);

      // Verify DB status is now unhealthy
      const updated = await workerRepo.findById(staleWorkerId);
      expect(updated!.status).toBe(WorkerStatus.UNHEALTHY);
    });
  });

  describe('6. Clean Worker Stop & Deregistration', () => {
    it('marks a worker as STOPPED when stopping cleanly', async () => {
      const response = await request(app)
        .post(`/api/v1/workers/${workerId}/stop`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const updated = await workerRepo.findById(workerId);
      expect(updated!.status).toBe(WorkerStatus.STOPPED);
    });
  });
});
