import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { StatsCard } from '../components/StatsCard';
import { StatusBadge } from '../components/StatusBadge';
import {
  Activity,
  CheckCircle,
  AlertTriangle,
  RotateCcw,
  Skull,
  Layers,
  RefreshCw,
  ArrowRight,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts';

export const DashboardPage: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const navigate = useNavigate();

  const fetchMetrics = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const res = await apiClient.get('/metrics');
      if (res.data?.data) {
        setMetrics(res.data.data);
      }
    } catch {
      // Ignore if unauthenticated or error
    } finally {
      setLoading(false);
      if (isManual) setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchMetrics();
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  if (loading && !metrics) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  const summary = metrics?.summary || {
    totalJobs: 0,
    completedJobs: 0,
    failedJobs: 0,
    deadJobs: 0,
    pendingJobs: 0,
    runningJobs: 0,
    scheduledJobs: 0,
    retryCount: 0,
    dlqCount: 0,
  };

  const workers = metrics?.workers || {
    total: 0,
    online: 0,
    busy: 0,
    unhealthy: 0,
    stopped: 0,
    totalConcurrencyCapacity: 0,
    activeJobSlotsUsed: 0,
  };

  const executionDuration = metrics?.executionDuration || {
    avgDurationMs: 0,
    p50DurationMs: 0,
    p95DurationMs: 0,
    p99DurationMs: 0,
  };

  const queueDepths = metrics?.queueDepths || [];

  // Latency chart data from true percentiles
  const latencyData = [
    { name: 'Min', duration: Math.round(executionDuration.minDurationMs || 0) },
    { name: 'p50', duration: Math.round(executionDuration.p50DurationMs || 0) },
    { name: 'Avg', duration: Math.round(executionDuration.avgDurationMs || 0) },
    { name: 'p95', duration: Math.round(executionDuration.p95DurationMs || 0) },
    { name: 'p99', duration: Math.round(executionDuration.p99DurationMs || 0) },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">System Telemetry & Metrics</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Real-time throughput, queue depth, and worker health monitoring
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded bg-gray-950 border-gray-800 text-blue-600 focus:ring-0"
            />
            <span>Auto-refresh (5s)</span>
          </label>
          <button
            onClick={() => fetchMetrics(true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-900 border border-gray-800 hover:border-gray-700 text-xs font-semibold text-gray-300 hover:text-white transition-all shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {!isAuthenticated && (
        <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-bold">⚡ Public Mode:</span>
            <span>You are viewing system-wide metrics. Sign in or register to manage your own organizations, projects, and queues.</span>
          </div>
          <button
            onClick={() => navigate('/login')}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg shrink-0"
          >
            Sign In / Register
          </button>
        </div>
      )}

      {/* ── Key Stats Cards ─────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatsCard
          title="Total Jobs"
          value={summary.totalJobs}
          icon={Layers}
          color="blue"
          onClick={() => navigate('/jobs')}
        />
        <StatsCard
          title="Running Jobs"
          value={summary.runningJobs}
          icon={Activity}
          color="amber"
          onClick={() => navigate('/jobs?status=running')}
        />
        <StatsCard
          title="Completed"
          value={summary.completedJobs}
          icon={CheckCircle}
          color="emerald"
          onClick={() => navigate('/jobs?status=completed')}
        />
        <StatsCard
          title="Retrying"
          value={summary.retryCount}
          icon={RotateCcw}
          color="purple"
          onClick={() => navigate('/jobs?status=failed')}
        />
        <StatsCard
          title="Failed"
          value={summary.failedJobs}
          icon={AlertTriangle}
          color="rose"
          onClick={() => navigate('/jobs?status=failed')}
        />
        <StatsCard
          title="DLQ Quarantined"
          value={summary.dlqCount}
          icon={Skull}
          color="rose"
          onClick={() => navigate('/dlq')}
        />
      </div>

      {/* ── Middle Section: Latency & Worker Fleet ─────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Latency Percentiles */}
        <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-white">Execution Latency (ms)</h2>
              <p className="text-xs text-gray-400">Duration percentiles across completed jobs</p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="text-gray-400">
                Avg: <strong className="text-white">{executionDuration.avgDurationMs} ms</strong>
              </span>
              <span className="text-gray-400">
                p95: <strong className="text-white">{executionDuration.p95DurationMs} ms</strong>
              </span>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={latencyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
                <YAxis stroke="#64748b" fontSize={12} unit="ms" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                  labelStyle={{ color: '#f8fafc' }}
                />
                <Bar dataKey="duration" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Worker Fleet Telemetry */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-white">Worker Fleet Status</h2>
              <button
                onClick={() => navigate('/workers')}
                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 font-medium"
              >
                <span>View All</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-4">
              Real-time liveness and cluster capacity
            </p>

            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-lg bg-gray-950 border border-gray-800/80">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <span className="text-sm font-medium text-gray-300">Online Workers</span>
                </div>
                <span className="text-sm font-bold text-white">{workers.online}</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-gray-950 border border-gray-800/80">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                  <span className="text-sm font-medium text-gray-300">Busy (At Capacity)</span>
                </div>
                <span className="text-sm font-bold text-white">{workers.busy}</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-gray-950 border border-gray-800/80">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
                  <span className="text-sm font-medium text-gray-300">Unhealthy (Stale)</span>
                </div>
                <span className="text-sm font-bold text-rose-400">{workers.unhealthy}</span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-800">
            <div className="flex justify-between text-xs text-gray-400 mb-1.5">
              <span>Cluster Capacity Utilization</span>
              <span className="font-semibold text-white">
                {workers.activeJobSlotsUsed} / {workers.totalConcurrencyCapacity} slots
              </span>
            </div>
            <div className="w-full h-2 bg-gray-950 rounded-full overflow-hidden border border-gray-800">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{
                  width: `${
                    workers.totalConcurrencyCapacity > 0
                      ? Math.min(100, (workers.activeJobSlotsUsed / workers.totalConcurrencyCapacity) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom Section: Active Queues Breakdown ────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-white">Queue Depths & Backlog</h2>
            <p className="text-xs text-gray-400">Pending vs. In-flight jobs per queue</p>
          </div>
          <button
            onClick={() => navigate('/queues')}
            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 font-medium"
          >
            <span>Manage Queues</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>

        {queueDepths.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-500">No queues configured yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-gray-400 border-b border-gray-800 bg-gray-950/40">
                <tr>
                  <th className="py-3 px-4">Queue</th>
                  <th className="py-3 px-4">Priority</th>
                  <th className="py-3 px-4">Concurrency</th>
                  <th className="py-3 px-4">Pending (Backlog)</th>
                  <th className="py-3 px-4">In-Flight</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {queueDepths.map((q: any) => (
                  <tr key={q.queueId} className="hover:bg-gray-850/50 transition-colors">
                    <td className="py-3.5 px-4 font-semibold text-white">{q.queueName}</td>
                    <td className="py-3.5 px-4 text-gray-300">P{q.priority}</td>
                    <td className="py-3.5 px-4 text-gray-300">{q.concurrencyLimit} max</td>
                    <td className="py-3.5 px-4">
                      <span className="font-semibold text-amber-400">{q.pendingCount}</span>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="font-semibold text-blue-400">{q.runningCount}</span>
                    </td>
                    <td className="py-3.5 px-4">
                      <StatusBadge status={q.status} type="queue" />
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => navigate(`/queues/${q.queueId}`)}
                        className="text-xs font-semibold text-blue-400 hover:text-blue-300"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
