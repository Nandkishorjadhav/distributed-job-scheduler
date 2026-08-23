-- Migration 003: Dead Letter Queue (DLQ) Enhancements

ALTER TABLE dead_letter_jobs
ADD COLUMN IF NOT EXISTS failed_worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'unhandled',
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Indexes for high-performance DLQ queries
CREATE INDEX IF NOT EXISTS idx_dlq_queue_status_moved
    ON dead_letter_jobs (queue_id, status, moved_to_dlq_at DESC);

CREATE INDEX IF NOT EXISTS idx_dlq_status_moved
    ON dead_letter_jobs (status, moved_to_dlq_at DESC);

CREATE INDEX IF NOT EXISTS idx_dlq_error_code
    ON dead_letter_jobs (final_error_code)
    WHERE final_error_code IS NOT NULL;
