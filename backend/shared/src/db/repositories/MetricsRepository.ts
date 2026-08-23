import { Pool } from 'pg';

export interface SystemMetricsResponse {
  summary: {
    totalJobs: number;
    completedJobs: number;
    failedJobs: number;
    deadJobs: number;
    pendingJobs: number;
    runningJobs: number;
    scheduledJobs: number;
    cancelledJobs: number;
    retryCount: number;
    dlqCount: number;
  };
  executionDuration: {
    avgDurationMs: number;
    p50DurationMs: number;
    p95DurationMs: number;
    p99DurationMs: number;
    minDurationMs: number;
    maxDurationMs: number;
    totalExecutionsCount: number;
  };
  workers: {
    total: number;
    online: number;
    busy: number;
    unhealthy: number;
    stopped: number;
    totalConcurrencyCapacity: number;
    activeJobSlotsUsed: number;
  };
  queueDepths: Array<{
    queueId: string;
    queueName: string;
    priority: number;
    concurrencyLimit: number;
    status: string;
    pendingCount: number;
    runningCount: number;
  }>;
  timestamp: string;
}

export interface MetricsFilter {
  projectId?: string;
  queueId?: string;
}

export class MetricsRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Aggregate live system metrics across jobs, queues, executions, and workers.
   */
  async getSystemMetrics(filter: MetricsFilter = {}): Promise<SystemMetricsResponse> {
    const jobFilterConditions: string[] = [];
    const jobParams: unknown[] = [];
    let paramIndex = 1;

    if (filter.queueId) {
      jobFilterConditions.push(`j.queue_id = $${paramIndex++}`);
      jobParams.push(filter.queueId);
    } else if (filter.projectId) {
      jobFilterConditions.push(`q.project_id = $${paramIndex++}`);
      jobParams.push(filter.projectId);
    }

    const jobWhere =
      jobFilterConditions.length > 0 ? `WHERE ${jobFilterConditions.join(' AND ')}` : '';

    // 1. Job Status & Retry Aggregations
    const jobStatsQuery = `
      SELECT
        COUNT(*)::int AS total_jobs,
        COUNT(*) FILTER (WHERE j.status = 'completed')::int AS completed_jobs,
        COUNT(*) FILTER (WHERE j.status = 'failed')::int AS failed_jobs,
        COUNT(*) FILTER (WHERE j.status = 'dead')::int AS dead_jobs,
        COUNT(*) FILTER (WHERE j.status = 'pending')::int AS pending_jobs,
        COUNT(*) FILTER (WHERE j.status = 'running')::int AS running_jobs,
        COUNT(*) FILTER (WHERE j.status = 'scheduled')::int AS scheduled_jobs,
        COUNT(*) FILTER (WHERE j.status = 'cancelled')::int AS cancelled_jobs,
        COALESCE(
          (
            SELECT COUNT(*)::int
            FROM job_executions je
            JOIN jobs j2 ON j2.id = je.job_id
            JOIN queues q2 ON q2.id = j2.queue_id
            WHERE (je.attempt_number > 1 OR je.next_retry_at IS NOT NULL)
            ${filter.queueId ? `AND j2.queue_id = '${filter.queueId}'` : filter.projectId ? `AND q2.project_id = '${filter.projectId}'` : ''}
          ),
          0
        )::int AS retry_count
      FROM jobs j
      JOIN queues q ON q.id = j.queue_id
      ${jobWhere}
    `;

    // 2. DLQ Count
    const dlqQuery = `
      SELECT COUNT(*)::int AS dlq_count
      FROM dead_letter_jobs dlj
      JOIN queues q ON q.id = dlj.queue_id
      ${filter.queueId ? `WHERE dlj.queue_id = $1` : filter.projectId ? `WHERE q.project_id = $1` : ''}
    `;
    const dlqParams = filter.queueId ? [filter.queueId] : filter.projectId ? [filter.projectId] : [];

    // 3. Execution Duration Percentiles (completed executions)
    const durationQuery = `
      SELECT
        COALESCE(AVG(je.duration_ms), 0)::float AS avg_duration_ms,
        COALESCE(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY je.duration_ms), 0)::float AS p50_duration_ms,
        COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY je.duration_ms), 0)::float AS p95_duration_ms,
        COALESCE(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY je.duration_ms), 0)::float AS p99_duration_ms,
        COALESCE(MIN(je.duration_ms), 0)::float AS min_duration_ms,
        COALESCE(MAX(je.duration_ms), 0)::float AS max_duration_ms,
        COUNT(*)::int AS total_executions_count
      FROM job_executions je
      JOIN jobs j ON j.id = je.job_id
      JOIN queues q ON q.id = j.queue_id
      WHERE je.status = 'completed' AND je.duration_ms IS NOT NULL
      ${filter.queueId ? `AND j.queue_id = $1` : filter.projectId ? `AND q.project_id = $1` : ''}
    `;

    // 4. Worker Telemetry & Health
    const workerConditions: string[] = [];
    const workerParams: unknown[] = [];
    if (filter.projectId) {
      workerConditions.push(`w.project_id = $1`);
      workerParams.push(filter.projectId);
    }
    const workerWhere = workerConditions.length > 0 ? `WHERE ${workerConditions.join(' AND ')}` : '';

    const workerQuery = `
      SELECT
        COUNT(*)::int AS total_workers,
        COUNT(*) FILTER (WHERE w.status = 'online')::int AS online_workers,
        COUNT(*) FILTER (WHERE w.status = 'busy')::int AS busy_workers,
        COUNT(*) FILTER (WHERE w.status = 'unhealthy')::int AS unhealthy_workers,
        COUNT(*) FILTER (WHERE w.status IN ('stopped', 'offline'))::int AS stopped_workers,
        COALESCE(SUM(w.max_concurrency), 0)::int AS total_capacity,
        COALESCE(SUM(w.current_job_count), 0)::int AS used_capacity
      FROM workers w
      ${workerWhere}
    `;

    // 5. Per-Queue Depths
    const queueDepthQuery = `
      SELECT
        q.id AS queue_id,
        q.name AS queue_name,
        q.priority,
        q.concurrency_limit,
        q.status,
        COUNT(j.id) FILTER (WHERE j.status = 'pending')::int AS pending_count,
        COUNT(j.id) FILTER (WHERE j.status = 'running')::int AS running_count
      FROM queues q
      LEFT JOIN jobs j ON j.queue_id = q.id
      ${filter.projectId ? `WHERE q.project_id = $1` : ''}
      GROUP BY q.id, q.name, q.priority, q.concurrency_limit, q.status
      ORDER BY q.priority DESC, q.name ASC
    `;
    const queueDepthParams = filter.projectId ? [filter.projectId] : [];

    const [jobStatsRes, dlqRes, durationRes, workerRes, queueDepthRes] = await Promise.all([
      this.pool.query(jobStatsQuery, jobParams),
      this.pool.query(dlqQuery, dlqParams),
      this.pool.query(durationQuery, dlqParams),
      this.pool.query(workerQuery, workerParams),
      this.pool.query(queueDepthQuery, queueDepthParams),
    ]);

    const js = jobStatsRes.rows[0] ?? {};
    const ds = dlqRes.rows[0] ?? {};
    const dur = durationRes.rows[0] ?? {};
    const ws = workerRes.rows[0] ?? {};

    return {
      summary: {
        totalJobs: js.total_jobs ?? 0,
        completedJobs: js.completed_jobs ?? 0,
        failedJobs: js.failed_jobs ?? 0,
        deadJobs: js.dead_jobs ?? 0,
        pendingJobs: js.pending_jobs ?? 0,
        runningJobs: js.running_jobs ?? 0,
        scheduledJobs: js.scheduled_jobs ?? 0,
        cancelledJobs: js.cancelled_jobs ?? 0,
        retryCount: js.retry_count ?? 0,
        dlqCount: ds.dlq_count ?? 0,
      },
      executionDuration: {
        avgDurationMs: Math.round((dur.avg_duration_ms ?? 0) * 100) / 100,
        p50DurationMs: Math.round((dur.p50_duration_ms ?? 0) * 100) / 100,
        p95DurationMs: Math.round((dur.p95_duration_ms ?? 0) * 100) / 100,
        p99DurationMs: Math.round((dur.p99_duration_ms ?? 0) * 100) / 100,
        minDurationMs: Math.round((dur.min_duration_ms ?? 0) * 100) / 100,
        maxDurationMs: Math.round((dur.max_duration_ms ?? 0) * 100) / 100,
        totalExecutionsCount: dur.total_executions_count ?? 0,
      },
      workers: {
        total: ws.total_workers ?? 0,
        online: ws.online_workers ?? 0,
        busy: ws.busy_workers ?? 0,
        unhealthy: ws.unhealthy_workers ?? 0,
        stopped: ws.stopped_workers ?? 0,
        totalConcurrencyCapacity: ws.total_capacity ?? 0,
        activeJobSlotsUsed: ws.used_capacity ?? 0,
      },
      queueDepths: queueDepthRes.rows.map((r) => ({
        queueId: r.queue_id,
        queueName: r.queue_name,
        priority: parseInt(r.priority, 10),
        concurrencyLimit: parseInt(r.concurrency_limit, 10),
        status: r.status,
        pendingCount: parseInt(r.pending_count, 10),
        runningCount: parseInt(r.running_count, 10),
      })),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Format metrics in standard Prometheus exposition format.
   */
  async getPrometheusMetrics(filter: MetricsFilter = {}): Promise<string> {
    const data = await this.getSystemMetrics(filter);

    const lines: string[] = [
      '# HELP job_scheduler_jobs_total Total number of jobs by status',
      '# TYPE job_scheduler_jobs_total gauge',
      `job_scheduler_jobs_total{status="completed"} ${data.summary.completedJobs}`,
      `job_scheduler_jobs_total{status="failed"} ${data.summary.failedJobs}`,
      `job_scheduler_jobs_total{status="dead"} ${data.summary.deadJobs}`,
      `job_scheduler_jobs_total{status="pending"} ${data.summary.pendingJobs}`,
      `job_scheduler_jobs_total{status="running"} ${data.summary.runningJobs}`,
      `job_scheduler_jobs_total{status="scheduled"} ${data.summary.scheduledJobs}`,
      `job_scheduler_jobs_total{status="cancelled"} ${data.summary.cancelledJobs}`,
      '',
      '# HELP job_scheduler_retries_total Total retry attempts triggered',
      '# TYPE job_scheduler_retries_total counter',
      `job_scheduler_retries_total ${data.summary.retryCount}`,
      '',
      '# HELP job_scheduler_dlq_total Total dead letter jobs',
      '# TYPE job_scheduler_dlq_total gauge',
      `job_scheduler_dlq_total ${data.summary.dlqCount}`,
      '',
      '# HELP job_scheduler_execution_duration_ms Job execution duration in ms',
      '# TYPE job_scheduler_execution_duration_ms gauge',
      `job_scheduler_execution_duration_ms{stat="avg"} ${data.executionDuration.avgDurationMs}`,
      `job_scheduler_execution_duration_ms{stat="p50"} ${data.executionDuration.p50DurationMs}`,
      `job_scheduler_execution_duration_ms{stat="p95"} ${data.executionDuration.p95DurationMs}`,
      `job_scheduler_execution_duration_ms{stat="p99"} ${data.executionDuration.p99DurationMs}`,
      '',
      '# HELP job_scheduler_workers_total Total registered workers by health status',
      '# TYPE job_scheduler_workers_total gauge',
      `job_scheduler_workers_total{status="online"} ${data.workers.online}`,
      `job_scheduler_workers_total{status="busy"} ${data.workers.busy}`,
      `job_scheduler_workers_total{status="unhealthy"} ${data.workers.unhealthy}`,
      `job_scheduler_workers_total{status="stopped"} ${data.workers.stopped}`,
      '',
      '# HELP job_scheduler_worker_concurrency_slots Total and used worker execution slots',
      '# TYPE job_scheduler_worker_concurrency_slots gauge',
      `job_scheduler_worker_concurrency_slots{type="total"} ${data.workers.totalConcurrencyCapacity}`,
      `job_scheduler_worker_concurrency_slots{type="used"} ${data.workers.activeJobSlotsUsed}`,
    ];

    for (const q of data.queueDepths) {
      lines.push(
        `job_scheduler_queue_depth{queue="${q.queueName}",status="pending"} ${q.pendingCount}`,
        `job_scheduler_queue_depth{queue="${q.queueName}",status="running"} ${q.runningCount}`
      );
    }

    return lines.join('\n') + '\n';
  }
}
