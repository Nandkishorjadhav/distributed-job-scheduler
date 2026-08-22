// Global test setup
// Configure environment variables for tests before anything else.

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/job_scheduler';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret-at-least-32-characters-long';
process.env.API_PORT = '3099';
