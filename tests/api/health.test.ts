import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../backend/api/src/app';

// Create a test app instance (does not start listening)
const app = createApp();

describe('GET /api/v1/health', () => {
  it('returns 200 with status ok', async () => {
    const response = await request(app).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.timestamp).toBeDefined();
  });
});

describe('Route and auth behaviour', () => {
  it('returns 401 for unknown protected routes (auth guard fires first)', async () => {
    const response = await request(app).get('/api/v1/does-not-exist');
    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it('returns 404 for paths outside /api/v1', async () => {
    const response = await request(app).get('/completely-unknown-path');
    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  });
});
