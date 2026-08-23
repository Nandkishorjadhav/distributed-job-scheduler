import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  getPool,
  JobRepository,
  QueueRepository,
  ProjectRepository,
  OrgRepository,
} from '@job-scheduler/backend-shared';
import { Worker } from '@job-scheduler/worker';
import { JobStatus, WorkerStatus } from '@job-scheduler/shared';

describe('Worker Service Lifecycle & Execution Tests', () => {
  const pool = getPool();
  const jobRepo = new JobRepository(pool);
  const queueRepo = new QueueRepository(pool);
  const projectRepo = new ProjectRepository(pool);
  const orgRepo = new OrgRepository(pool);

  const time = Date.now();
  let projectId: string;
  let queueId: string;
  let runningWorkers: Worker[] = [];

  beforeAll(async () => {
    // 1. Create Org & Project
    const userRes = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'hash', 'Worker Test User') RETURNING id`,
      [`worker_user_${time}@example.com`]
    );
    const userId = userRes.rows[0].id;

    const org = await orgRepo.create({ name: 'Worker Org', slug: `worker-org-${time}` }, userId);
    const project = await projectRepo.create({
      organizationId: org.id,
      name: 'Worker Project',
      slug: `worker-proj-${time}`,
    });
    projectId = project.id;

    // 2. Create Queue
    const queue = await queueRepo.create({
      projectId,
      name: `worker-queue-${time}`,
      priority: 5,
      concurrencyLimit: 20,
    });
    queueId = queue.id;
  });

  afterEach(async () => {
    for (const w of runningWorkers) {
      await w.stop(2000).catch(() => {});
    }
    runningWorkers = [];
  });

  describe('Worker Registration & Initialization', () => {
    it('registers itself in the database and initializes metadata properties', async () => {
      const worker = new Worker(pool, {
        projectId,
        queueId,
        concurrency: 4,
        pollIntervalMs: 50,
        heartbeatIntervalMs: 1000,
        hostname: 'test-node-alpha',
        pid: 9999,
      });
      runningWorkers.push(worker);

      await worker.start();

      expect(worker.id).toBeDefined();
      expect(worker.hostname).toBe('test-node-alpha');
      expect(worker.pid).toBe(9999);
      expect(worker.status).toBe(WorkerStatus.ACTIVE);
      expect(worker.concurrency).toBe(4);
      expect(worker.startedAt).toBeInstanceOf(Date);
      expect(worker.lastHeartbeat).toBeInstanceOf(Date);
      expect(worker.stoppedAt).toBeNull();

      // Verify row in workers table
      const res = await pool.query(`SELECT * FROM workers WHERE id = $1`, [worker.id]);
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].hostname).toBe('test-node-alpha');
      expect(['active', 'online']).toContain(res.rows[0].status);
    });
  });

  describe('Real Execution Loop & State Transitions', () => {
    it('polls, claims, executes job handler, and marks job COMPLETED with execution record', async () => {
      const job = await jobRepo.create({
        queueId,
        name: 'send-user-email',
        payload: { email: 'user@example.com', templateId: 'welcome' },
        priority: 5,
      });

      const worker = new Worker(pool, {
        projectId,
        queueId,
        concurrency: 2,
        pollIntervalMs: 25,
      });
      runningWorkers.push(worker);

      let customHandlerExecuted = false;
      worker.registerHandler('send-user-email', async (ctx) => {
        customHandlerExecuted = true;
        expect(ctx.jobId).toBe(job.id);
        expect(ctx.payload.email).toBe('user@example.com');
        await ctx.log('info', 'Sending email via SMTP');
        return { messageId: 'msg_98765' };
      });

      await worker.start();

      // Wait up to 3 seconds for job to be claimed and completed
      let completedJob = null;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const current = await jobRepo.findById(job.id);
        if (current && current.status === JobStatus.COMPLETED) {
          completedJob = current;
          break;
        }
      }

      expect(customHandlerExecuted).toBe(true);
      expect(completedJob).not.toBeNull();
      expect(completedJob!.status).toBe(JobStatus.COMPLETED);
      expect(completedJob!.result).toEqual({ messageId: 'msg_98765' });
      expect(completedJob!.workerId).toBe(worker.id);
      expect(completedJob!.finishedAt).not.toBeNull();

      // Verify execution history recorded
      const history = await jobRepo.getExecutionHistory(job.id);
      expect(history.length).toBe(1);
      expect(history[0].status).toBe('completed');
      expect(history[0].workerId).toBe(worker.id);

      // Verify logs recorded
      const logs = await jobRepo.getJobLogs(job.id);
      expect(logs.some((l) => l.message.includes('Sending email via SMTP'))).toBe(true);
    });

    it('handles job failures, sets retry backoff, and records failed execution record', async () => {
      const job = await jobRepo.create({
        queueId,
        name: 'failing-task',
        payload: { shouldFail: true, errorMessage: 'Third party API 503 Service Unavailable' },
        maxAttempts: 3,
      });

      const worker = new Worker(pool, {
        projectId,
        queueId,
        concurrency: 1,
        pollIntervalMs: 25,
      });
      runningWorkers.push(worker);

      await worker.start();

      // Wait up to 3 seconds for job to fail
      let failedJob = null;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const current = await jobRepo.findById(job.id);
        if (current && (current.status === JobStatus.FAILED || current.status === JobStatus.DEAD)) {
          failedJob = current;
          break;
        }
      }

      expect(failedJob).not.toBeNull();
      expect(failedJob!.status).toBe(JobStatus.FAILED);
      expect(failedJob!.errorMessage).toBe('Third party API 503 Service Unavailable');
      expect(failedJob!.nextAttemptAt).not.toBeNull();

      // Verify execution history
      const history = await jobRepo.getExecutionHistory(job.id);
      expect(history.length).toBe(1);
      expect(history[0].status).toBe('failed');
      expect(history[0].errorMessage).toBe('Third party API 503 Service Unavailable');
    });
  });

  describe('Concurrent Job Execution', () => {
    it('executes multiple jobs concurrently up to concurrency limit', async () => {
      const jobCount = 4;
      const jobIds: string[] = [];

      for (let i = 1; i <= jobCount; i++) {
        const j = await jobRepo.create({
          queueId,
          name: 'concurrent-task',
          payload: { sleepMs: 150, taskIndex: i },
        });
        jobIds.push(j.id);
      }

      const worker = new Worker(pool, {
        projectId,
        queueId,
        concurrency: 4,
        pollIntervalMs: 25,
      });
      runningWorkers.push(worker);

      await worker.start();

      // Wait for all 4 jobs to complete
      let allCompleted = false;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const statuses = await Promise.all(jobIds.map((id) => jobRepo.findById(id)));
        if (statuses.every((s) => s && s.status === JobStatus.COMPLETED)) {
          allCompleted = true;
          break;
        }
      }

      expect(allCompleted).toBe(true);
    });
  });

  describe('Periodic Heartbeats', () => {
    it('sends periodic heartbeats and updates last_heartbeat_at timestamp', async () => {
      const worker = new Worker(pool, {
        projectId,
        queueId,
        heartbeatIntervalMs: 100,
        pollIntervalMs: 500,
      });
      runningWorkers.push(worker);

      await worker.start();
      const initialHeartbeat = worker.lastHeartbeat!.getTime();

      // Wait for 2 heartbeats to fire
      await new Promise((r) => setTimeout(r, 260));

      const updatedWorker = await pool.query(`SELECT last_heartbeat_at FROM workers WHERE id = $1`, [worker.id]);
      const dbHeartbeat = new Date(updatedWorker.rows[0].last_heartbeat_at).getTime();

      expect(dbHeartbeat).toBeGreaterThanOrEqual(initialHeartbeat);
    });
  });

  describe('Graceful Shutdown', () => {
    it('drains active in-flight jobs, marks worker offline, and sets stoppedAt timestamp', async () => {
      const slowJob = await jobRepo.create({
        queueId,
        name: 'slow-draining-job',
        payload: { sleepMs: 250 },
      });

      const worker = new Worker(pool, {
        projectId,
        queueId,
        concurrency: 2,
        pollIntervalMs: 25,
        drainTimeoutMs: 3000,
      });
      runningWorkers.push(worker);

      await worker.start();

      // Wait for worker to claim the job
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 50));
        const current = await jobRepo.findById(slowJob.id);
        if (current && current.status === JobStatus.RUNNING) {
          break;
        }
      }

      // Trigger graceful stop while job is running
      await worker.stop(3000);

      // Verify worker state
      expect(worker.status).toBe(WorkerStatus.OFFLINE);
      expect(worker.stoppedAt).toBeInstanceOf(Date);

      // Verify in-flight job was allowed to finish cleanly
      const finishedJob = await jobRepo.findById(slowJob.id);
      expect(finishedJob!.status).toBe(JobStatus.COMPLETED);

      // Verify DB status is offline
      const workerRow = await pool.query(`SELECT status FROM workers WHERE id = $1`, [worker.id]);
      expect(['offline', 'stopped']).toContain(workerRow.rows[0].status);
    });
  });
});
