import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../backend/api/src/app';

const app = createApp();

describe('Queue Management API Tests', () => {
  const time = Date.now();

  const userOwner = {
    email: `queue_owner_${time}@example.com`,
    password: 'password123',
    name: 'Queue Owner User',
  };

  const userStranger = {
    email: `queue_stranger_${time}@example.com`,
    password: 'password123',
    name: 'Queue Stranger User',
  };

  let tokenOwner: string;
  let tokenStranger: string;

  let orgId: string;
  let projectId: string;

  let createdQueueId: string;
  let createdQueueName: string;

  beforeAll(async () => {
    // 1. Register Owner & Stranger
    const resOwner = await request(app).post('/api/v1/auth/register').send(userOwner);
    tokenOwner = resOwner.body.data.token;

    const resStranger = await request(app).post('/api/v1/auth/register').send(userStranger);
    tokenStranger = resStranger.body.data.token;

    // 2. Create Organization
    const orgRes = await request(app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({
        name: 'Queue Test Org',
        slug: `queue-org-${time}`,
      });
    orgId = orgRes.body.data.organization.id;

    // 3. Create Project
    const projRes = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({
        organizationId: orgId,
        name: 'Queue Test Project',
        slug: `queue-proj-${time}`,
        description: 'Test project for queue APIs',
      });
    projectId = projRes.body.data.project.id;
  });

  describe('Queue Creation', () => {
    it('creates a new queue with priority, concurrency limit, and retry policy', async () => {
      createdQueueName = `email-queue-${time}`;
      const response = await request(app)
        .post('/api/v1/queues')
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          projectId,
          name: createdQueueName,
          description: 'Transactional email queue',
          priority: 3,
          concurrencyLimit: 15,
          dlqEnabled: true,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.queue.id).toBeDefined();
      expect(response.body.data.queue.projectId).toBe(projectId);
      expect(response.body.data.queue.name).toBe(createdQueueName);
      expect(response.body.data.queue.priority).toBe(3);
      expect(response.body.data.queue.concurrencyLimit).toBe(15);
      expect(response.body.data.queue.status).toBe('active');
      expect(response.body.data.queue.pausedAt).toBeNull();

      createdQueueId = response.body.data.queue.id;
    });

    it('rejects duplicate queue name within the same project with 409 Conflict', async () => {
      const response = await request(app)
        .post('/api/v1/queues')
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          projectId,
          name: createdQueueName,
          priority: 5,
        });

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('QUEUE_NAME_EXISTS');
    });

    it('rejects queue creation by unauthorized user with 403 Forbidden', async () => {
      const response = await request(app)
        .post('/api/v1/queues')
        .set('Authorization', `Bearer ${tokenStranger}`)
        .send({
          projectId,
          name: `unauth-queue-${time}`,
          priority: 5,
        });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('FORBIDDEN');
    });
  });

  describe('Queue Retrieval & Listing', () => {
    it('retrieves queue details by ID', async () => {
      const response = await request(app)
        .get(`/api/v1/queues/${createdQueueId}`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.queue.id).toBe(createdQueueId);
      expect(response.body.data.queue.name).toBe(createdQueueName);
    });

    it('rejects queue retrieval for unauthorized user with 403 Forbidden', async () => {
      const response = await request(app)
        .get(`/api/v1/queues/${createdQueueId}`)
        .set('Authorization', `Bearer ${tokenStranger}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    it('lists queues accessible to the user with pagination', async () => {
      const response = await request(app)
        .get('/api/v1/queues?page=1&pageSize=10')
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.some((q: { id: string }) => q.id === createdQueueId)).toBe(true);
    });

    it('lists queues filtered by projectId', async () => {
      const response = await request(app)
        .get(`/api/v1/queues?projectId=${projectId}`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.every((q: { projectId: string }) => q.projectId === projectId)).toBe(true);
    });
  });

  describe('Queue Configuration Update', () => {
    it('updates priority and concurrency limit', async () => {
      const response = await request(app)
        .patch(`/api/v1/queues/${createdQueueId}`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          priority: 2,
          concurrencyLimit: 25,
          description: 'Updated high throughput queue',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.queue.priority).toBe(2);
      expect(response.body.data.queue.concurrencyLimit).toBe(25);
      expect(response.body.data.queue.description).toBe('Updated high throughput queue');
    });
  });

  describe('Pause & Resume Queue', () => {
    it('pauses job processing on a queue', async () => {
      const response = await request(app)
        .post(`/api/v1/queues/${createdQueueId}/pause`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.queue.status).toBe('paused');
      expect(response.body.data.queue.pausedAt).toBeDefined();
    });

    it('resumes job processing on a paused queue', async () => {
      const response = await request(app)
        .post(`/api/v1/queues/${createdQueueId}/resume`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.queue.status).toBe('active');
      expect(response.body.data.queue.pausedAt).toBeNull();
    });
  });

  describe('Queue Statistics', () => {
    it('returns queue statistics including job breakdown counters', async () => {
      const response = await request(app)
        .get(`/api/v1/queues/${createdQueueId}/stats`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.stats).toBeDefined();
      expect(response.body.data.stats.queueId).toBe(createdQueueId);
      expect(response.body.data.stats.queuedJobs).toBeDefined();
      expect(response.body.data.stats.runningJobs).toBeDefined();
      expect(response.body.data.stats.completedJobs).toBeDefined();
      expect(response.body.data.stats.failedJobs).toBeDefined();
      expect(response.body.data.stats.retryingJobs).toBeDefined();
      expect(response.body.data.stats.deadLetterJobs).toBeDefined();
    });
  });

  describe('Queue Deletion', () => {
    it('deletes a queue safely when no active/pending jobs exist', async () => {
      const response = await request(app)
        .delete(`/api/v1/queues/${createdQueueId}`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Queue deleted successfully');

      // Verify it is no longer accessible
      const checkRes = await request(app)
        .get(`/api/v1/queues/${createdQueueId}`)
        .set('Authorization', `Bearer ${tokenOwner}`);

      expect(checkRes.status).toBe(404);
    });
  });
});
