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

-- ─── Worker ──────────────────────────────────────────────────
INSERT INTO workers (id, project_id, hostname, pid, status, max_concurrency, current_job_count) VALUES
  ('00000000-0000-0000-0005-000000000001',
   '00000000-0000-0000-0002-000000000001',
   'LAPTOP-DEV', 9999, 'offline', 5, 0);

-- ─── Sample Jobs ─────────────────────────────────────────────
INSERT INTO jobs (id, queue_id, name, type, status, payload, priority, attempt_count, max_attempts) VALUES
  ('00000000-0000-0000-0006-000000000001',
   '00000000-0000-0000-0004-000000000001',
   'send-welcome-email', 'immediate', 'completed',
   '{"to":"alice@example.com","template":"welcome"}', 3, 1, 3),

  ('00000000-0000-0000-0006-000000000002',
   '00000000-0000-0000-0004-000000000001',
   'send-invoice-email', 'immediate', 'pending',
   '{"to":"bob@example.com","invoice_id":"INV-0042"}', 3, 0, 3),

  ('00000000-0000-0000-0006-000000000003',
   '00000000-0000-0000-0004-000000000002',
   'generate-monthly-report', 'delayed', 'scheduled',
   '{"month":"2026-07","format":"pdf"}', 6, 0, 3);

-- Update scheduled_at for the delayed job
UPDATE jobs
SET scheduled_at = NOW() + INTERVAL '1 hour'
WHERE id = '00000000-0000-0000-0006-000000000003';

-- ─── Execution Log for completed job ─────────────────────────
INSERT INTO job_executions (job_id, worker_id, attempt_number, status, started_at, finished_at, result) VALUES
  ('00000000-0000-0000-0006-000000000001',
   '00000000-0000-0000-0005-000000000001',
   1, 'completed',
   NOW() - INTERVAL '2 hours',
   NOW() - INTERVAL '2 hours' + INTERVAL '432 milliseconds',
   '{"messageId":"msg_abc123","accepted":["alice@example.com"]}');

-- ─── Job Logs ────────────────────────────────────────────────
INSERT INTO job_logs (job_id, level, message) VALUES
  ('00000000-0000-0000-0006-000000000001', 'info',  'Job started'),
  ('00000000-0000-0000-0006-000000000001', 'info',  'Connecting to SMTP server'),
  ('00000000-0000-0000-0006-000000000001', 'info',  'Email sent successfully'),
  ('00000000-0000-0000-0006-000000000001', 'debug', 'Job completed in 432ms');

-- ─── Scheduled Job (cron) ────────────────────────────────────
INSERT INTO scheduled_jobs
    (queue_id, retry_policy_id, name, cron_expression, timezone, payload_template, priority, max_attempts, enabled, next_run_at)
VALUES
  ('00000000-0000-0000-0004-000000000002',
   '00000000-0000-0000-0003-000000000001',
   'daily-summary-report', '0 8 * * *', 'Asia/Kolkata',
   '{"report_type":"daily_summary"}', 5, 3, TRUE,
   date_trunc('day', NOW() + INTERVAL '1 day') + INTERVAL '2.5 hours');

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
