import winston from 'winston';

export interface StructuredLogContext {
  requestId?: string;
  jobId?: string;
  executionId?: string;
  workerId?: string;
  queueId?: string;
  projectId?: string;
  attemptNumber?: number;
  durationMs?: number;
  retryDelayMs?: number;
  errorCode?: string;
  [key: string]: unknown;
}

const { combine, timestamp, errors, json, colorize, printf } = winston.format;

const isProduction = process.env.NODE_ENV === 'production';

// Human-readable structured formatter for development
const devFormat = printf(({ level, message, timestamp, ...meta }) => {
  const metaEntries = Object.entries(meta).filter(
    ([k]) => !['service', 'stack'].includes(k)
  );
  const metaStr =
    metaEntries.length > 0
      ? ` ${JSON.stringify(Object.fromEntries(metaEntries))}`
      : '';
  return `${timestamp} [${level}]: ${message}${metaStr}`;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
  defaultMeta: { service: process.env.SERVICE_NAME ?? 'job-scheduler' },
  format: isProduction
    ? combine(timestamp(), errors({ stack: true }), json())
    : combine(colorize(), timestamp({ format: 'HH:mm:ss' }), errors({ stack: true }), devFormat),
  transports: [new winston.transports.Console()],
});
