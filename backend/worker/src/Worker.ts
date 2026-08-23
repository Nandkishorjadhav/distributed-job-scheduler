import os from 'os';
import { Pool } from 'pg';
import { WorkerStatus, LogLevel } from '@job-scheduler/shared';
import {
  WorkerRepository,
  JobClaimService,
  JobResponse,
  logger,
} from '@job-scheduler/backend-shared';
import { JobHandlerRegistry, JobHandler } from './handlers';

export interface WorkerOptions {
  projectId: string;
  queueId?: string;
  concurrency?: number;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  drainTimeoutMs?: number;
  hostname?: string;
  pid?: number;
}

export class Worker {
  public id!: string;
  public readonly projectId: string;
  public readonly queueId?: string;
  public readonly hostname: string;
  public readonly pid: number;
  public status: WorkerStatus = WorkerStatus.OFFLINE;
  public readonly concurrency: number;
  public readonly pollIntervalMs: number;
  public readonly heartbeatIntervalMs: number;
  public readonly drainTimeoutMs: number;

  public startedAt: Date | null = null;
  public stoppedAt: Date | null = null;
  public lastHeartbeat: Date | null = null;

  private activeJobs = new Set<Promise<void>>();
  private isRunning = false;
  private isDraining = false;
  private pollTimeout: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  private workerRepo: WorkerRepository;
  private claimService: JobClaimService;
  public readonly handlerRegistry: JobHandlerRegistry;

  constructor(private readonly pool: Pool, options: WorkerOptions) {
    this.projectId = options.projectId;
    this.queueId = options.queueId;
    this.concurrency = options.concurrency ?? 5;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 10000;
    this.drainTimeoutMs = options.drainTimeoutMs ?? 15000;
    this.hostname = options.hostname ?? os.hostname();
    this.pid = options.pid ?? process.pid;

    this.workerRepo = new WorkerRepository(this.pool);
    this.claimService = new JobClaimService(this.pool);
    this.handlerRegistry = new JobHandlerRegistry();
  }

  /**
   * Register a custom handler for a job name.
   */
  public registerHandler(jobName: string, handler: JobHandler): void {
    this.handlerRegistry.register(jobName, handler);
  }

  /**
   * Current number of in-flight active jobs on this worker.
   */
  public get activeJobCount(): number {
    return this.activeJobs.size;
  }

  /**
   * Start the worker service:
   * 1. Register self in DB
   * 2. Start heartbeat timer
   * 3. Start polling loop
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    // 1. Register in workers table
    const registered = await this.workerRepo.register({
      projectId: this.projectId,
      hostname: this.hostname,
      pid: this.pid,
      maxConcurrency: this.concurrency,
    });

    this.id = registered.id;
    this.status = WorkerStatus.ACTIVE;
    this.startedAt = new Date();
    this.lastHeartbeat = this.startedAt;
    this.isRunning = true;
    this.isDraining = false;

    logger.info(`Worker [${this.id}] started on ${this.hostname} (PID: ${this.pid}, Concurrency: ${this.concurrency})`);

    // 2. Start heartbeat loop
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat().catch((err) => {
        logger.error(`Worker [${this.id}] heartbeat failed`, { error: err });
      });
    }, this.heartbeatIntervalMs);

    // 3. Start poll loop
    this.scheduleNextPoll(0);
  }

  /**
   * Send heartbeat to DB to refresh liveness.
   */
  async sendHeartbeat(): Promise<void> {
    if (!this.id) return;
    const res = await this.workerRepo.heartbeat(this.id, this.activeJobCount);
    if (res) {
      this.lastHeartbeat = new Date();
    }
  }

  /**
   * Schedule the next iteration of the polling loop.
   */
  private scheduleNextPoll(delayMs: number = this.pollIntervalMs): void {
    if (!this.isRunning || this.isDraining) return;

    this.pollTimeout = setTimeout(async () => {
      await this.poll();
    }, delayMs);
  }

  /**
   * Polling cycle:
   * 1. Check available slots
   * 2. Atomically claim eligible jobs
   * 3. Dispatch jobs concurrently
   */
  public async poll(): Promise<number> {
    if (!this.isRunning || this.isDraining) return 0;

    const availableSlots = this.concurrency - this.activeJobCount;
    if (availableSlots <= 0) {
      // Worker is fully occupied; poll again after regular interval
      this.scheduleNextPoll();
      return 0;
    }

    try {
      const claimedJobs = await this.claimService.claimJobs(
        this.id,
        availableSlots,
        this.queueId
      );

      if (claimedJobs.length > 0) {
        for (const job of claimedJobs) {
          const jobPromise = this.executeJob(job).finally(() => {
            this.activeJobs.delete(jobPromise);
          });
          this.activeJobs.add(jobPromise);
        }

        // If we claimed jobs and still have capacity, schedule next poll immediately
        const remainingSlots = this.concurrency - this.activeJobCount;
        this.scheduleNextPoll(remainingSlots > 0 ? 50 : this.pollIntervalMs);
        return claimedJobs.length;
      }
    } catch (err) {
      logger.error(`Worker [${this.id}] polling error`, { error: err });
    }

    this.scheduleNextPoll();
    return 0;
  }

  /**
   * Execute a claimed job using the registered handler.
   */
  private async executeJob(job: JobResponse): Promise<void> {
    logger.info(`Worker [${this.id}] executing job '${job.name}' (ID: ${job.id}, Attempt: ${job.attemptCount})`);

    const handler = this.handlerRegistry.getHandler(job.name);

    const logFn = async (level: LogLevel, message: string, metadata?: Record<string, unknown>) => {
      try {
        await this.pool.query(
          `INSERT INTO job_logs (job_id, level, message, metadata) VALUES ($1, $2, $3, $4)`,
          [job.id, level, message, metadata ? JSON.stringify(metadata) : null]
        );
      } catch (err) {
        logger.error(`Failed to record job log for ${job.id}`, { error: err });
      }
    };

    try {
      // Execute handler with timeout support if specified
      let handlerPromise = handler({
        jobId: job.id,
        name: job.name,
        payload: job.payload ?? {},
        attemptCount: job.attemptCount,
        maxAttempts: job.maxAttempts,
        log: logFn,
      });

      let timeoutHandle: NodeJS.Timeout | null = null;
      const timeoutMs = job.timeoutMs;
      if (typeof timeoutMs === 'number' && timeoutMs > 0) {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new Error(`Job timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        });
        handlerPromise = Promise.race([handlerPromise, timeoutPromise]);
      }

      const result = await handlerPromise;
      if (timeoutHandle) clearTimeout(timeoutHandle);

      // Mark complete
      await this.claimService.completeJob(
        job.id,
        this.id,
        (result as Record<string, unknown>) ?? { success: true }
      );
      logger.info(`Worker [${this.id}] successfully completed job '${job.name}' (ID: ${job.id})`);
    } catch (err: unknown) {
      const errorMsg = (err as Error).message || 'Job execution failed';
      const errorCode = (err as Error & { code?: string }).code || 'JOB_EXECUTION_ERROR';

      logger.warn(`Worker [${this.id}] job '${job.name}' (ID: ${job.id}) failed: ${errorMsg}`);

      // Calculate retry backoff (e.g. exponential or linear)
      const retryDelayMs = Math.min(1000 * Math.pow(2, job.attemptCount - 1), 60000);

      await this.claimService.failJob(job.id, this.id, {
        message: errorMsg,
        code: errorCode,
        retryDelayMs,
      });
    }
  }

  /**
   * Graceful shutdown:
   * 1. Set status to 'draining'
   * 2. Stop accepting new jobs (cancel poll timer)
   * 3. Await in-flight active jobs up to drain timeout
   * 4. Stop heartbeat timer
   * 5. Set status to 'offline' and deregister in DB
   */
  async stop(drainTimeoutMs: number = this.drainTimeoutMs): Promise<void> {
    if (!this.isRunning && !this.isDraining) return;

    this.isDraining = true;
    this.status = WorkerStatus.DRAINING;

    logger.info(`Worker [${this.id}] draining (in-flight jobs: ${this.activeJobCount})...`);

    // 1. Cancel poll timeout
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }

    // 2. Update status in DB to 'draining'
    if (this.id) {
      await this.workerRepo.updateStatus(this.id, WorkerStatus.DRAINING).catch(() => {});
    }

    // 3. Wait for in-flight jobs to finish
    if (this.activeJobs.size > 0) {
      const drainPromise = Promise.all(Array.from(this.activeJobs));
      let timeoutHandle: NodeJS.Timeout | null = null;
      const timeoutPromise = new Promise((resolve) => {
        timeoutHandle = setTimeout(resolve, drainTimeoutMs);
      });

      await Promise.race([drainPromise, timeoutPromise]);
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }

    // 4. Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // 5. Deregister in DB and update final state
    if (this.id) {
      await this.workerRepo.deregister(this.id).catch(() => {});
    }

    this.isRunning = false;
    this.isDraining = false;
    this.status = WorkerStatus.OFFLINE;
    this.stoppedAt = new Date();

    logger.info(`Worker [${this.id}] stopped cleanly`);
  }
}
