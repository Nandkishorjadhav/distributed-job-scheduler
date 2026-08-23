import { Router } from 'express';
import {
  getSystemMetrics,
  getQueueMetrics,
  getPrometheusMetrics,
} from '../controllers/metrics.controller';

export const metricsRouter = Router();

// GET /api/v1/metrics — Retrieve aggregate system or project metrics
metricsRouter.get('/', getSystemMetrics);

// GET /api/v1/metrics/prometheus — Prometheus text format metrics export
metricsRouter.get('/prometheus', getPrometheusMetrics);

// GET /api/v1/metrics/queues/:queueId — Queue-specific metrics
metricsRouter.get('/queues/:queueId', getQueueMetrics);
