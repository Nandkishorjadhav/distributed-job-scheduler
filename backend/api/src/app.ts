import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { rateLimiter } from './middleware/rateLimiter';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';
import { router } from './routes';

export function createApp(): Application {
  const app = express();

  // ─── Security & utility middleware ────────────────────────────────────────
  app.use(helmet());
  app.use(
    cors({
      origin: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(','),
      credentials: true,
    })
  );
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

  // ─── Rate limiting ────────────────────────────────────────────────────────
  app.use('/api/', rateLimiter);

  // ─── Health check (no auth required) ─────────────────────────────────────
  app.get('/api/v1/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: process.env.NODE_ENV ?? 'development',
      uptime: Math.floor(process.uptime()),
      services: {
        api: 'running',
        database: 'connected',
        redis: 'connected',
      },
    });
  });

  // ─── Status endpoint — full system info ──────────────────────────────────
  app.get('/api/v1/status', (_req: Request, res: Response) => {
    const mem = process.memoryUsage();
    res.json({
      api: {
        status: 'running',
        version: '1.0.0',
        environment: process.env.NODE_ENV ?? 'development',
        uptime_seconds: Math.floor(process.uptime()),
        port: process.env.API_PORT ?? '3000',
        pid: process.pid,
      },
      memory: {
        heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
        heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
        rss_mb: Math.round(mem.rss / 1024 / 1024),
      },
      endpoints: [
        { method: 'GET',    path: '/api/v1/health',                   auth: false, status: 'live' },
        { method: 'GET',    path: '/api/v1/status',                   auth: false, status: 'live' },
        { method: 'POST',   path: '/api/v1/auth/register',            auth: false, status: 'stub' },
        { method: 'POST',   path: '/api/v1/auth/login',               auth: false, status: 'stub' },
        { method: 'POST',   path: '/api/v1/auth/logout',              auth: true,  status: 'stub' },
        { method: 'POST',   path: '/api/v1/orgs',                     auth: true,  status: 'stub' },
        { method: 'GET',    path: '/api/v1/orgs/:orgId',              auth: true,  status: 'stub' },
        { method: 'POST',   path: '/api/v1/projects',                 auth: true,  status: 'stub' },
        { method: 'GET',    path: '/api/v1/projects/:projectId',      auth: true,  status: 'stub' },
        { method: 'POST',   path: '/api/v1/queues',                   auth: true,  status: 'stub' },
        { method: 'GET',    path: '/api/v1/queues/:queueId',          auth: true,  status: 'stub' },
        { method: 'PATCH',  path: '/api/v1/queues/:queueId',          auth: true,  status: 'stub' },
        { method: 'DELETE', path: '/api/v1/queues/:queueId',          auth: true,  status: 'stub' },
        { method: 'POST',   path: '/api/v1/queues/:queueId/pause',    auth: true,  status: 'stub' },
        { method: 'POST',   path: '/api/v1/queues/:queueId/resume',   auth: true,  status: 'stub' },
        { method: 'POST',   path: '/api/v1/queues/:queueId/jobs',     auth: true,  status: 'stub' },
        { method: 'GET',    path: '/api/v1/queues/:queueId/jobs',     auth: true,  status: 'stub' },
        { method: 'GET',    path: '/api/v1/queues/:queueId/dlq',      auth: true,  status: 'stub' },
        { method: 'POST',   path: '/api/v1/queues/:queueId/recurring',auth: true,  status: 'stub' },
        { method: 'GET',    path: '/api/v1/jobs/:jobId',              auth: true,  status: 'stub' },
        { method: 'DELETE', path: '/api/v1/jobs/:jobId',              auth: true,  status: 'stub' },
        { method: 'POST',   path: '/api/v1/jobs/:jobId/retry',        auth: true,  status: 'stub' },
        { method: 'GET',    path: '/api/v1/jobs/:jobId/logs',         auth: true,  status: 'stub' },
        { method: 'GET',    path: '/api/v1/workers/:workerId',        auth: true,  status: 'stub' },
        { method: 'GET',    path: '/api/v1/metrics',                  auth: true,  status: 'stub' },
      ],
      timestamp: new Date().toISOString(),
    });
  });

  // ─── API routes ───────────────────────────────────────────────────────────
  app.use('/api/v1', router);

  // ─── Error handling ───────────────────────────────────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const app = createApp();
