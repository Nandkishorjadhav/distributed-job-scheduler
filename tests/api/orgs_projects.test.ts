import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../backend/api/src/app';

const app = createApp();

describe('Organization & Project Management API Tests', () => {
  const time = Date.now();

  const userA = {
    email: `org_owner_${time}@example.com`,
    password: 'password123',
    name: 'Org Owner User',
  };

  const userB = {
    email: `org_stranger_${time}@example.com`,
    password: 'password123',
    name: 'Org Stranger User',
  };

  let tokenA: string;
  let tokenB: string;

  let createdOrgId: string;
  let createdOrgSlug: string;

  let createdProjectId: string;
  let createdProjectSlug: string;

  beforeAll(async () => {
    // Register User A
    const resA = await request(app).post('/api/v1/auth/register').send(userA);
    tokenA = resA.body.data.token;

    // Register User B
    const resB = await request(app).post('/api/v1/auth/register').send(userB);
    tokenB = resB.body.data.token;
  });

  // ─── ORGANIZATION MANAGEMENT ───────────────────────────────────────────────

  describe('Organization Management', () => {
    it('creates an organization successfully and assigns owner role', async () => {
      createdOrgSlug = `acme-org-${time}`;
      const response = await request(app)
        .post('/api/v1/orgs')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Acme Testing Corp',
          slug: createdOrgSlug,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.organization.id).toBeDefined();
      expect(response.body.data.organization.name).toBe('Acme Testing Corp');
      expect(response.body.data.organization.slug).toBe(createdOrgSlug);

      createdOrgId = response.body.data.organization.id;
    });

    it('rejects creation of duplicate organization slug with 409 Conflict', async () => {
      const response = await request(app)
        .post('/api/v1/orgs')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Acme Duplicate',
          slug: createdOrgSlug,
        });

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('ORG_SLUG_EXISTS');
    });

    it('lists organizations for the authenticated user', async () => {
      const response = await request(app)
        .get('/api/v1/orgs')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.pagination).toBeDefined();
      expect(response.body.data.some((o: { id: string }) => o.id === createdOrgId)).toBe(true);
    });

    it('retrieves organization details for a member', async () => {
      const response = await request(app)
        .get(`/api/v1/orgs/${createdOrgId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.organization.id).toBe(createdOrgId);
      expect(response.body.data.organization.role).toBe('owner');
    });

    it('rejects organization retrieval for non-member user with 403 Forbidden', async () => {
      const response = await request(app)
        .get(`/api/v1/orgs/${createdOrgId}`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('updates organization name and slug by owner/admin', async () => {
      const updatedSlug = `acme-updated-${time}`;
      const response = await request(app)
        .patch(`/api/v1/orgs/${createdOrgId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Acme Updated Corp',
          slug: updatedSlug,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.organization.name).toBe('Acme Updated Corp');
      expect(response.body.data.organization.slug).toBe(updatedSlug);

      createdOrgSlug = updatedSlug;
    });

    it('rejects organization update by non-member with 403 Forbidden', async () => {
      const response = await request(app)
        .patch(`/api/v1/orgs/${createdOrgId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          name: 'Hacked Org Name',
        });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });
  });

  // ─── PROJECT MANAGEMENT ───────────────────────────────────────────────────

  describe('Project Management', () => {
    it('creates a project within an organization', async () => {
      createdProjectSlug = `proj-main-${time}`;
      const response = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          organizationId: createdOrgId,
          name: 'Main Platform Services',
          slug: createdProjectSlug,
          description: 'Core backend microservices project',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.project.id).toBeDefined();
      expect(response.body.data.project.organizationId).toBe(createdOrgId);
      expect(response.body.data.project.slug).toBe(createdProjectSlug);

      createdProjectId = response.body.data.project.id;
    });

    it('rejects project creation with duplicate slug in same organization with 409 Conflict', async () => {
      const response = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          organizationId: createdOrgId,
          name: 'Duplicate Project',
          slug: createdProjectSlug,
        });

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('PROJECT_SLUG_EXISTS');
    });

    it('rejects project creation by non-member user with 403 Forbidden', async () => {
      const response = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          organizationId: createdOrgId,
          name: 'Unauthorized Project',
          slug: `unauth-proj-${time}`,
        });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    it('lists projects for the user with pagination', async () => {
      const response = await request(app)
        .get('/api/v1/projects?page=1&pageSize=10')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.pagination).toBeDefined();
      expect(response.body.data.some((p: { id: string }) => p.id === createdProjectId)).toBe(true);
    });

    it('lists projects filtered by organizationId', async () => {
      const response = await request(app)
        .get(`/api/v1/projects?organizationId=${createdOrgId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(
        response.body.data.every(
          (p: { organizationId: string }) => p.organizationId === createdOrgId
        )
      ).toBe(true);
    });

    it('retrieves project details for an authorized user', async () => {
      const response = await request(app)
        .get(`/api/v1/projects/${createdProjectId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.project.id).toBe(createdProjectId);
    });

    it('rejects project retrieval for unauthorized user with 403 Forbidden', async () => {
      const response = await request(app)
        .get(`/api/v1/projects/${createdProjectId}`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    it('updates project details', async () => {
      const updatedSlug = `proj-updated-${time}`;
      const response = await request(app)
        .patch(`/api/v1/projects/${createdProjectId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Updated Platform Services',
          slug: updatedSlug,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.project.name).toBe('Updated Platform Services');
      expect(response.body.data.project.slug).toBe(updatedSlug);
    });

    it('deletes a project safely when it contains no active queues', async () => {
      const response = await request(app)
        .delete(`/api/v1/projects/${createdProjectId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Project deleted successfully');

      // Verify it is no longer accessible
      const checkRes = await request(app)
        .get(`/api/v1/projects/${createdProjectId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(checkRes.status).toBe(404);
    });
  });
});
