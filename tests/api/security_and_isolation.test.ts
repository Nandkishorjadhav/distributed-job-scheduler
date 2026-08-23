import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../../backend/api/src/app';
import {
  getPool,
  OrgRepository,
  ProjectRepository,
  QueueRepository,
  WorkerRepository,
  JobClaimService,
  JobRepository,
} from '@job-scheduler/backend-shared';

describe('Security, Multi-Tenant Isolation & Authentication Tests', () => {
  const app = createApp();
  const pool = getPool();
  const orgRepo = new OrgRepository(pool);
  const projectRepo = new ProjectRepository(pool);
  const queueRepo = new QueueRepository(pool);
  const workerRepo = new WorkerRepository(pool);
  const jobRepo = new JobRepository(pool);
  const claimService = new JobClaimService(pool);

  const time = Date.now();
  let userId: string;
  let orgId: string;
  let projAId: string;
  let projBId: string;
  let queueAId: string;
  let queueBId: string;
  let workerAId: string;
  let workerBId: string;
  let rawValidApiKey: string;
  let rawRevokedApiKey: string;
  let rawExpiredApiKey: string;

  beforeAll(async () => {
    // 1. Create User via register endpoint
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: `security_user_${time}@example.com`,
        password: 'Password123!',
        name: 'Security Tester',
      });
    userId = regRes.body.data.user.id;

    // 2. Create Org
    const org = await orgRepo.create(
      { name: `Security Org ${time}`, slug: `sec-org-${time}` },
      userId
    );
    orgId = org.id;

    // 3. Create Project A & Project B
    const projA = await projectRepo.create({
      organizationId: orgId,
      name: 'Project A',
      slug: `proj-a-${time}`,
    });
    projAId = projA.id;

    const projB = await projectRepo.create({
      organizationId: orgId,
      name: 'Project B',
      slug: `proj-b-${time}`,
    });
    projBId = projB.id;

    // 4. Create Queue in Proj A and Queue in Proj B
    const qA = await queueRepo.create({ projectId: projAId, name: `queue-a-${time}` });
    queueAId = qA.id;

    const qB = await queueRepo.create({ projectId: projBId, name: `queue-b-${time}` });
    queueBId = qB.id;

    // 5. Register Worker A (in Proj A) and Worker B (in Proj B)
    const wA = await workerRepo.register({
      projectId: projAId,
      hostname: 'worker-node-a',
      pid: 2001,
      maxConcurrency: 5,
    });
    workerAId = wA.id;

    const wB = await workerRepo.register({
      projectId: projBId,
      hostname: 'worker-node-b',
      pid: 2002,
      maxConcurrency: 5,
    });
    workerBId = wB.id;

    // 6. Generate API keys
    rawValidApiKey = `sk_live_valid_${time}_${crypto.randomBytes(16).toString('hex')}`;
    const hashValid = crypto.createHash('sha256').update(rawValidApiKey).digest('hex');
    await pool.query(
      `INSERT INTO api_keys (project_id, created_by, name, key_hash, key_prefix, scopes)
       VALUES ($1, $2, 'Valid Key', $3, 'sk_live', ARRAY['jobs:read', 'jobs:write'])`,
      [projAId, userId, hashValid]
    );

    rawRevokedApiKey = `sk_live_revoked_${time}_${crypto.randomBytes(16).toString('hex')}`;
    const hashRevoked = crypto.createHash('sha256').update(rawRevokedApiKey).digest('hex');
    await pool.query(
      `INSERT INTO api_keys (project_id, created_by, name, key_hash, key_prefix, scopes, revoked_at)
       VALUES ($1, $2, 'Revoked Key', $3, 'sk_live', ARRAY['jobs:read'], NOW())`,
      [projAId, userId, hashRevoked]
    );

    rawExpiredApiKey = `sk_live_expired_${time}_${crypto.randomBytes(16).toString('hex')}`;
    const hashExpired = crypto.createHash('sha256').update(rawExpiredApiKey).digest('hex');
    await pool.query(
      `INSERT INTO api_keys (project_id, created_by, name, key_hash, key_prefix, scopes, expires_at)
       VALUES ($1, $2, 'Expired Key', $3, 'sk_live', ARRAY['jobs:read'], NOW() - INTERVAL '1 day')`,
      [projAId, userId, hashExpired]
    );
  });

  describe('1. API Key Authentication & Verification', () => {
    it('authenticates successfully with a valid SHA-256 registered API key', async () => {
      const res = await request(app)
        .get('/api/v1/projects')
        .set('x-api-key', rawValidApiKey);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects an arbitrary fake API key with 401 Invalid API key', async () => {
      const res = await request(app)
        .get('/api/v1/projects')
        .set('x-api-key', 'fake-unregistered-api-key-12345');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_API_KEY');
    });

    it('rejects a revoked API key with 401 API_KEY_REVOKED', async () => {
      const res = await request(app)
        .get('/api/v1/projects')
        .set('x-api-key', rawRevokedApiKey);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('API_KEY_REVOKED');
    });

    it('rejects an expired API key with 401 API_KEY_EXPIRED', async () => {
      const res = await request(app)
        .get('/api/v1/projects')
        .set('x-api-key', rawExpiredApiKey);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('API_KEY_EXPIRED');
    });
  });

  describe('2. Multi-Tenant Worker Project Isolation', () => {
    it('prevents Worker A (Project A) from claiming jobs created in Queue B (Project B)', async () => {
      // Create job in Queue B (Project B)
      const jobB = await jobRepo.create({
        queueId: queueBId,
        name: `isolated-job-b-${time}`,
        priority: 10,
      });

      // Worker A (Project A) attempts to claim without specifying queueId
      const claimResultA = await claimService.claimJob(workerAId);
      // Worker A MUST NOT claim jobB because jobB belongs to Project B!
      expect(claimResultA).toBeNull();

      // Worker B (Project B) attempts to claim: MUST succeed
      const claimResultB = await claimService.claimJob(workerBId);
      expect(claimResultB).not.toBeNull();
      expect(claimResultB!.id).toBe(jobB.id);
    });
  });

  describe('3. Inactive Account Authentication Protection', () => {
    it('blocks login and API key access for deactivated accounts', async () => {
      // Deactivate user
      await pool.query('UPDATE users SET is_active = false WHERE id = $1', [userId]);

      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: `security_user_${time}@example.com`, password: 'Password123!' });

      expect(loginRes.status).toBe(403);
      expect(loginRes.body.code).toBe('ACCOUNT_INACTIVE');

      const apiKeyRes = await request(app)
        .get('/api/v1/projects')
        .set('x-api-key', rawValidApiKey);

      expect(apiKeyRes.status).toBe(401);
      expect(apiKeyRes.body.code).toBe('ACCOUNT_INACTIVE');

      // Reactivate user
      await pool.query('UPDATE users SET is_active = true WHERE id = $1', [userId]);
    });
  });
});
