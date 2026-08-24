import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import {
  ArrowLeft,
  RotateCcw,
  XCircle,
  Terminal,
  AlertTriangle,
  CheckCircle2,
  History,
} from 'lucide-react';

export const JobDetailsPage: React.FC = () => {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();

  const [jobHistory, setJobHistory] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [logFilter, setLogFilter] = useState('');

  const fetchJob = async () => {
    try {
      const res = await apiClient.get(`/jobs/${jobId}/history`);
      if (res.data?.data) {
        setJobHistory(res.data.data);
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJob();
    const interval = setInterval(fetchJob, 3000);
    return () => clearInterval(interval);
  }, [jobId]);

  const handleRetry = async () => {
    try {
      await apiClient.post(`/jobs/${jobId}/retry`);
      fetchJob();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to retry job');
    }
  };

  const handleCancel = async () => {
    if (!confirm('Cancel this job?')) return;
    try {
      await apiClient.post(`/jobs/${jobId}/cancel`);
      fetchJob();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to cancel job');
    }
  };

  if (loading && !jobHistory) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="w-8 h-8 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  const job = jobHistory?.job;
  const executions = jobHistory?.executions || [];
  const logs = jobHistory?.logs || [];

  const filteredLogs = logFilter
    ? logs.filter((l: any) => l.level.toLowerCase() === logFilter.toLowerCase())
    : logs;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Navigation Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/jobs')}
          className="text-xs font-semibold text-gray-400 hover:text-white flex items-center gap-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Jobs Explorer</span>
        </button>

        <div className="flex items-center gap-2">
          {['failed', 'dead'].includes(job?.status) && (
            <button
              onClick={handleRetry}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition-all shadow-md"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Retry Job</span>
            </button>
          )}
          {['pending', 'scheduled'].includes(job?.status) && (
            <button
              onClick={handleCancel}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 text-xs font-semibold transition-all"
            >
              <XCircle className="w-3.5 h-3.5" />
              <span>Cancel Job</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Job Banner */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white tracking-tight">{job?.name}</h1>
              <StatusBadge status={job?.status || 'pending'} type="job" />
              <span className="text-xs font-mono uppercase bg-gray-800 text-gray-300 px-2.5 py-0.5 rounded">
                {job?.type}
              </span>
            </div>
            <p className="text-xs font-mono text-gray-500 mt-1">ID: {job?.id}</p>
          </div>

          <div className="flex items-center gap-4 bg-gray-950 px-4 py-2.5 rounded-xl border border-gray-800/80 text-xs">
            <div>
              <span className="text-gray-500 uppercase block">Priority</span>
              <span className="font-bold text-white">P{job?.priority}</span>
            </div>
            <div className="w-px h-6 bg-gray-800" />
            <div>
              <span className="text-gray-500 uppercase block">Attempts</span>
              <span className="font-bold text-white">
                {job?.attemptCount} / {job?.maxAttempts}
              </span>
            </div>
            <div className="w-px h-6 bg-gray-800" />
            <div>
              <span className="text-gray-500 uppercase block">Timeout</span>
              <span className="font-bold text-white">
                {job?.timeoutMs ? `${job.timeoutMs}ms` : 'None'}
              </span>
            </div>
          </div>
        </div>

        {/* Timestamps Bar */}
        <div className="mt-6 pt-4 border-t border-gray-800 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
          <div>
            <span className="text-gray-500 block">Enqueued At</span>
            <span className="font-medium text-gray-300">
              {job?.enqueuedAt ? new Date(job.enqueuedAt).toLocaleString() : '—'}
            </span>
          </div>
          <div>
            <span className="text-gray-500 block">Started At</span>
            <span className="font-medium text-gray-300">
              {job?.startedAt ? new Date(job.startedAt).toLocaleString() : '—'}
            </span>
          </div>
          <div>
            <span className="text-gray-500 block">Finished At</span>
            <span className="font-medium text-gray-300">
              {job?.finishedAt ? new Date(job.finishedAt).toLocaleString() : '—'}
            </span>
          </div>
          <div>
            <span className="text-gray-500 block">Assigned Worker</span>
            <span className="font-mono text-blue-400 font-semibold truncate block">
              {job?.workerId || 'Unassigned'}
            </span>
          </div>
        </div>
      </div>

      {/* Error or Result Callout */}
      {job?.errorMessage && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
          <div className="flex items-center gap-2 font-bold mb-1">
            <AlertTriangle className="w-4 h-4" />
            <span>Execution Error ({job.errorCode || 'FAILED'})</span>
          </div>
          <p className="font-mono text-gray-300">{job.errorMessage}</p>
        </div>
      )}

      {job?.result && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-sm space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
            <CheckCircle2 className="w-4 h-4" />
            <span>Execution Result Payload</span>
          </div>
          <pre className="p-3 bg-gray-950 border border-gray-800 rounded-lg text-xs font-mono text-emerald-300 overflow-x-auto">
            {JSON.stringify(job.result, null, 2)}
          </pre>
        </div>
      )}

      {/* Payload Viewer */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-sm space-y-2">
        <h2 className="text-xs font-bold text-gray-300 uppercase tracking-wider">
          Job Input Payload
        </h2>
        <pre className="p-3 bg-gray-950 border border-gray-800 rounded-lg text-xs font-mono text-blue-300 overflow-x-auto">
          {JSON.stringify(job?.payload, null, 2)}
        </pre>
      </div>

      {/* Chronological Execution Attempts History */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-gray-400" />
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">
            Execution Attempt History ({executions.length})
          </h2>
        </div>

        {executions.length === 0 ? (
          <div className="text-center py-6 text-xs text-gray-500">
            No execution attempts recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="uppercase tracking-wider text-gray-400 border-b border-gray-800 bg-gray-950/40">
                <tr>
                  <th className="py-2.5 px-3">Attempt #</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Worker ID</th>
                  <th className="py-2.5 px-3">Duration</th>
                  <th className="py-2.5 px-3">Started At</th>
                  <th className="py-2.5 px-3">Error / Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {executions.map((exec: any) => (
                  <tr key={exec.id} className="hover:bg-gray-850/40">
                    <td className="py-2.5 px-3 font-bold text-white">#{exec.attemptNumber}</td>
                    <td className="py-2.5 px-3">
                      <StatusBadge status={exec.status} type="job" />
                    </td>
                    <td className="py-2.5 px-3 font-mono text-gray-400 truncate max-w-[120px]">
                      {exec.workerId}
                    </td>
                    <td className="py-2.5 px-3 text-gray-300">
                      {exec.durationMs != null ? `${exec.durationMs}ms` : 'In progress'}
                    </td>
                    <td className="py-2.5 px-3 text-gray-400">
                      {new Date(exec.startedAt).toLocaleTimeString()}
                    </td>
                    <td className="py-2.5 px-3 text-rose-400 font-mono truncate max-w-[200px]">
                      {exec.errorMessage || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Execution Logs Stream */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-gray-400" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              Execution Log Stream
            </h2>
          </div>
          <select
            value={logFilter}
            onChange={(e) => setLogFilter(e.target.value)}
            className="bg-gray-950 border border-gray-800 rounded-lg px-2.5 py-1 text-xs text-gray-300 focus:outline-none"
          >
            <option value="">All Log Levels</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
          </select>
        </div>

        <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 max-h-64 overflow-y-auto font-mono text-xs space-y-1.5">
          {filteredLogs.length === 0 ? (
            <div className="text-gray-600 italic">No log lines emitted for this job.</div>
          ) : (
            filteredLogs.map((l: any) => (
              <div key={l.id} className="flex items-start gap-2">
                <span className="text-gray-600 shrink-0">
                  {new Date(l.loggedAt).toLocaleTimeString()}
                </span>
                <span
                  className={`uppercase font-bold shrink-0 ${
                    l.level === 'error'
                      ? 'text-rose-400'
                      : l.level === 'warn'
                        ? 'text-amber-400'
                        : 'text-blue-400'
                  }`}
                >
                  [{l.level}]
                </span>
                <span className="text-gray-300">{l.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
