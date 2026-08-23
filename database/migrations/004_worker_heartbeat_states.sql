-- Migration 004: Worker Heartbeat States & Telemetry Enhancements

ALTER TYPE worker_status ADD VALUE IF NOT EXISTS 'online';
ALTER TYPE worker_status ADD VALUE IF NOT EXISTS 'busy';
ALTER TYPE worker_status ADD VALUE IF NOT EXISTS 'unhealthy';
ALTER TYPE worker_status ADD VALUE IF NOT EXISTS 'stopped';

-- Additional indexes for fast stale worker queries
CREATE INDEX IF NOT EXISTS idx_workers_heartbeat_status
    ON workers (status, last_heartbeat_at DESC);

CREATE INDEX IF NOT EXISTS idx_workers_project_status
    ON workers (project_id, status);
