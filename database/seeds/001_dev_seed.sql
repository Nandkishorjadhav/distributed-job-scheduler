-- ============================================================
-- Seed 001: Development Data
-- Run AFTER 002_complete_schema.sql
-- ============================================================

BEGIN;

-- ─── Users ───────────────────────────────────────────────────
-- Passwords are bcrypt hash of 'password123' (cost 12)
INSERT INTO users (id, email, password_hash, name) VALUES
  ('00000000-0000-0000-0000-000000000001',
   'alice@example.com',
   '$2b$12$K8GpKX3bfGMb6KQxXRhlDO5XmQ3J1j5pHpBj.D6k9IY9PpXBzFZaG',
   'Alice Admin'),
  ('00000000-0000-0000-0000-000000000002',
   'bob@example.com',
   '$2b$12$K8GpKX3bfGMb6KQxXRhlDO5XmQ3J1j5pHpBj.D6k9IY9PpXBzFZaG',
   'Bob Developer');

-- ─── Organization ────────────────────────────────────────────
INSERT INTO organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0001-000000000001', 'Acme Corp', 'acme-corp');

-- ─── Members ─────────────────────────────────────────────────
INSERT INTO organization_members (organization_id, user_id, role) VALUES
  ('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-000000000001', 'owner'),
  ('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-000000000002', 'member');

-- ─── Project ─────────────────────────────────────────────────
INSERT INTO projects (id, organization_id, name, slug, description) VALUES
  ('00000000-0000-0000-0002-000000000001',
   '00000000-0000-0000-0001-000000000001',
   'Main Platform',
   'main-platform',
   'Core product backend jobs');

-- ─── Retry Policies ──────────────────────────────────────────
INSERT INTO retry_policies (id, project_id, name, strategy, max_attempts, initial_delay_ms, max_delay_ms, backoff_multiplier, jitter_ms) VALUES
  ('00000000-0000-0000-0003-000000000001',
   '00000000-0000-0000-0002-000000000001',
   'default-exponential', 'exponential', 3, 1000, 30000, 2.0, 500),
  ('00000000-0000-0000-0003-000000000002',
   '00000000-0000-0000-0002-000000000001',
   'aggressive-retry', 'linear', 10, 500, 10000, 1.5, 200),
  ('00000000-0000-0000-0003-000000000003',
   '00000000-0000-0000-0002-000000000001',
   'no-retry', 'fixed', 1, 0, 0, 1.0, 0);

-- ─── Queues ──────────────────────────────────────────────────
INSERT INTO queues (id, project_id, retry_policy_id, name, description, priority, concurrency_limit, dlq_enabled) VALUES
  ('00000000-0000-0000-0004-000000000001',
   '00000000-0000-0000-0002-000000000001',
   '00000000-0000-0000-0003-000000000001',
   'email-queue', 'Transactional email delivery', 3, 20, TRUE),
  ('00000000-0000-0000-0004-000000000002',
   '00000000-0000-0000-0002-000000000001',
   '00000000-0000-0000-0003-000000000001',
   'report-generation', 'PDF and CSV report exports', 6, 5, TRUE),
  ('00000000-0000-0000-0004-000000000003',
   '00000000-0000-0000-0002-000000000001',
   '00000000-0000-0000-0003-000000000003',
   'webhook-delivery', 'Outbound webhook notifications', 2, 50, TRUE);

-- ─── API Key ─────────────────────────────────────────────────
-- Raw key: sk_dev_00000000placeholder (shown once at creation)
-- Hash: sha256 of the raw key (placeholder — real hash in production)
INSERT INTO api_keys (project_id, created_by, name, key_hash, key_prefix, scopes) VALUES
  ('00000000-0000-0000-0002-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'dev-api-key',
   'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
   'sk_dev_00',
   ARRAY['jobs:read','jobs:write','queues:read']);

COMMIT;
