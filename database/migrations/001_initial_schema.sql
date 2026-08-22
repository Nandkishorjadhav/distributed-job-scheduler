-- ============================================================
-- Migration 001: Initial Schema
-- Distributed Job Scheduler
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Users ───────────────────────────────────────────────────────────────────

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name          VARCHAR(256) NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Organizations ────────────────────────────────────────────────────────────

CREATE TABLE organizations (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       VARCHAR(128) NOT NULL,
    slug       VARCHAR(64)  NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Org Members ─────────────────────────────────────────────────────────────

CREATE TYPE org_role AS ENUM ('owner', 'admin', 'member', 'viewer');

CREATE TABLE org_members (
    org_id     UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       org_role    NOT NULL DEFAULT 'member',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_id, user_id)
);

-- ─── Projects ─────────────────────────────────────────────────────────────────

CREATE TABLE projects (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id     UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name       VARCHAR(128) NOT NULL,
    slug       VARCHAR(64)  NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, slug)
);

-- ─── API Keys ─────────────────────────────────────────────────────────────────

CREATE TABLE api_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        VARCHAR(128) NOT NULL,
    key_hash    VARCHAR(255) NOT NULL UNIQUE,  -- SHA-256 hash of the raw key
    key_prefix  VARCHAR(12)  NOT NULL,         -- first 8 chars shown in UI
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ
);

-- ─── Queues ───────────────────────────────────────────────────────────────────

CREATE TYPE queue_status AS ENUM ('active', 'paused');

CREATE TABLE queues (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name              VARCHAR(128) NOT NULL,
    -- 1 (highest) to 10 (lowest)
    priority          SMALLINT     NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
    concurrency_limit INT          NOT NULL DEFAULT 10 CHECK (concurrency_limit >= 1),
    status            queue_status NOT NULL DEFAULT 'active',
    -- RetryPolicy stored as JSONB
    retry_policy      JSONB        NOT NULL DEFAULT '{
        "maxAttempts": 3,
        "strategy": "exponential",
        "initialDelayMs": 1000,
        "maxDelayMs": 30000,
        "jitterMs": 500
    }'::jsonb,
    dlq_enabled       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, name)
);

-- ─── Workers ──────────────────────────────────────────────────────────────────

CREATE TYPE worker_status AS ENUM ('active', 'draining', 'offline');

CREATE TABLE workers (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    hostname            VARCHAR(255)  NOT NULL,
    pid                 INT           NOT NULL,
    status              worker_status NOT NULL DEFAULT 'active',
    max_concurrency     INT           NOT NULL DEFAULT 5,
    last_heartbeat_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── Worker Queue Subscriptions ──────────────────────────────────────────────

CREATE TABLE worker_queue_subscriptions (
    worker_id  UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    queue_id   UUID NOT NULL REFERENCES queues(id)  ON DELETE CASCADE,
    PRIMARY KEY (worker_id, queue_id)
);

-- ─── Batch Jobs ───────────────────────────────────────────────────────────────

CREATE TABLE batch_jobs (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name            VARCHAR(256) NOT NULL,
    total_count     INT          NOT NULL DEFAULT 0,
    pending_count   INT          NOT NULL DEFAULT 0,
    completed_count INT          NOT NULL DEFAULT 0,
    failed_count    INT          NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── Jobs ─────────────────────────────────────────────────────────────────────

CREATE TYPE job_status AS ENUM (
    'pending',
    'delayed',
    'running',
    'completed',
    'failed',
    'dead',
    'cancelled'
);

CREATE TYPE job_type AS ENUM (
    'immediate',
    'delayed',
    'scheduled',
    'recurring',
    'batch'
);

CREATE TABLE jobs (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    queue_id      UUID        NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
    batch_id      UUID        REFERENCES batch_jobs(id) ON DELETE SET NULL,
    worker_id     UUID        REFERENCES workers(id) ON DELETE SET NULL,
    type          job_type    NOT NULL DEFAULT 'immediate',
    name          VARCHAR(256) NOT NULL,
    payload       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    status        job_status  NOT NULL DEFAULT 'pending',
    -- 1 (highest) to 10 (lowest)
    priority      SMALLINT    NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
    max_attempts  INT         NOT NULL DEFAULT 3,
    attempt_count INT         NOT NULL DEFAULT 0,
    scheduled_at  TIMESTAMPTZ,
    started_at    TIMESTAMPTZ,
    finished_at   TIMESTAMPTZ,
    result        JSONB,
    error_message TEXT,
    error_stack   TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Job Logs ─────────────────────────────────────────────────────────────────

CREATE TYPE log_level AS ENUM ('debug', 'info', 'warn', 'error');

CREATE TABLE job_logs (
    id        UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id    UUID      NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    level     log_level NOT NULL DEFAULT 'info',
    message   TEXT      NOT NULL,
    logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Recurring Job Definitions ────────────────────────────────────────────────

CREATE TABLE recurring_job_definitions (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    queue_id         UUID         NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
    name             VARCHAR(256) NOT NULL,
    cron_expression  VARCHAR(128) NOT NULL,
    payload_template JSONB        NOT NULL DEFAULT '{}'::jsonb,
    retry_policy     JSONB,
    enabled          BOOLEAN      NOT NULL DEFAULT TRUE,
    next_run_at      TIMESTAMPTZ,
    last_fired_at    TIMESTAMPTZ,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── Job Metrics ─────────────────────────────────────────────────────────────

CREATE TABLE job_metrics (
    id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    queue_id        UUID    NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
    date            DATE    NOT NULL,
    completed_count INT     NOT NULL DEFAULT 0,
    failed_count    INT     NOT NULL DEFAULT 0,
    dead_count      INT     NOT NULL DEFAULT 0,
    avg_latency_ms  NUMERIC(10, 2),
    p95_latency_ms  NUMERIC(10, 2),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (queue_id, date)
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- Jobs: primary claim query (pending jobs ordered by priority then created_at)
CREATE INDEX idx_jobs_queue_status_priority
    ON jobs (queue_id, status, priority DESC, created_at ASC);

-- Jobs: delayed job promotion
CREATE INDEX idx_jobs_delayed_scheduled
    ON jobs (status, scheduled_at)
    WHERE status = 'delayed';

-- Jobs: running jobs per queue (concurrency check)
CREATE INDEX idx_jobs_running_queue
    ON jobs (queue_id, status)
    WHERE status = 'running';

-- Jobs: stale reaper (running jobs with dead workers)
CREATE INDEX idx_jobs_running_worker
    ON jobs (worker_id, status)
    WHERE status = 'running';

-- Workers: active workers
CREATE INDEX idx_workers_status_heartbeat
    ON workers (status, last_heartbeat_at)
    WHERE status = 'active';

-- Recurring jobs: due definitions
CREATE INDEX idx_recurring_next_run
    ON recurring_job_definitions (next_run_at, enabled)
    WHERE enabled = TRUE;

-- Job logs
CREATE INDEX idx_job_logs_job_id ON job_logs (job_id, logged_at);

-- Metrics
CREATE INDEX idx_job_metrics_queue_date ON job_metrics (queue_id, date);

-- ─── updated_at auto-update trigger ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_queues_updated_at BEFORE UPDATE ON queues
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_workers_updated_at BEFORE UPDATE ON workers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_batch_jobs_updated_at BEFORE UPDATE ON batch_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_recurring_updated_at BEFORE UPDATE ON recurring_job_definitions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
