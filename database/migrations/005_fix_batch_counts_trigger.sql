-- Migration 005: Fix fn_update_batch_counts trigger function to eliminate duplicate target column assignment in UPDATE ... SET clause

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
