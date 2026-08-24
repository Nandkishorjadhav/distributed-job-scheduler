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

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'password_hash',
  'token',
  'secret',
  'authorization',
  'apikey',
  'api_key',
  'keyhash',
  'key_hash',
  'jwt',
  'cookie',
]);

function sanitizeInPlace(obj: any, depth = 0): any {
  if (depth > 5 || obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === 'object' && obj[i] !== null) {
        sanitizeInPlace(obj[i], depth + 1);
      }
    }
    return obj;
  }
  for (const key of Object.keys(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      obj[key] = '[REDACTED]';
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      sanitizeInPlace(obj[key], depth + 1);
    }
  }
  return obj;
}

const sanitizeFormat = winston.format((info) => {
  sanitizeInPlace(info);
  return info;
});

// Human-readable structured formatter for development
const devFormat = printf(({ level, message, timestamp, ...meta }) => {
  const metaEntries = Object.entries(meta).filter(([k]) => !['service', 'stack'].includes(k));
  const metaStr =
    metaEntries.length > 0 ? ` ${JSON.stringify(Object.fromEntries(metaEntries))}` : '';
  return `${timestamp} [${level}]: ${message}${metaStr}`;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
  defaultMeta: { service: process.env.SERVICE_NAME ?? 'job-scheduler' },
  format: isProduction
    ? combine(sanitizeFormat(), timestamp(), errors({ stack: true }), json())
    : combine(
        sanitizeFormat(),
        colorize(),
        timestamp({ format: 'HH:mm:ss' }),
        errors({ stack: true }),
        devFormat
      ),
  transports: [new winston.transports.Console()],
});
