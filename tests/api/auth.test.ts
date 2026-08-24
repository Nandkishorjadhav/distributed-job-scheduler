import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../../backend/api/src/app';

const app = createApp();
const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters-long';

describe('Auth Module Integration Tests', () => {
  const uniqueId = Date.now();
  const testUser = {
    email: `auth_test_${uniqueId}@example.com`,
    password: 'password123',
    name: 'Auth Test User',
  };

  let validToken: string;
  let testUserId: string;

  describe('User Registration', () => {
    it('registers a new user successfully', async () => {
      const response = await request(app).post('/api/v1/auth/register').send(testUser);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user).toBeDefined();
      expect(response.body.data.user.email).toBe(testUser.email.toLowerCase());
      expect(response.body.data.user.name).toBe(testUser.name);
      expect(response.body.data.user.password_hash).toBeUndefined(); // Passwords must NOT be exposed
      expect(response.body.data.token).toBeDefined();

      testUserId = response.body.data.user.id;
      validToken = response.body.data.token;
    });

    it('rejects duplicate email registration with 409 Conflict', async () => {
      const response = await request(app).post('/api/v1/auth/register').send(testUser);

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('USER_ALREADY_EXISTS');
    });

    it('rejects invalid email format with 400 Bad Request', async () => {
      const response = await request(app).post('/api/v1/auth/register').send({
        email: 'invalid-email-format',
        password: 'password123',
        name: 'Invalid Email User',
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
    });

    it('rejects password shorter than 8 characters with 400 Bad Request', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: `short_pw_${uniqueId}@example.com`,
          password: 'short',
          name: 'Short PW User',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
    });
  });

  describe('User Login', () => {
    it('logs in successfully with valid credentials', async () => {
      const response = await request(app).post('/api/v1/auth/login').send({
        email: testUser.email,
        password: testUser.password,
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user).toBeDefined();
      expect(response.body.data.user.email).toBe(testUser.email.toLowerCase());
      expect(response.body.data.token).toBeDefined();
    });

    it('rejects login with wrong password', async () => {
      const response = await request(app).post('/api/v1/auth/login').send({
        email: testUser.email,
        password: 'wrongpassword',
      });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects login with non-existent email', async () => {
      const response = await request(app).post('/api/v1/auth/login').send({
        email: 'nonexistent_user_99999@example.com',
        password: 'password123',
      });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('Protected Routes & Authorization', () => {
    it('returns current user info when valid Bearer token is provided', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user.id).toBe(testUserId);
      expect(response.body.data.user.email).toBe(testUser.email.toLowerCase());
    });

    it('rejects access to /api/v1/auth/me when token is missing', async () => {
      const response = await request(app).get('/api/v1/auth/me');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('UNAUTHORIZED');
    });

    it('rejects access to queue management API /api/v1/queues when token is missing', async () => {
      const response = await request(app).get('/api/v1/queues');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('UNAUTHORIZED');
    });

    it('rejects access to project management API /api/v1/projects when token is missing', async () => {
      const response = await request(app).get('/api/v1/projects');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('UNAUTHORIZED');
    });

    it('rejects access to worker management API /api/v1/workers when token is missing', async () => {
      const response = await request(app).get('/api/v1/workers');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('UNAUTHORIZED');
    });
  });

  describe('Token Validation Errors', () => {
    it('rejects request with invalid/malformed token', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid.jwt.token.string');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('TOKEN_INVALID');
    });

    it('rejects request with expired token', async () => {
      const expiredToken = jwt.sign({ id: testUserId, email: testUser.email }, JWT_SECRET, {
        expiresIn: '-1s',
      });

      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('TOKEN_EXPIRED');
    });
  });

  describe('User Logout', () => {
    it('logs out user successfully when authenticated', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Logged out successfully');
    });
  });
});
