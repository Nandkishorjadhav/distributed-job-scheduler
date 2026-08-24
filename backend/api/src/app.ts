import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import fs from 'fs';
import path from 'path';
import { getPool, getRedisClient } from '@job-scheduler/backend-shared';
import { requestIdMiddleware } from './middleware/requestId';
import { rateLimiter } from './middleware/rateLimiter';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';
import { router } from './routes';

export function createApp(): Application {
  const app = express();

  // ─── Request correlation ID (must be first) ──────────────────────────────
  app.use(requestIdMiddleware);

  // ─── Security & utility middleware ────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: false, // Allows CDN-based API docs
    })
  );
  app.use(
    cors({
      origin: (
        process.env.CORS_ORIGINS ??
        process.env.CORS_ORIGIN ??
        'http://localhost:5173'
      ).split(','),
      credentials: true,
      exposedHeaders: ['X-Request-Id'],
    })
  );
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

  // ─── Rate limiting ────────────────────────────────────────────────────────
  app.use('/api/', rateLimiter);

  // ─── OpenAPI Spec Endpoint ────────────────────────────────────────────────
  let openApiSpec: Record<string, unknown> | null = null;
  const specPath = path.resolve(__dirname, 'openapi.json');
  if (fs.existsSync(specPath)) {
    try {
      openApiSpec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    } catch {
      openApiSpec = null;
    }
  }

  app.get('/api/v1/openapi.json', (_req: Request, res: Response) => {
    if (openApiSpec) {
      res.json(openApiSpec);
    } else {
      res.status(404).json({ success: false, error: 'OpenAPI specification not found' });
    }
  });

  // ─── Interactive API Documentation UI ────────────────────────────────────
  app.get('/api/v1/docs', (_req: Request, res: Response) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Distributed Job Scheduler — API Reference</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
  <style>
    body { margin: 0; background: #0f172a; }
    .swagger-ui .topbar { display: none; }
    .swagger-ui { color: #f8fafc; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/api/v1/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout"
      });
    };
  </script>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });

  // ─── Health check (no auth required) ─────────────────────────────────────
  app.get('/api/v1/health', async (req: Request, res: Response) => {
    let dbStatus = 'disconnected';
    let redisStatus = 'disconnected';

    try {
      await Promise.race([
        getPool().query('SELECT 1'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('DB timeout')), 2000)),
      ]);
      dbStatus = 'connected';
    } catch {
      dbStatus = 'disconnected';
    }

    try {
      await Promise.race([
        getRedisClient().ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Redis timeout')), 1000)),
      ]);
      redisStatus = 'connected';
    } catch {
      redisStatus = 'disconnected';
    }

    const isHealthy = dbStatus === 'connected';
    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: process.env.NODE_ENV ?? 'development',
      uptime: Math.floor(process.uptime()),
      services: {
        api: 'running',
        database: dbStatus,
        redis: redisStatus,
      },
      requestId: req.id,
    });
  });

  // ─── Status endpoint — full system info ──────────────────────────────────
  app.get('/api/v1/status', (req: Request, res: Response) => {
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
      docs_url: '/api/v1/docs',
      openapi_spec: '/api/v1/openapi.json',
      endpoints: [
        { method: 'POST', path: '/api/v1/auth/register', auth: false, status: 'live' },
        { method: 'POST', path: '/api/v1/auth/login', auth: false, status: 'live' },
        { method: 'GET', path: '/api/v1/auth/me', auth: true, status: 'live' },
        { method: 'POST', path: '/api/v1/auth/logout', auth: true, status: 'live' },
        { method: 'GET', path: '/api/v1/orgs', auth: true, status: 'live' },
        { method: 'POST', path: '/api/v1/orgs', auth: true, status: 'live' },
        { method: 'GET', path: '/api/v1/projects', auth: true, status: 'live' },
        { method: 'POST', path: '/api/v1/projects', auth: true, status: 'live' },
        { method: 'GET', path: '/api/v1/queues', auth: true, status: 'live' },
        { method: 'POST', path: '/api/v1/queues', auth: true, status: 'live' },
        { method: 'POST', path: '/api/v1/queues/:id/pause', auth: true, status: 'live' },
        { method: 'POST', path: '/api/v1/queues/:id/resume', auth: true, status: 'live' },
        { method: 'GET', path: '/api/v1/queues/:id/stats', auth: true, status: 'live' },
        { method: 'GET', path: '/api/v1/jobs', auth: true, status: 'live' },
        { method: 'POST', path: '/api/v1/queues/:id/jobs', auth: true, status: 'live' },
        { method: 'POST', path: '/api/v1/queues/:id/batch', auth: true, status: 'live' },
        { method: 'GET', path: '/api/v1/jobs/:id', auth: true, status: 'live' },
        { method: 'POST', path: '/api/v1/jobs/:id/cancel', auth: true, status: 'live' },
        { method: 'POST', path: '/api/v1/jobs/:id/retry', auth: true, status: 'live' },
        { method: 'GET', path: '/api/v1/jobs/:id/executions', auth: true, status: 'live' },
        { method: 'GET', path: '/api/v1/jobs/:id/logs', auth: true, status: 'live' },
        { method: 'GET', path: '/api/v1/jobs/:id/history', auth: true, status: 'live' },
        { method: 'GET', path: '/api/v1/workers', auth: true, status: 'live' },
        { method: 'POST', path: '/api/v1/workers/register', auth: true, status: 'live' },
        { method: 'POST', path: '/api/v1/workers/:id/heartbeat', auth: true, status: 'live' },
        { method: 'POST', path: '/api/v1/workers/:id/stop', auth: true, status: 'live' },
        { method: 'POST', path: '/api/v1/workers/stale/scan', auth: true, status: 'live' },
        { method: 'GET', path: '/api/v1/dlq', auth: true, status: 'live' },
        { method: 'GET', path: '/api/v1/dlq/stats', auth: true, status: 'live' },
        { method: 'GET', path: '/api/v1/dlq/:id', auth: true, status: 'live' },
        { method: 'POST', path: '/api/v1/dlq/:id/retry', auth: true, status: 'live' },
        { method: 'POST', path: '/api/v1/dlq/:id/archive', auth: true, status: 'live' },
        { method: 'DELETE', path: '/api/v1/dlq/:id', auth: true, status: 'live' },
        { method: 'GET', path: '/api/v1/metrics', auth: true, status: 'live' },
        { method: 'GET', path: '/api/v1/metrics/prometheus', auth: true, status: 'live' },
        { method: 'GET', path: '/api/v1/health', auth: false, status: 'live' },
        { method: 'GET', path: '/api/v1/status', auth: false, status: 'live' },
        { method: 'GET', path: '/api/v1/openapi.json', auth: false, status: 'live' },
        { method: 'GET', path: '/api/v1/docs', auth: false, status: 'live' },
      ],
      requestId: req.id,
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
