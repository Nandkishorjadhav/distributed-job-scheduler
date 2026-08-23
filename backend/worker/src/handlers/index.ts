import { LogLevel } from '@job-scheduler/shared';

export interface JobExecutionContext {
  jobId: string;
  name: string;
  payload: Record<string, unknown>;
  attemptCount: number;
  maxAttempts: number;
  log: (level: LogLevel, message: string, metadata?: Record<string, unknown>) => Promise<void>;
}

export type JobHandler = (context: JobExecutionContext) => Promise<Record<string, unknown> | void>;

export class JobHandlerRegistry {
  private handlers = new Map<string, JobHandler>();
  private defaultHandler: JobHandler;

  constructor() {
    // Default handler simulates successful processing with structured payload inspection
    this.defaultHandler = async (ctx) => {
      await ctx.log(LogLevel.INFO, `Executing job '${ctx.name}' (attempt ${ctx.attemptCount}/${ctx.maxAttempts})`, {
        payloadKeys: Object.keys(ctx.payload),
      });

      // If payload explicitly requests failure for testing
      if (ctx.payload?.shouldFail === true) {
        const errorMsg = (ctx.payload?.errorMessage as string) || 'Simulated job failure';
        const errorCode = (ctx.payload?.errorCode as string) || 'ERR_SIMULATED_FAILURE';
        await ctx.log(LogLevel.ERROR, `Job failed: ${errorMsg}`, { code: errorCode });
        const err = new Error(errorMsg);
        (err as Error & { code?: string }).code = errorCode;
        throw err;
      }

      // If payload includes simulated execution delay
      if (typeof ctx.payload?.sleepMs === 'number' && ctx.payload.sleepMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, ctx.payload.sleepMs as number));
      }

      await ctx.log(LogLevel.INFO, `Job '${ctx.name}' completed successfully`);
      return {
        processed: true,
        jobName: ctx.name,
        timestamp: new Date().toISOString(),
      };
    };
  }

  /**
   * Register a custom handler for a specific job name.
   */
  register(jobName: string, handler: JobHandler): void {
    this.handlers.set(jobName, handler);
  }

  /**
   * Get handler for a job name, or return default handler if none registered.
   */
  getHandler(jobName: string): JobHandler {
    return this.handlers.get(jobName) ?? this.defaultHandler;
  }
}
