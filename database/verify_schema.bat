@echo off
SET PGPASSWORD=password
SET PSQL=C:\Program Files\PostgreSQL\17\bin\psql.exe

echo === TABLES ===
"%PSQL%" -U postgres -h 127.0.0.1 -p 5432 -d job_scheduler -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name;"

echo.
echo === CUSTOM INDEXES ===
"%PSQL%" -U postgres -h 127.0.0.1 -p 5432 -d job_scheduler -c "SELECT tablename, indexname FROM pg_indexes WHERE schemaname='public' AND indexname LIKE 'idx_%%' ORDER BY tablename, indexname;"

echo.
echo === VIEWS ===
"%PSQL%" -U postgres -h 127.0.0.1 -p 5432 -d job_scheduler -c "SELECT viewname FROM pg_views WHERE schemaname='public' ORDER BY viewname;"

echo.
echo === ENUM TYPES ===
"%PSQL%" -U postgres -h 127.0.0.1 -p 5432 -d job_scheduler -c "SELECT typname, string_agg(enumlabel, ', ' ORDER BY enumsortorder) AS values FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typcategory='E' GROUP BY typname ORDER BY typname;"

echo.
echo === TRIGGERS ===
"%PSQL%" -U postgres -h 127.0.0.1 -p 5432 -d job_scheduler -c "SELECT trigger_name, event_object_table, event_manipulation FROM information_schema.triggers WHERE trigger_schema='public' ORDER BY event_object_table, trigger_name;"

echo.
echo === SEED ROW COUNTS ===
"%PSQL%" -U postgres -h 127.0.0.1 -p 5432 -d job_scheduler -c "SELECT 'users' AS tbl, COUNT(*) FROM users UNION ALL SELECT 'organizations', COUNT(*) FROM organizations UNION ALL SELECT 'organization_members', COUNT(*) FROM organization_members UNION ALL SELECT 'projects', COUNT(*) FROM projects UNION ALL SELECT 'retry_policies', COUNT(*) FROM retry_policies UNION ALL SELECT 'queues', COUNT(*) FROM queues UNION ALL SELECT 'workers', COUNT(*) FROM workers UNION ALL SELECT 'jobs', COUNT(*) FROM jobs UNION ALL SELECT 'job_executions', COUNT(*) FROM job_executions UNION ALL SELECT 'job_logs', COUNT(*) FROM job_logs UNION ALL SELECT 'scheduled_jobs', COUNT(*) FROM scheduled_jobs UNION ALL SELECT 'dead_letter_jobs', COUNT(*) FROM dead_letter_jobs UNION ALL SELECT 'queue_metrics', COUNT(*) FROM queue_metrics ORDER BY tbl;"

echo.
echo === CRITICAL CLAIM QUERY TEST (should use idx_jobs_claim) ===
"%PSQL%" -U postgres -h 127.0.0.1 -p 5432 -d job_scheduler -c "EXPLAIN (FORMAT TEXT) SELECT id FROM jobs WHERE status='pending' AND (scheduled_at IS NULL OR scheduled_at <= NOW()) AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()) ORDER BY priority DESC, enqueued_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED;"

echo.
echo === VIEW: v_pending_jobs ===
"%PSQL%" -U postgres -h 127.0.0.1 -p 5432 -d job_scheduler -c "SELECT id, name, type, status, priority FROM v_pending_jobs;"

echo.
echo === VIEW: v_queue_stats ===
"%PSQL%" -U postgres -h 127.0.0.1 -p 5432 -d job_scheduler -c "SELECT queue_name, queue_status, concurrency_limit, running_count, pending_count FROM v_queue_stats;"

echo DONE
