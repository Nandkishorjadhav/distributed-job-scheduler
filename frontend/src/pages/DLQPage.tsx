import React, { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { StatsCard } from '../components/StatsCard';
import {
  Skull,
  RotateCcw,
  Archive,
  Trash2,
  AlertTriangle,
  Search,
  RefreshCw,
  XCircle,
} from 'lucide-react';

export const DLQPage: React.FC = () => {
  const [dlqJobs, setDlqJobs] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [queues, setQueues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [queueFilter, setQueueFilter] = useState('');

  // Inspect Snapshot Modal
  const [selectedDlqJob, setSelectedDlqJob] = useState<any>(null);
  const [dlqDetails, setDlqDetails] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const fetchDLQ = async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      if (queueFilter) params.set('queueId', queueFilter);

      const [dlqRes, statsRes, queuesRes] = await Promise.all([
        apiClient.get(`/dlq?${params.toString()}`),
        apiClient.get('/dlq/stats'),
        apiClient.get('/queues'),
      ]);

      if (dlqRes.data?.data) setDlqJobs(dlqRes.data.data);
      if (statsRes.data?.data) setStats(statsRes.data.data);
      if (queuesRes.data?.data) setQueues(queuesRes.data.data);
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDLQ();
  }, [statusFilter, queueFilter]);

  const handleRetry = async (dlqId: string) => {
    try {
      await apiClient.post(`/dlq/${dlqId}/retry`);
      fetchDLQ();
      if (selectedDlqJob?.id === dlqId) {
        setSelectedDlqJob(null);
      }
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to re-queue DLQ job');
    }
  };

  const handleArchive = async (dlqId: string) => {
    try {
      await apiClient.post(`/dlq/${dlqId}/archive`);
      fetchDLQ();
      if (selectedDlqJob?.id === dlqId) {
        setSelectedDlqJob(null);
      }
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to archive DLQ job');
    }
  };

  const handleDelete = async (dlqId: string) => {
    if (!confirm('Permanently delete this DLQ job?')) return;
    try {
      await apiClient.delete(`/dlq/${dlqId}`);
      fetchDLQ();
      if (selectedDlqJob?.id === dlqId) {
        setSelectedDlqJob(null);
      }
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete DLQ job');
    }
  };

  const handleInspect = async (job: any) => {
    setSelectedDlqJob(job);
    setLoadingDetails(true);
    try {
      const res = await apiClient.get(`/dlq/${job.id}`);
      if (res.data?.data) {
        setDlqDetails(res.data.data);
      }
    } catch {
      // Ignore
    } finally {
      setLoadingDetails(false);
    }
  };

  const summary = stats?.summary || {
    totalDead: 0,
    unhandled: 0,
    retried: 0,
    archived: 0,
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Dead Letter Queue (DLQ)</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Quarantine area for jobs that permanently failed or exhausted maximum retry attempts
          </p>
        </div>
        <button
          onClick={fetchDLQ}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-900 border border-gray-800 hover:border-gray-700 text-xs font-semibold text-gray-300 hover:text-white transition-all shadow-sm"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh DLQ</span>
        </button>
      </div>

      {/* Summary Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatsCard title="Total Quarantined" value={summary.totalDead} icon={Skull} color="rose" />
        <StatsCard
          title="Unhandled (Needs Action)"
          value={summary.unhandled}
          icon={AlertTriangle}
          color="amber"
        />
        <StatsCard
          title="Re-queued & Retried"
          value={summary.retried}
          icon={RotateCcw}
          color="blue"
        />
        <StatsCard title="Archived" value={summary.archived} icon={Archive} color="gray" />
      </div>

      {/* Filter Bar */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 shadow-sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            fetchDLQ();
          }}
          className="grid grid-cols-1 sm:grid-cols-3 gap-3"
        >
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-3 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search error message, job name..."
              className="w-full bg-gray-950 border border-gray-800 rounded-xl pl-9 pr-4 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
            >
              <option value="">All Statuses</option>
              <option value="unhandled">Unhandled</option>
              <option value="retried">Retried</option>
              <option value="archived">Archived</option>
            </select>
          </div>

          <div>
            <select
              value={queueFilter}
              onChange={(e) => setQueueFilter(e.target.value)}
              className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
            >
              <option value="">All Queues</option>
              {queues.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name}
                </option>
              ))}
            </select>
          </div>
        </form>
      </div>

      {/* DLQ Jobs Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : dlqJobs.length === 0 ? (
          <div className="text-center py-16 text-gray-500 text-sm">
            No dead letter jobs quarantined! All queues are healthy.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-gray-400 border-b border-gray-800 bg-gray-950/50">
                <tr>
                  <th className="py-3.5 px-4">Job Name / Queue</th>
                  <th className="py-3.5 px-4">Failure Reason</th>
                  <th className="py-3.5 px-4">Attempts</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Quarantined At</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {dlqJobs.map((job) => (
                  <tr key={job.id} className="hover:bg-gray-850/50 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-white">{job.name}</div>
                      <div className="text-xs text-gray-500">{job.queueName || 'Queue'}</div>
                    </td>
                    <td className="py-3.5 px-4 max-w-xs">
                      <span className="font-mono text-xs text-rose-400 truncate block">
                        {job.finalErrorMessage || 'Execution failed'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-xs font-bold text-gray-300">
                      {job.totalAttempts} attempts
                    </td>
                    <td className="py-3.5 px-4">
                      <StatusBadge status={job.status} type="dlq" />
                    </td>
                    <td className="py-3.5 px-4 text-xs text-gray-400">
                      {new Date(job.lastFailedAt).toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleRetry(job.id)}
                          className="p-1 text-blue-400 hover:bg-gray-800 rounded-lg"
                          title="Re-queue (Retry)"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleArchive(job.id)}
                          className="p-1 text-gray-400 hover:bg-gray-800 rounded-lg"
                          title="Archive"
                        >
                          <Archive className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(job.id)}
                          className="p-1 text-rose-400 hover:bg-gray-800 rounded-lg"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleInspect(job)}
                          className="px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs font-semibold text-blue-400 hover:text-blue-300"
                        >
                          Inspect
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Inspect DLQ Snapshot */}
      {selectedDlqJob && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Skull className="w-5 h-5 text-rose-400" />
                  <span>{selectedDlqJob.name}</span>
                  <StatusBadge status={selectedDlqJob.status} type="dlq" />
                </h2>
                <p className="text-xs text-gray-500 font-mono mt-0.5">
                  Job ID: {selectedDlqJob.jobId}
                </p>
              </div>
              <button
                onClick={() => {
                  setSelectedDlqJob(null);
                  setDlqDetails(null);
                }}
                className="p-1 text-gray-400 hover:text-white"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            {loadingDetails ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-6 h-6 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
              </div>
            ) : (
              <div className="space-y-4 text-xs">
                {/* Failure Error Message */}
                <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 font-mono">
                  <div className="font-bold mb-1">
                    Error Code: {selectedDlqJob.finalErrorCode || 'ERR_MAX_RETRIES_EXCEEDED'}
                  </div>
                  <div>{selectedDlqJob.finalErrorMessage}</div>
                </div>

                {/* Input Payload */}
                <div>
                  <h3 className="font-bold text-gray-300 uppercase tracking-wider mb-1">
                    Job Payload
                  </h3>
                  <pre className="p-3 bg-gray-950 border border-gray-800 rounded-lg font-mono text-blue-300 overflow-x-auto">
                    {JSON.stringify(selectedDlqJob.payload, null, 2)}
                  </pre>
                </div>

                {dlqDetails?.logs && dlqDetails.logs.length > 0 && (
                  <div>
                    <h3 className="font-bold text-gray-300 uppercase tracking-wider mb-1">
                      Failure Logs
                    </h3>
                    <div className="bg-gray-950 border border-gray-800 rounded-lg p-2.5 max-h-32 overflow-y-auto space-y-1 font-mono text-[11px] text-gray-400">
                      {dlqDetails.logs.map((l: any) => (
                        <div key={l.id} className="truncate">
                          <span className="text-rose-400 font-bold">[{l.level}]</span> {l.message}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions Footer */}
                <div className="flex items-center justify-between pt-4 border-t border-gray-800">
                  <span className="text-gray-500">
                    Failed Worker:{' '}
                    <strong className="text-gray-300 font-mono">
                      {selectedDlqJob.failedWorkerId || 'Unknown'}
                    </strong>
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleRetry(selectedDlqJob.id)}
                      className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-semibold shadow-md"
                    >
                      Re-queue (Retry)
                    </button>
                    <button
                      onClick={() => handleArchive(selectedDlqJob.id)}
                      className="px-3.5 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl font-semibold"
                    >
                      Archive
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
