import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getPool,
  JobRepository,
  QueueRepository,
  ProjectRepository,
  OrgRepository,
  UserRepository,
  JobClaimService,
} from '@job-scheduler/backend-shared';
import { Scheduler } from '@job-scheduler/scheduler';
import { JobStatus, JobType } from '@job-scheduler/shared';

describe('Scheduler Service Tests', () => {
  const pool = getPool();
  const userRepo = new UserRepository(pool);
  const orgRepo = new OrgRepository(pool);
  const projRepo = new ProjectRepository(pool);
  const queueRepo = new QueueRepository(pool);
  const jobRepo = new JobRepository(pool);
  const claimService = new JobClaimService(pool);

  const time = Date.now();
  let projectId: string;
  let queueId: string;
  let scheduler: Scheduler;

  beforeAll(async () => {
    // 1. Setup tenant hierarchy
    const user = await userRepo.create({
      email: `sched_tester_${time}@example.com`,
      passwordHash: 'hashedpassword',
      name: 'Scheduler Tester',
    });

    const org = await orgRepo.create(
      {
        name: 'Scheduler Org',
        slug: `sched-org-${time}`,
      },
      user.id
    );

    const project = await projRepo.create({
      organizationId: org.id,
      name: 'Scheduler Project',
      slug: `sched-proj-${time}`,
    });
    projectId = project.id;

    const queue = await queueRepo.create({
      projectId,
      name: `sched-queue-${time}`,
    });
    queueId = queue.id;

    scheduler = new Scheduler(pool, {
      projectId,
      pollIntervalMs: 200,
      cronIntervalMs: 200,
      batchSize: 50,
    });
  });

  afterAll(async () => {
    if (scheduler) {
      await scheduler.stop();
    }
  });

  describe('1. Delayed Jobs Promotion', () => {
    it('promotes delayed jobs from SCHEDULED to PENDING (QUEUED) when execution time arrives', async () => {
      // Create a delayed job scheduled in the past
      const pastScheduledAt = new Date(Date.now() - 500);
      const job = await jobRepo.create({
        queueId,
        name: 'test-delayed-job',
        type: JobType.DELAYED,
        scheduledAt: pastScheduledAt,
        payload: { orderId: 'ORD-5501' },
      });

      expect(job.status).toBe(JobStatus.SCHEDULED);

      // Execute promotion
      const promoted = await scheduler.promoteDueJobs();
      const promotedEntry = promoted.find((p) => p.id === job.id);

      expect(promotedEntry).toBeDefined();
      expect(promotedEntry?.name).toBe('test-delayed-job');

      // Verify DB status is now 'pending' (QUEUED)
      const updatedJob = await jobRepo.findById(job.id);
      expect(updatedJob).not.toBeNull();
      expect(updatedJob!.status).toBe(JobStatus.PENDING);
      expect(updatedJob!.enqueuedAt).not.toBeNull();

      // Verify audit log
      const logs = await jobRepo.getJobLogs(job.id);
      expect(logs.some((l) => l.message.includes('promoted from scheduled to queued'))).toBe(true);
    });

    it('does NOT promote future delayed jobs whose execution time has not arrived', async () => {
      // Create a delayed job scheduled 10 minutes in the future
      const futureScheduledAt = new Date(Date.now() + 600000);
      const futureJob = await jobRepo.create({
        queueId,
        name: 'future-delayed-job',
        type: JobType.DELAYED,
        scheduledAt: futureScheduledAt,
      });

      const promoted = await scheduler.promoteDueJobs();
      const promotedEntry = promoted.find((p) => p.id === futureJob.id);

      expect(promotedEntry).toBeUndefined();

      const dbJob = await jobRepo.findById(futureJob.id);
      expect(dbJob!.status).toBe(JobStatus.SCHEDULED);
    });
  });

  describe('2. One-off Scheduled Jobs Promotion', () => {
    it('identifies and promotes due one-off scheduled jobs', async () => {
      const dueTime = new Date(Date.now() - 1000);
      const scheduledJob = await jobRepo.create({
        queueId,
        name: 'oneoff-scheduled-job',
        type: JobType.SCHEDULED,
        scheduledAt: dueTime,
        payload: { report: 'monthly_summary' },
      });

      const promoted = await scheduler.promoteDueJobs();
      const match = promoted.find((p) => p.id === scheduledJob.id);

      expect(match).toBeDefined();

      const refreshed = await jobRepo.findById(scheduledJob.id);
      expect(refreshed!.status).toBe(JobStatus.PENDING);
    });
  });

  describe('3. Recurring Cron Jobs Dispatching', () => {
    let scheduledJobId: string;

    beforeAll(async () => {
      // Create a recurring cron job definition in scheduled_jobs
      const cronDef = await jobRepo.createScheduledJob({
        queueId,
        name: 'nightly-billing-cron',
        cronExpression: '*/5 * * * *',
        timezone: 'UTC',
        payloadTemplate: { task: 'generate_invoices' },
        priority: 7,
        maxAttempts: 4,
      });
      scheduledJobId = cronDef.id;

      // Force next_run_at to past so it is immediately due
      await pool.query(
        `UPDATE scheduled_jobs SET next_run_at = NOW() - INTERVAL '1 minute' WHERE id = $1`,
        [scheduledJobId]
      );
    });

    it('dispatches due recurring cron jobs by creating child job instances in PENDING state', async () => {
      const dispatched = await scheduler.dispatchDueRecurringJobs();
      const match = dispatched.find((d) => d.scheduledJobId === scheduledJobId);

      expect(match).toBeDefined();
      expect(match!.name).toBe('nightly-billing-cron');
      expect(match!.nextRunAt).toBeInstanceOf(Date);
      expect(match!.nextRunAt.getTime()).toBeGreaterThan(Date.now());

      // Verify child job instance created in jobs table
      const childJob = await jobRepo.findById(match!.jobId);
      expect(childJob).not.toBeNull();
      expect(childJob!.status).toBe(JobStatus.PENDING);
      expect(childJob!.type).toBe(JobType.RECURRING);
      expect(childJob!.priority).toBe(7);
      expect(childJob!.maxAttempts).toBe(4);
      expect(childJob!.payload).toEqual({ task: 'generate_invoices' });

      // Verify metadata updated on scheduled_jobs table
      const schedDef = await pool.query(`SELECT * FROM scheduled_jobs WHERE id = $1`, [scheduledJobId]);
      const schedRow = schedDef.rows[0];
      expect(parseInt(schedRow.run_count, 10)).toBe(1);
      expect(schedRow.last_job_id).toBe(childJob!.id);
      expect(schedRow.last_fired_at).not.toBeNull();
    });

    it('prevents overlapping runs when skip_if_running is enabled and previous run is active', async () => {
      // Create scheduled job with skip_if_running = true
      const noOverlapCron = await jobRepo.createScheduledJob({
        queueId,
        name: 'long-running-data-sync',
        cronExpression: '*/1 * * * *',
        skipIfRunning: true,
      });

      // 1. First run: fire job
      await pool.query(
        `UPDATE scheduled_jobs SET next_run_at = NOW() - INTERVAL '1 second' WHERE id = $1`,
        [noOverlapCron.id]
      );
      const firstDispatch = await scheduler.dispatchDueRecurringJobs();
      const firstMatch = firstDispatch.find((d) => d.scheduledJobId === noOverlapCron.id);
      expect(firstMatch).toBeDefined();

      // Simulate worker claiming and setting job to 'running'
      await pool.query(`UPDATE jobs SET status = 'running' WHERE id = $1`, [firstMatch!.jobId]);

      // 2. Next tick arrives while job is still 'running'
      await pool.query(
        `UPDATE scheduled_jobs SET next_run_at = NOW() - INTERVAL '1 second' WHERE id = $1`,
        [noOverlapCron.id]
      );
      const secondDispatch = await scheduler.dispatchDueRecurringJobs();
      const secondMatch = secondDispatch.find((d) => d.scheduledJobId === noOverlapCron.id);

      // Should be skipped due to skip_if_running
      expect(secondMatch).toBeUndefined();

      // scheduled_jobs next_run_at should still advance into the future
      const res = await pool.query(`SELECT * FROM scheduled_jobs WHERE id = $1`, [noOverlapCron.id]);
      expect(new Date(res.rows[0].next_run_at).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('4. Duplicate Scheduler Instances & High-Concurrency Safety', () => {
    it('ensures multiple concurrent scheduler instances promote delayed jobs with zero duplicates', async () => {
      // Create 15 due delayed jobs
      const createdJobIds: string[] = [];
      for (let i = 0; i < 15; i++) {
        const j = await jobRepo.create({
          queueId,
          name: `concurrent-delayed-job-${i}`,
          type: JobType.DELAYED,
          scheduledAt: new Date(Date.now() - 2000),
        });
        createdJobIds.push(j.id);
      }

      // Create 3 separate scheduler instances
      const schedulerA = new Scheduler(pool, { projectId, batchSize: 20 });
      const schedulerB = new Scheduler(pool, { projectId, batchSize: 20 });
      const schedulerC = new Scheduler(pool, { projectId, batchSize: 20 });

      // Run all 3 schedulers simultaneously on the exact same pool
      const [resA, resB, resC] = await Promise.all([
        schedulerA.promoteDueJobs(),
        schedulerB.promoteDueJobs(),
        schedulerC.promoteDueJobs(),
      ]);

      const allPromotedIds = [...resA, ...resB, ...resC].map((r) => r.id);
      const relevantPromoted = allPromotedIds.filter((id) => createdJobIds.includes(id));

      // 1. All 15 jobs must be promoted
      expect(relevantPromoted.length).toBe(15);

      // 2. Zero duplicates across all 3 scheduler instances
      const uniquePromotedIds = new Set(relevantPromoted);
      expect(uniquePromotedIds.size).toBe(15);

      // 3. Verify all 15 in database are pending
      for (const id of createdJobIds) {
        const dbJob = await jobRepo.findById(id);
        expect(dbJob!.status).toBe(JobStatus.PENDING);
      }
    });

    it('ensures multiple concurrent scheduler instances dispatch cron templates without duplicate child jobs', async () => {
      // Create 5 cron definitions due in the past
      const schedIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        const cron = await jobRepo.createScheduledJob({
          queueId,
          name: `concurrent-cron-${time}-${i}`,
          cronExpression: '*/10 * * * *',
        });
        schedIds.push(cron.id);
        await pool.query(
          `UPDATE scheduled_jobs SET next_run_at = NOW() - INTERVAL '5 minutes' WHERE id = $1`,
          [cron.id]
        );
      }

      const schedulerA = new Scheduler(pool, { projectId, batchSize: 20 });
      const schedulerB = new Scheduler(pool, { projectId, batchSize: 20 });

      // Run both schedulers simultaneously
      const [resA, resB] = await Promise.all([
        schedulerA.dispatchDueRecurringJobs(),
        schedulerB.dispatchDueRecurringJobs(),
      ]);

      const combined = [...resA, ...resB].filter((r) => schedIds.includes(r.scheduledJobId));

      // Each of the 5 templates must be dispatched exactly once
      expect(combined.length).toBe(5);
      const uniqueTemplates = new Set(combined.map((c) => c.scheduledJobId));
      expect(uniqueTemplates.size).toBe(5);
    });
  });

  describe('5. Missed Schedule Handling', () => {
    it('handles severely missed schedules by firing once and advancing next_run_at to the future', async () => {
      // Simulate a cron that was supposed to run 2 hours ago during server maintenance
      const missedCron = await jobRepo.createScheduledJob({
        queueId,
        name: 'missed-maintenance-cron',
        cronExpression: '*/15 * * * *',
      });

      const twoHoursAgo = new Date(Date.now() - 7200000);
      await pool.query(`UPDATE scheduled_jobs SET next_run_at = $1 WHERE id = $2`, [
        twoHoursAgo,
        missedCron.id,
      ]);

      // Dispatch
      const dispatched = await scheduler.dispatchDueRecurringJobs();
      const match = dispatched.find((d) => d.scheduledJobId === missedCron.id);

      expect(match).toBeDefined();

      // Verify next_run_at was advanced into the future rather than falling 2 hours behind
      const res = await pool.query(`SELECT * FROM scheduled_jobs WHERE id = $1`, [missedCron.id]);
      const nextRun = new Date(res.rows[0].next_run_at);
      expect(nextRun.getTime()).toBeGreaterThan(Date.now());

      // Second immediate tick must NOT fire again (no cascading backfill storm)
      const secondTick = await scheduler.dispatchDueRecurringJobs();
      const secondMatch = secondTick.find((d) => d.scheduledJobId === missedCron.id);
      expect(secondMatch).toBeUndefined();
    });
  });
});
