import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../backend/api/src/app';

const app = createApp();

describe('REST API Standards, Request IDs & OpenAPI Specification Tests', () => {
  describe('1. Request Correlation IDs (X-Request-Id)', () => {
    it('generates a unique UUID X-Request-Id header when not provided by client', async () => {
      const response = await request(app).get('/api/v1/health');

      expect(response.status).toBe(200);
      expect(response.headers['x-request-id']).toBeDefined();
      expect(response.headers['x-request-id'].length).toBeGreaterThan(10);
      expect(response.body.requestId).toBe(response.headers['x-request-id']);
    });

    it('preserves and echoes client-supplied X-Request-Id header', async () => {
      const customTraceId = 'client-trace-id-abc-123';
      const response = await request(app).get('/api/v1/health').set('X-Request-Id', customTraceId);

      expect(response.status).toBe(200);
      expect(response.headers['x-request-id']).toBe(customTraceId);
      expect(response.body.requestId).toBe(customTraceId);
    });

    it('includes requestId in error responses for easy tracing', async () => {
      const customTraceId = 'trace-error-999';
      const response = await request(app)
        .post('/api/v1/auth/register')
        .set('X-Request-Id', customTraceId)
        .send({
          email: 'invalid-email-format',
          password: 'short',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.requestId).toBe(customTraceId);
      expect(Array.isArray(response.body.details)).toBe(true);
    });
  });

  describe('2. OpenAPI Specification & Interactive Docs', () => {
    it('serves OpenAPI 3.0.3 JSON specification at /api/v1/openapi.json', async () => {
      const response = await request(app).get('/api/v1/openapi.json');

      expect(response.status).toBe(200);
      expect(response.body.openapi).toBe('3.0.3');
      expect(response.body.info.title).toBe('Distributed Job Scheduler REST API');
      expect(response.body.paths).toBeDefined();
      expect(response.body.paths['/auth/register']).toBeDefined();
      expect(response.body.paths['/queues']).toBeDefined();
      expect(response.body.paths['/jobs/{jobId}']).toBeDefined();
      expect(response.body.paths['/dlq']).toBeDefined();
      expect(response.body.paths['/workers']).toBeDefined();
    });

    it('serves Swagger UI interactive HTML documentation at /api/v1/docs', async () => {
      const response = await request(app).get('/api/v1/docs');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.text).toContain('SwaggerUIBundle');
      expect(response.text).toContain('/api/v1/openapi.json');
    });
  });

  describe('3. Standardized Error Response Formats', () => {
    it('returns standardized 401 Unauthorized for missing authentication', async () => {
      const response = await request(app).get('/api/v1/orgs');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
      expect(response.headers['x-request-id']).toBeDefined();
    });

    it('returns standardized 404 Not Found for non-existent routes outside api prefix', async () => {
      const response = await request(app).get('/unknown-global-route');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
    });
  });
});
