-- ============================================================
-- Migration 002: Complete Schema Redesign
-- Distributed Job Scheduler
-- ============================================================
-- Run AFTER 001_initial_schema.sql.
-- This migration drops and replaces the initial schema with a
-- fully normalized, production-grade design.
-- ============================================================

BEGIN;

DROP TABLE IF EXISTS
    job_metrics,
    recurring_job_definitions,
    job_logs,
    jobs,
    batch_jobs,
    worker_queue_subscriptions,
    workers,
    api_keys,
    org_members,
    projects,
    organizations,
    users
CASCADE;

DROP TYPE IF EXISTS
    job_status, job_type, queue_status,
    worker_status, org_role, log_level
CASCADE;

-- ─── Extensions ──────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- trigram indexes for text search

-- ============================================================
-- SECTION 1: IDENTITY & ACCESS
-- ============================================================

-- ─── users ───────────────────────────────────────────────────────────────────
-- Root authentication entity. One user can belong to many organisations.
-- Password is always stored as a bcrypt hash (cost ≥ 12). Never plain-text.

CREATE TABLE users (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name          VARCHAR(256) NOT NULL,
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_users_email UNIQUE (email),
    CONSTRAINT chk_users_email_format CHECK (email ~* '^[^@]+@[^@]+\.[^@]+$')
);

COMMENT ON TABLE  users IS 'Authenticated user accounts. Password stored as bcrypt hash.';
COMMENT ON COLUMN users.password_hash IS 'bcrypt hash, cost>=12. Never store plain text.';
COMMENT ON COLUMN users.is_active IS 'FALSE = soft-deleted / suspended.';

-- ─── organizations ───────────────────────────────────────────────────────────
-- Top-level multi-tenant boundary. All resources belong to an org.

CREATE TABLE organizations (
    id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name       VARCHAR(128) NOT NULL,
    slug       VARCHAR(64)  NOT NULL,
    is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_orgs_slug UNIQUE (slug),
    CONSTRAINT chk_orgs_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9\-]{0,62}[a-z0-9]$')
);

COMMENT ON TABLE organizations IS 'Top-level multi-tenant boundary. Each org owns projects.';

-- ─── organization_members ────────────────────────────────────────────────────
-- Many-to-many: users ↔ organizations with RBAC roles.
-- CASCADE on both sides: deleting a user removes their memberships;
-- deleting an org removes all memberships (org data is gone anyway).

CREATE TYPE org_role AS ENUM ('owner', 'admin', 'member', 'viewer');

CREATE TABLE organization_members (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         UUID         NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
    role            org_role     NOT NULL DEFAULT 'member',
    invited_by_id   UUID         REFERENCES users(id)                  ON DELETE SET NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_org_members_org_user UNIQUE (organization_id, user_id)
);

COMMENT ON TABLE organization_members IS 'User ↔ org membership with role-based access control.';
COMMENT ON COLUMN organization_members.invited_by_id IS 'NULL if the user registered directly.';

-- ─── projects ────────────────────────────────────────────────────────────────
-- Namespace under an org. Queues, API keys, and workers belong to a project.

CREATE TABLE projects (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            VARCHAR(128) NOT NULL,
    slug            VARCHAR(64)  NOT NULL,
    description     TEXT,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_projects_org_slug UNIQUE (organization_id, slug),
    CONSTRAINT chk_projects_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9\-]{0,62}[a-z0-9]$')
);

COMMENT ON TABLE projects IS 'Namespace inside an org. API keys and queues scope to a project.';

-- ─── api_keys ────────────────────────────────────────────────────────────────
-- API keys for programmatic access. Raw key is shown ONCE at creation,
-- only the SHA-256 hash is stored.

CREATE TABLE api_keys (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    created_by   UUID         REFERENCES users(id) ON DELETE SET NULL,
    name         VARCHAR(128) NOT NULL,
    key_hash     VARCHAR(64)  NOT NULL,   -- SHA-256 hex, 64 chars
    key_prefix   VARCHAR(12)  NOT NULL,   -- first 8 chars, shown in UI
    scopes       TEXT[]       NOT NULL DEFAULT ARRAY['jobs:read','jobs:write'],
    expires_at   TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_api_keys_hash UNIQUE (key_hash)
);

COMMENT ON TABLE  api_keys IS 'Programmatic access credentials. Only hash is persisted.';
COMMENT ON COLUMN api_keys.scopes IS 'Allowed operations, e.g. {jobs:read, jobs:write}.';

-- ============================================================
-- SECTION 2: RETRY POLICIES
-- ============================================================

-- ─── retry_policies ──────────────────────────────────────────────────────────
-- Extracted into their own table so they can be reused across queues,
-- edited centrally, and audited. Avoids denormalized JSONB blobs.

CREATE TYPE retry_strategy AS ENUM ('fixed', 'linear', 'exponential');

CREATE TABLE retry_policies (
    id                 UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id         UUID           NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name               VARCHAR(128)   NOT NULL,
    strategy           retry_strategy NOT NULL DEFAULT 'exponential',
    max_attempts       SMALLINT       NOT NULL DEFAULT 3,
    initial_delay_ms   INT            NOT NULL DEFAULT 1000,
    max_delay_ms       INT            NOT NULL DEFAULT 30000,
    backoff_multiplier NUMERIC(5,2)   NOT NULL DEFAULT 2.0,
    jitter_ms          INT            NOT NULL DEFAULT 500,
    created_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_retry_policies_project_name UNIQUE (project_id, name),
    CONSTRAINT chk_rp_max_attempts   CHECK (max_attempts   BETWEEN 1 AND 100),
    CONSTRAINT chk_rp_initial_delay  CHECK (initial_delay_ms  >= 0),
    CONSTRAINT chk_rp_max_delay      CHECK (max_delay_ms      >= initial_delay_ms),
    CONSTRAINT chk_rp_multiplier     CHECK (backoff_multiplier >= 1.0),
    CONSTRAINT chk_rp_jitter         CHECK (jitter_ms          >= 0)
);

COMMENT ON TABLE retry_policies IS 'Reusable retry configurations. Referenced by queues and scheduled_jobs.';

-- ============================================================
-- SECTION 3: QUEUES
-- ============================================================

-- ─── queues ──────────────────────────────────────────────────────────────────
-- A queue is the unit of throughput control. Each queue has:
--   • a priority (1=highest, 10=lowest) that influences job claim order
--   • a concurrency_limit (max simultaneous running jobs across all workers)
--   • an optional retry_policy; falls back to project default
--   • a DLQ flag; dead jobs move to dead_letter_jobs when enabled

CREATE TYPE queue_status AS ENUM ('active', 'paused', 'archived');

CREATE TABLE queues (
    id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id            UUID         NOT NULL REFERENCES projects(id)         ON DELETE CASCADE,
    retry_policy_id       UUID         REFERENCES retry_policies(id)            ON DELETE SET NULL,
    name                  VARCHAR(128) NOT NULL,
    description           TEXT,
    priority              SMALLINT     NOT NULL DEFAULT 5,
    concurrency_limit     INT          NOT NULL DEFAULT 10,
    rate_limit_per_minute INT,
    job_timeout_ms        INT,
    status                queue_status NOT NULL DEFAULT 'active',
    dlq_enabled           BOOLEAN      NOT NULL DEFAULT TRUE,
    paused_at             TIMESTAMPTZ,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_queues_project_name  UNIQUE (project_id, name),
    CONSTRAINT chk_queues_priority     CHECK (priority          BETWEEN 1 AND 10),
    CONSTRAINT chk_queues_concurrency  CHECK (concurrency_limit >= 1),
    CONSTRAINT chk_queues_rate_limit   CHECK (rate_limit_per_minute IS NULL OR rate_limit_per_minute >= 1),
    CONSTRAINT chk_queues_timeout      CHECK (job_timeout_ms    IS NULL OR job_timeout_ms >= 100),
    CONSTRAINT chk_queues_paused_at    CHECK (
        (status = 'paused' AND paused_at IS NOT NULL) OR
        (status != 'paused' AND paused_at IS NULL)
    )
);

COMMENT ON TABLE  queues IS 'Job queues — the primary throughput and isolation boundary.';
COMMENT ON COLUMN queues.priority IS '1=highest, 10=lowest. Used for cross-queue job claim ordering.';
COMMENT ON COLUMN queues.concurrency_limit IS 'Max jobs running simultaneously across all workers for this queue.';
COMMENT ON COLUMN queues.job_timeout_ms IS 'NULL = inherit from retry_policy or unlimited.';

-- ============================================================
-- SECTION 4: WORKERS
-- ============================================================

-- ─── workers ─────────────────────────────────────────────────────────────────
-- A worker is a process instance. Workers register on startup and heartbeat
-- periodically. The scheduler uses last_heartbeat_at to detect dead workers.

CREATE TYPE worker_status AS ENUM ('active', 'draining', 'offline');

CREATE TABLE workers (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        UUID          NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    hostname          VARCHAR(255)  NOT NULL,
    ip_address        INET,
    pid               INT           NOT NULL,
    version           VARCHAR(32),
    status            worker_status NOT NULL DEFAULT 'active',
    max_concurrency   INT           NOT NULL DEFAULT 5,
    current_job_count INT           NOT NULL DEFAULT 0,
    last_heartbeat_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    registered_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_workers_pid            CHECK (pid > 0),
    CONSTRAINT chk_workers_concurrency    CHECK (max_concurrency   >= 1),
    CONSTRAINT chk_workers_job_count      CHECK (current_job_count >= 0),
    CONSTRAINT chk_workers_job_leq_max    CHECK (current_job_count <= max_concurrency)
);

COMMENT ON TABLE  workers IS 'Registered worker processes. Heartbeat proves liveness.';
COMMENT ON COLUMN workers.current_job_count IS 'Updated atomically when a job is claimed or released.';

-- ─── worker_queue_subscriptions ──────────────────────────────────────────────
-- A worker only picks up jobs from queues it is subscribed to.
-- Cascades on both sides: removing a worker or queue clears subscriptions.

CREATE TABLE worker_queue_subscriptions (
    worker_id     UUID        NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    queue_id      UUID        NOT NULL REFERENCES queues(id)  ON DELETE CASCADE,
    subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (worker_id, queue_id)
);

COMMENT ON TABLE worker_queue_subscriptions IS 'Which queues a worker polls. Worker only claims jobs from subscribed queues.';

-- ─── worker_heartbeats ───────────────────────────────────────────────────────
-- A time-series log of every heartbeat. Useful for liveness charts and
-- post-mortem debugging. Rows older than 24 h can be pruned.

CREATE TABLE worker_heartbeats (
    id               BIGSERIAL     PRIMARY KEY,   -- bigserial: high insert rate, no UUID needed
    worker_id        UUID          NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    status           worker_status NOT NULL,
    current_job_count INT          NOT NULL DEFAULT 0,
    metadata         JSONB,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  worker_heartbeats IS 'Append-only heartbeat log. Prune rows older than 24h via cron.';
COMMENT ON COLUMN worker_heartbeats.metadata IS 'Optional: CPU%, memory, queue depths.';

-- ============================================================
-- SECTION 5: JOBS (high-volume core table)
-- ============================================================

CREATE TYPE job_status AS ENUM (
    'pending',      -- waiting to be claimed
    'running',      -- currently executing on a worker
    'completed',    -- finished successfully
    'failed',       -- last attempt failed, will retry
    'dead',         -- exhausted all attempts, moved to DLQ
    'cancelled',    -- cancelled by user before execution
    'scheduled'     -- waiting for its scheduled_at time
);

CREATE TYPE job_type AS ENUM (
    'immediate',    -- run ASAP
    'delayed',      -- run after a delay
    'scheduled',    -- run at a specific datetime
    'recurring',    -- spawned by a scheduled_job definition
    'batch_child'   -- part of a batch group
);

-- ─── batch_groups ────────────────────────────────────────────────────────────
-- Groups a set of jobs submitted together. Counters updated by triggers
-- so the API can query batch progress in O(1).

CREATE TABLE batch_groups (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name            VARCHAR(256) NOT NULL,
    description     TEXT,
    total_count     INT          NOT NULL DEFAULT 0,
    pending_count   INT          NOT NULL DEFAULT 0,
    running_count   INT          NOT NULL DEFAULT 0,
    completed_count INT          NOT NULL DEFAULT 0,
    failed_count    INT          NOT NULL DEFAULT 0,
    dead_count      INT          NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_batch_counts_non_negative CHECK (
        total_count >= 0 AND pending_count >= 0 AND running_count >= 0 AND
        completed_count >= 0 AND failed_count >= 0 AND dead_count >= 0
    )
);

COMMENT ON TABLE batch_groups IS 'Groups batch_child jobs. Counters allow O(1) progress queries.';

-- ─── jobs ────────────────────────────────────────────────────────────────────
-- The primary high-volume table. Every job submission creates one row.
-- Design goals:
--   • The claim query MUST use an index (no sequential scans)
--   • Partial indexes on status keep index size small
--   • worker_id is SET NULL when a worker dies (job re-claimable)
--   • attempt_count + max_attempts drive retry logic in application code

CREATE TABLE jobs (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    queue_id         UUID         NOT NULL REFERENCES queues(id)       ON DELETE CASCADE,
    worker_id        UUID         REFERENCES workers(id)               ON DELETE SET NULL,
    batch_group_id   UUID         REFERENCES batch_groups(id)          ON DELETE SET NULL,
    scheduled_job_id UUID,        -- FK added later (scheduled_jobs forward-ref)

    -- Identity
    name             VARCHAR(256) NOT NULL,
    type             job_type     NOT NULL DEFAULT 'immediate',
    status           job_status   NOT NULL DEFAULT 'pending',

    -- Payload
    payload          JSONB        NOT NULL DEFAULT '{}',

    -- Scheduling & priority
    priority         SMALLINT     NOT NULL DEFAULT 5,
    scheduled_at     TIMESTAMPTZ,     -- NULL = run ASAP; set for delayed/scheduled/recurring
    run_at           TIMESTAMPTZ,     -- actual resolved run time (set at claim time)

    -- Retry tracking
    attempt_count    SMALLINT     NOT NULL DEFAULT 0,
    max_attempts     SMALLINT     NOT NULL DEFAULT 3,
    next_attempt_at  TIMESTAMPTZ,     -- when the next retry is eligible

    -- Timeout
    timeout_ms       INT,             -- NULL = inherit from queue

    -- Result
    result           JSONB,
    error_message    TEXT,
    error_code       VARCHAR(64),

    -- Key timestamps
    enqueued_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    started_at       TIMESTAMPTZ,
    finished_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- ── Constraints ────────────────────────────────────
    CONSTRAINT chk_jobs_priority
        CHECK (priority BETWEEN 1 AND 10),
    CONSTRAINT chk_jobs_max_attempts
        CHECK (max_attempts BETWEEN 1 AND 100),
    CONSTRAINT chk_jobs_attempt_leq_max
        CHECK (attempt_count <= max_attempts),
    CONSTRAINT chk_jobs_scheduled_has_time
        CHECK (
            type NOT IN ('delayed', 'scheduled', 'recurring')
            OR scheduled_at IS NOT NULL
        ),
    CONSTRAINT chk_jobs_finished_after_started
        CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at),
    CONSTRAINT chk_jobs_timeout
        CHECK (timeout_ms IS NULL OR timeout_ms >= 100)
);

COMMENT ON TABLE  jobs IS 'Primary high-volume job table. One row per submitted job.';
COMMENT ON COLUMN jobs.scheduled_at IS 'NULL = immediate. Set for delayed, scheduled, recurring types.';
COMMENT ON COLUMN jobs.next_attempt_at IS 'Set by retry logic after failure. Worker skips jobs where this is in the future.';
COMMENT ON COLUMN jobs.worker_id IS 'SET NULL when worker dies — makes job re-claimable.';
COMMENT ON COLUMN jobs.run_at IS 'Stamped when job transitions to running. Used for wait-time latency.';

-- ─── job_executions ──────────────────────────────────────────────────────────
-- One row per attempt. Separating execution history from the job itself:
--   • Keeps jobs table lean (no arrays, no JSONB arrays of attempts)
--   • Allows rich query: "show all retries for job X with timing"
--   • duration_ms is a GENERATED column — always consistent, zero maintenance

CREATE TABLE job_executions (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id         UUID         NOT NULL REFERENCES jobs(id)    ON DELETE CASCADE,
    worker_id      UUID         REFERENCES workers(id)          ON DELETE SET NULL,
    attempt_number SMALLINT     NOT NULL,

    status         VARCHAR(20)  NOT NULL,

    -- Timing
    started_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    finished_at    TIMESTAMPTZ,
    duration_ms    INT GENERATED ALWAYS AS (
        CASE
            WHEN finished_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (finished_at - started_at))::INT * 1000
            ELSE NULL
        END
    ) STORED,

    -- Outcome
    result         JSONB,
    error_message  TEXT,
    error_code     VARCHAR(64),
    exit_signal    VARCHAR(32),

    -- Retry scheduling
    next_retry_at  TIMESTAMPTZ,
    retry_delay_ms INT,

    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_job_executions_job_attempt  UNIQUE (job_id, attempt_number),
    CONSTRAINT chk_job_exec_attempt_number    CHECK  (attempt_number >= 1),
    CONSTRAINT chk_job_exec_status            CHECK  (status IN ('running','completed','failed','timed_out','cancelled')),
    CONSTRAINT chk_job_exec_finished_order    CHECK  (finished_at IS NULL OR finished_at >= started_at),
    CONSTRAINT chk_job_exec_retry_delay       CHECK  (retry_delay_ms IS NULL OR retry_delay_ms >= 0)
);

COMMENT ON TABLE  job_executions IS 'One row per attempt. Full retry history with per-attempt timing.';
COMMENT ON COLUMN job_executions.duration_ms IS 'GENERATED: (finished_at - started_at) in ms. Always consistent.';
COMMENT ON COLUMN job_executions.attempt_number IS 'Matches jobs.attempt_count at the time of this attempt.';

-- ─── job_logs ────────────────────────────────────────────────────────────────
-- High-volume append-only log. Uses BIGSERIAL (not UUID) for the PK because:
--   • Sequential inserts avoid index page splits (UUID is random = fragmentation)
--   • Faster bulk inserts during job execution
-- Partitioning by logged_at is recommended at scale (not done here — adds complexity).

CREATE TYPE log_level AS ENUM ('debug', 'info', 'warn', 'error');

CREATE TABLE job_logs (
    id           BIGSERIAL    PRIMARY KEY,
    job_id       UUID         NOT NULL REFERENCES jobs(id)           ON DELETE CASCADE,
    execution_id UUID         REFERENCES job_executions(id)          ON DELETE CASCADE,
    level        log_level    NOT NULL DEFAULT 'info',
    message      TEXT         NOT NULL,
    metadata     JSONB,
    logged_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  job_logs IS 'Append-only execution log. BIGSERIAL PK avoids UUID fragmentation at high insert rates.';
COMMENT ON COLUMN job_logs.execution_id IS 'Links log line to a specific attempt. NULL = job-level log.';
COMMENT ON COLUMN job_logs.metadata IS 'Optional structured context: {"step":"fetch","ms":42}.';

-- ============================================================
-- SECTION 6: SCHEDULED JOBS (cron / recurring definitions)
-- ============================================================

-- ─── scheduled_jobs ──────────────────────────────────────────────────────────
-- Template that the Scheduler service uses to spawn recurring jobs.
-- The Scheduler atomically:
--   1. Selects enabled rows WHERE next_run_at <= NOW()
--   2. Inserts a new job row (type = 'recurring')
--   3. Updates next_run_at and last_fired_at
-- skip_if_running prevents overlap (useful for long-running cron jobs).

CREATE TABLE scheduled_jobs (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    queue_id         UUID         NOT NULL REFERENCES queues(id)          ON DELETE CASCADE,
    retry_policy_id  UUID         REFERENCES retry_policies(id)           ON DELETE SET NULL,

    name             VARCHAR(256) NOT NULL,
    description      TEXT,
    cron_expression  VARCHAR(128) NOT NULL,
    timezone         VARCHAR(64)  NOT NULL DEFAULT 'UTC',

    payload_template JSONB        NOT NULL DEFAULT '{}',
    priority         SMALLINT     NOT NULL DEFAULT 5,
    timeout_ms       INT,
    max_attempts     SMALLINT     NOT NULL DEFAULT 3,

    enabled          BOOLEAN      NOT NULL DEFAULT TRUE,
    skip_if_running  BOOLEAN      NOT NULL DEFAULT FALSE,

    last_fired_at    TIMESTAMPTZ,
    next_run_at      TIMESTAMPTZ,
    last_job_id      UUID         REFERENCES jobs(id)                     ON DELETE SET NULL,

    run_count        BIGINT       NOT NULL DEFAULT 0,
    fail_count       BIGINT       NOT NULL DEFAULT 0,

    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_scheduled_jobs_queue_name UNIQUE (queue_id, name),
    CONSTRAINT chk_sched_priority    CHECK (priority     BETWEEN 1 AND 10),
    CONSTRAINT chk_sched_attempts    CHECK (max_attempts BETWEEN 1 AND 100),
    CONSTRAINT chk_sched_timeout     CHECK (timeout_ms   IS NULL OR timeout_ms >= 100),
    CONSTRAINT chk_sched_counts      CHECK (run_count >= 0 AND fail_count >= 0)
);

COMMENT ON TABLE  scheduled_jobs IS 'Cron/recurring job templates. Scheduler reads this table every N seconds.';
COMMENT ON COLUMN scheduled_jobs.skip_if_running IS 'TRUE = skip this fire if last_job_id is still running. Prevents overlap.';
COMMENT ON COLUMN scheduled_jobs.cron_expression IS 'Standard 5-field cron. Validated by application layer.';

-- Add the forward FK from jobs → scheduled_jobs now that the table exists
ALTER TABLE jobs
    ADD CONSTRAINT fk_jobs_scheduled_job
    FOREIGN KEY (scheduled_job_id)
    REFERENCES scheduled_jobs(id)
    ON DELETE SET NULL;

COMMENT ON COLUMN jobs.scheduled_job_id IS 'Non-NULL for recurring jobs — links to the definition that spawned them.';

-- ============================================================
-- SECTION 7: DEAD LETTER QUEUE
-- ============================================================

-- ─── dead_letter_jobs ────────────────────────────────────────────────────────
-- When a job exhausts max_attempts the application:
--   1. Sets jobs.status = 'dead'
--   2. Inserts a row here (denormalised snapshot for fast DLQ queries)
-- Keeping a snapshot (name, payload, errors) here means the DLQ API
-- can respond without JOINing back to jobs for every column.
-- requeued_job_id tracks manual re-queue actions.

CREATE TABLE dead_letter_jobs (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id              UUID         NOT NULL REFERENCES jobs(id)   ON DELETE CASCADE,
    queue_id            UUID         NOT NULL REFERENCES queues(id) ON DELETE CASCADE,

    -- Snapshot (denormalised for fast DLQ queries)
    name                VARCHAR(256) NOT NULL,
    payload             JSONB        NOT NULL DEFAULT '{}',

    -- Failure summary
    total_attempts      SMALLINT     NOT NULL,
    final_error_message TEXT,
    final_error_code    VARCHAR(64),
    first_failed_at     TIMESTAMPTZ  NOT NULL,
    last_failed_at      TIMESTAMPTZ  NOT NULL,
    moved_to_dlq_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- Re-queue tracking
    requeued_at         TIMESTAMPTZ,
    requeued_job_id     UUID         REFERENCES jobs(id)            ON DELETE SET NULL,
    requeued_by         UUID         REFERENCES users(id)           ON DELETE SET NULL,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_dlq_job_id         UNIQUE  (job_id),    -- one DLQ row per dead job
    CONSTRAINT chk_dlq_total_attempts CHECK   (total_attempts >= 1),
    CONSTRAINT chk_dlq_failed_order   CHECK   (last_failed_at >= first_failed_at)
);

COMMENT ON TABLE  dead_letter_jobs IS 'Snapshot of jobs that exhausted retries. Supports fast DLQ APIs without joining jobs.';
COMMENT ON COLUMN dead_letter_jobs.requeued_job_id IS 'Points to the new job created when this DLQ entry is manually re-queued.';

-- ============================================================
-- SECTION 8: METRICS (daily rollup)
-- ============================================================

-- ─── queue_metrics ───────────────────────────────────────────────────────────
-- Pre-aggregated daily stats per queue.
-- The Scheduler service updates this table at midnight or on job completion.
-- Stores percentile columns so dashboard graphs are O(1) queries.

CREATE TABLE queue_metrics (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    queue_id         UUID         NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
    date             DATE         NOT NULL,

    -- Throughput
    enqueued_count   BIGINT       NOT NULL DEFAULT 0,
    completed_count  BIGINT       NOT NULL DEFAULT 0,
    failed_count     BIGINT       NOT NULL DEFAULT 0,
    dead_count       BIGINT       NOT NULL DEFAULT 0,
    cancelled_count  BIGINT       NOT NULL DEFAULT 0,

    -- Wait time: enqueued_at → started_at
    avg_wait_ms      NUMERIC(12,2),
    p50_wait_ms      NUMERIC(12,2),
    p95_wait_ms      NUMERIC(12,2),
    p99_wait_ms      NUMERIC(12,2),

    -- Execution duration: started_at → finished_at
    avg_duration_ms  NUMERIC(12,2),
    p50_duration_ms  NUMERIC(12,2),
    p95_duration_ms  NUMERIC(12,2),
    p99_duration_ms  NUMERIC(12,2),

    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_queue_metrics_queue_date UNIQUE (queue_id, date),
    CONSTRAINT chk_metrics_counts CHECK (
        enqueued_count  >= 0 AND completed_count >= 0 AND
        failed_count    >= 0 AND dead_count      >= 0 AND
        cancelled_count >= 0
    )
);

COMMENT ON TABLE queue_metrics IS 'Daily rollup per queue. Pre-computed so dashboard graphs are O(1).';

-- ============================================================
-- SECTION 9: INDEXES
-- ============================================================
-- Every index is documented with:
--   WHY: the query pattern it supports
--   QUERY: the SQL it enables to use the index

-- ── jobs table (most critical) ────────────────────────────────────────────────

-- INDEX 1: Job Claim Query
-- WHY: The most performance-critical query in the system. Every worker runs this
--      every poll interval (default: 1 s). Without this index, a full table scan
--      on millions of rows would occur. Partial index on status='pending' keeps
--      the index small — only pending jobs are indexed.
-- QUERY:
--   SELECT * FROM jobs
--   WHERE queue_id = $1 AND status = 'pending'
--     AND (scheduled_at IS NULL OR scheduled_at <= NOW())
--     AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
--   ORDER BY priority DESC, enqueued_at ASC
--   LIMIT 1
--   FOR UPDATE SKIP LOCKED;

CREATE INDEX idx_jobs_claim
    ON jobs (queue_id, priority DESC, enqueued_at ASC)
    WHERE status = 'pending';

-- INDEX 2: Delayed / Scheduled Job Promotion
-- WHY: The Scheduler polls every 5 s for jobs whose scheduled_at has passed
--      and promotes them from 'scheduled' → 'pending'. Without this index, a
--      seq-scan on the full jobs table runs every 5 s.
-- QUERY:
--   SELECT id FROM jobs
--   WHERE status = 'scheduled' AND scheduled_at <= NOW()
--   ORDER BY scheduled_at ASC LIMIT 500;

CREATE INDEX idx_jobs_scheduled_promotion
    ON jobs (scheduled_at ASC)
    WHERE status = 'scheduled' AND scheduled_at IS NOT NULL;

-- INDEX 3: Failed Jobs Eligible for Retry
-- WHY: After a job fails, it transitions to status='failed' and next_attempt_at
--      is set. The Scheduler re-queues these by setting status='pending'.
-- QUERY:
--   SELECT id FROM jobs
--   WHERE status = 'failed' AND next_attempt_at <= NOW();

CREATE INDEX idx_jobs_retry_eligible
    ON jobs (next_attempt_at ASC)
    WHERE status = 'failed' AND next_attempt_at IS NOT NULL;

-- INDEX 4: Concurrency Check
-- WHY: Before a worker claims a job it checks the running count for the queue
--      against concurrency_limit. Without this index, COUNT(*) scans all jobs.
-- QUERY:
--   SELECT COUNT(*) FROM jobs
--   WHERE queue_id = $1 AND status = 'running';

CREATE INDEX idx_jobs_running_per_queue
    ON jobs (queue_id)
    WHERE status = 'running';

-- INDEX 5: Stale Job Detection (dead worker reaper)
-- WHY: The Scheduler periodically detects workers that missed heartbeats and
--      resets their running jobs back to 'pending'. This index finds all
--      'running' jobs by worker_id in O(log n).
-- QUERY:
--   UPDATE jobs SET status='pending', worker_id=NULL
--   WHERE worker_id = $1 AND status = 'running';

CREATE INDEX idx_jobs_running_by_worker
    ON jobs (worker_id)
    WHERE status = 'running' AND worker_id IS NOT NULL;

-- INDEX 6: Jobs List by Status (dashboard / API filtering)
-- WHY: The API supports filtering jobs by status and sorting by recency.
--      Covers: GET /queues/:id/jobs?status=failed&page=2
-- QUERY:
--   SELECT * FROM jobs
--   WHERE queue_id = $1 AND status = $2
--   ORDER BY updated_at DESC LIMIT 50;

CREATE INDEX idx_jobs_queue_status_updated
    ON jobs (queue_id, status, updated_at DESC);

-- INDEX 7: Jobs by Batch Group
-- WHY: Batch progress APIs fetch all children of a batch_group_id.
-- QUERY:
--   SELECT status, COUNT(*) FROM jobs
--   WHERE batch_group_id = $1 GROUP BY status;

CREATE INDEX idx_jobs_batch_group
    ON jobs (batch_group_id)
    WHERE batch_group_id IS NOT NULL;

-- INDEX 8: Recurring Jobs Lineage
-- WHY: "Show me all runs of this scheduled_job" requires filtering by
--      scheduled_job_id, sorted by creation time.
-- QUERY:
--   SELECT * FROM jobs
--   WHERE scheduled_job_id = $1
--   ORDER BY created_at DESC LIMIT 20;

CREATE INDEX idx_jobs_scheduled_job_id
    ON jobs (scheduled_job_id, created_at DESC)
    WHERE scheduled_job_id IS NOT NULL;

-- ── job_executions ────────────────────────────────────────────────────────────

-- INDEX 9: Retry History Lookup
-- WHY: GET /jobs/:id shows all attempts. Ordered by attempt_number.
--      The UNIQUE constraint creates this index, but documenting it explicitly.
-- QUERY:
--   SELECT * FROM job_executions
--   WHERE job_id = $1 ORDER BY attempt_number ASC;
-- (Covered by the UNIQUE constraint index on (job_id, attempt_number))

-- INDEX 10: Worker's Execution History
-- WHY: GET /workers/:id shows recent jobs a worker executed.
-- QUERY:
--   SELECT * FROM job_executions
--   WHERE worker_id = $1 ORDER BY started_at DESC LIMIT 20;

CREATE INDEX idx_job_executions_worker
    ON job_executions (worker_id, started_at DESC)
    WHERE worker_id IS NOT NULL;

-- ── job_logs ──────────────────────────────────────────────────────────────────

-- INDEX 11: Execution Log Retrieval
-- WHY: GET /jobs/:id/logs streams all log lines for a job in time order.
--      With millions of log rows, this must be an index seek, never a scan.
-- QUERY:
--   SELECT * FROM job_logs
--   WHERE job_id = $1 ORDER BY logged_at ASC;

CREATE INDEX idx_job_logs_job_time
    ON job_logs (job_id, logged_at ASC);

-- INDEX 12: Filter Logs by Level
-- WHY: Dashboard can filter logs by level (errors only).
-- QUERY:
--   SELECT * FROM job_logs
--   WHERE job_id = $1 AND level = 'error' ORDER BY logged_at ASC;

CREATE INDEX idx_job_logs_job_level
    ON job_logs (job_id, level, logged_at ASC);

-- ── workers ───────────────────────────────────────────────────────────────────

-- INDEX 13: Active Worker Heartbeat Monitor
-- WHY: The Scheduler must quickly find workers that haven't heartbeated
--      recently. Partial index limits scope to 'active' workers.
-- QUERY:
--   SELECT id FROM workers
--   WHERE status = 'active'
--     AND last_heartbeat_at < NOW() - INTERVAL '60 seconds';

CREATE INDEX idx_workers_active_heartbeat
    ON workers (last_heartbeat_at ASC)
    WHERE status = 'active';

-- INDEX 14: Workers by Project
-- WHY: GET /projects/:id/workers lists all workers for a project.
-- QUERY:
--   SELECT * FROM workers WHERE project_id = $1 ORDER BY registered_at DESC;

CREATE INDEX idx_workers_project
    ON workers (project_id, registered_at DESC);

-- ── worker_heartbeats ─────────────────────────────────────────────────────────

-- INDEX 15: Recent Heartbeats per Worker
-- WHY: GET /workers/:id/heartbeats returns last N heartbeats.
--      Also used by the cleanup job (DELETE WHERE created_at < NOW()-24h).
-- QUERY:
--   SELECT * FROM worker_heartbeats
--   WHERE worker_id = $1 ORDER BY created_at DESC LIMIT 60;

CREATE INDEX idx_worker_heartbeats_worker_time
    ON worker_heartbeats (worker_id, created_at DESC);

-- ── scheduled_jobs ────────────────────────────────────────────────────────────

-- INDEX 16: Cron Dispatcher Polling
-- WHY: The Scheduler polls this index every N seconds to find cron definitions
--      whose next_run_at has passed. Partial index on enabled=TRUE keeps it tiny.
-- QUERY:
--   SELECT * FROM scheduled_jobs
--   WHERE enabled = TRUE AND next_run_at <= NOW()
--   FOR UPDATE SKIP LOCKED;

CREATE INDEX idx_scheduled_jobs_due
    ON scheduled_jobs (next_run_at ASC)
    WHERE enabled = TRUE AND next_run_at IS NOT NULL;

-- ── dead_letter_jobs ──────────────────────────────────────────────────────────

-- INDEX 17: DLQ List by Queue
-- WHY: GET /queues/:id/dlq returns dead jobs newest-first.
-- QUERY:
--   SELECT * FROM dead_letter_jobs
--   WHERE queue_id = $1 AND requeued_at IS NULL
--   ORDER BY moved_to_dlq_at DESC LIMIT 50;

CREATE INDEX idx_dlq_queue_time
    ON dead_letter_jobs (queue_id, moved_to_dlq_at DESC)
    WHERE requeued_at IS NULL;

-- ── queue_metrics ─────────────────────────────────────────────────────────────

-- INDEX 18: Metrics Date Range
-- WHY: Dashboard time-series graphs query a date range per queue.
-- QUERY:
--   SELECT * FROM queue_metrics
--   WHERE queue_id = $1 AND date BETWEEN $2 AND $3
--   ORDER BY date ASC;
-- (Covered by UNIQUE constraint on (queue_id, date))

-- ── api_keys ──────────────────────────────────────────────────────────────────

-- INDEX 19: API Key Lookup (authenticate middleware hot path)
-- WHY: Every API request with x-api-key header hashes the key and looks it up.
--      Must be sub-millisecond. Covered by the UNIQUE constraint.
-- (Covered by UNIQUE constraint on key_hash)

-- ── organization_members ─────────────────────────────────────────────────────

-- INDEX 20: User's Organisations
-- WHY: "Which orgs does this user belong to?" — used on login and dashboard load.
-- QUERY:
--   SELECT o.* FROM organizations o
--   JOIN organization_members m ON m.organization_id = o.id
--   WHERE m.user_id = $1;

CREATE INDEX idx_org_members_user
    ON organization_members (user_id);

-- ============================================================
-- SECTION 10: AUTO-UPDATE updated_at TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- Apply to every table that has updated_at
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'users', 'organizations', 'organization_members', 'projects',
        'retry_policies', 'queues', 'workers', 'batch_groups',
        'jobs', 'scheduled_jobs', 'queue_metrics'
    ]
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%I_updated_at
             BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();',
            tbl, tbl
        );
    END LOOP;
END;
$$;

-- ============================================================
-- SECTION 11: BATCH COUNTER TRIGGER
-- ============================================================
-- Keeps batch_groups counters accurate without application-layer book-keeping.

CREATE OR REPLACE FUNCTION fn_update_batch_counts()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE batch_groups
        SET total_count   = total_count + 1,
            pending_count = pending_count + 1
        WHERE id = NEW.batch_group_id;

    ELSIF TG_OP = 'UPDATE' AND OLD.status <> NEW.status THEN
        UPDATE batch_groups SET
            pending_count   = pending_count   - (CASE WHEN OLD.status = 'pending'   THEN 1 ELSE 0 END) + (CASE WHEN NEW.status = 'pending'   THEN 1 ELSE 0 END),
            running_count   = running_count   - (CASE WHEN OLD.status = 'running'   THEN 1 ELSE 0 END) + (CASE WHEN NEW.status = 'running'   THEN 1 ELSE 0 END),
            completed_count = completed_count - (CASE WHEN OLD.status = 'completed' THEN 1 ELSE 0 END) + (CASE WHEN NEW.status = 'completed' THEN 1 ELSE 0 END),
            failed_count    = failed_count    - (CASE WHEN OLD.status = 'failed'    THEN 1 ELSE 0 END) + (CASE WHEN NEW.status = 'failed'    THEN 1 ELSE 0 END),
            dead_count      = dead_count      - (CASE WHEN OLD.status = 'dead'      THEN 1 ELSE 0 END) + (CASE WHEN NEW.status = 'dead'      THEN 1 ELSE 0 END)
        WHERE id = NEW.batch_group_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_jobs_batch_counts
AFTER INSERT OR UPDATE OF status ON jobs
FOR EACH ROW
WHEN (NEW.batch_group_id IS NOT NULL)
EXECUTE FUNCTION fn_update_batch_counts();

-- ============================================================
-- SECTION 12: VIEWS (convenience, not required for correctness)
-- ============================================================

-- v_pending_jobs: what the worker poll query looks like
CREATE VIEW v_pending_jobs AS
SELECT
    j.id,
    j.name,
    j.type             AS job_type,
    j.status           AS job_status,
    j.priority,
    j.payload,
    j.attempt_count,
    j.max_attempts,
    j.timeout_ms,
    j.scheduled_at,
    j.enqueued_at,
    q.project_id,
    q.concurrency_limit,
    q.status           AS queue_status
FROM jobs j
JOIN queues q ON q.id = j.queue_id
WHERE j.status = 'pending'
  AND q.status = 'active'
  AND (j.scheduled_at IS NULL OR j.scheduled_at <= NOW())
  AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= NOW());

COMMENT ON VIEW v_pending_jobs IS 'Claimable jobs: pending, queue active, past scheduled time.';

-- v_queue_stats: live concurrency view
CREATE VIEW v_queue_stats AS
SELECT
    q.id           AS queue_id,
    q.name         AS queue_name,
    q.status       AS queue_status,
    q.concurrency_limit,
    COUNT(j.id) FILTER (WHERE j.status = 'running')   AS running_count,
    COUNT(j.id) FILTER (WHERE j.status = 'pending')   AS pending_count,
    COUNT(j.id) FILTER (WHERE j.status = 'failed')    AS failed_count,
    COUNT(j.id) FILTER (WHERE j.status = 'dead')      AS dead_count,
    COUNT(j.id) FILTER (WHERE j.status = 'scheduled') AS scheduled_count
FROM queues q
LEFT JOIN jobs j ON j.queue_id = q.id
GROUP BY q.id, q.name, q.status, q.concurrency_limit;

COMMENT ON VIEW v_queue_stats IS 'Live per-queue job counts. Use for concurrency gate and dashboard.';

-- v_dead_workers: workers that missed heartbeat within 60 s
CREATE VIEW v_dead_workers AS
SELECT
    id,
    hostname,
    pid,
    last_heartbeat_at,
    NOW() - last_heartbeat_at AS silence_duration
FROM workers
WHERE status = 'active'
  AND last_heartbeat_at < NOW() - INTERVAL '60 seconds';

COMMENT ON VIEW v_dead_workers IS 'Active workers that have not heartbeated in >60s. Used by stale-job reaper.';

COMMIT;
