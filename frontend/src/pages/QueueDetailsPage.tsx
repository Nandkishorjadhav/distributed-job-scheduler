import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { Settings, Plus, Play, Pause, ArrowLeft, AlertTriangle } from 'lucide-react';

export const QueueDetailsPage: React.FC = () => {
  const { queueId } = useParams<{ queueId: string }>();
  const navigate = useNavigate();

  const [queue, setQueue] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');

  // Submit job modal
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitMode, setSubmitMode] = useState<'single' | 'batch'>('single');
  const [jobName, setJobName] = useState('');
  const [jobType, setJobType] = useState('immediate');
  const [jobPayload, setJobPayload] = useState('{\n  "taskId": "123"\n}');
  const [jobPriority, setJobPriority] = useState(5);
  const [delaySeconds, setDelaySeconds] = useState(10);

  // Batch fields
  const [batchName, setBatchName] = useState('');
  const [batchDesc, setBatchDesc] = useState('');
  const [batchJson, setBatchJson] = useState(`[
  {
    "name": "batch-item-1",
    "type": "immediate",
    "priority": 5,
    "payload": { "id": 101, "task": "Process Alpha" }
  },
  {
    "name": "batch-item-2",
    "type": "immediate",
    "priority": 7,
    "payload": { "id": 102, "task": "Process Beta" }
  },
  {
    "name": "batch-item-3",
    "type": "immediate",
    "priority": 9,
    "payload": { "id": 103, "task": "Process Gamma" }
  }
]`);

  const fetchQueueData = async () => {
    try {
      const [qRes, sRes, jRes] = await Promise.all([
        apiClient.get(`/queues`),
        apiClient.get(`/queues/${queueId}/stats`),
        apiClient.get(`/queues/${queueId}/jobs${statusFilter ? `?status=${statusFilter}` : ''}`),
      ]);

      const foundQueue = qRes.data?.data?.find((q: any) => q.id === queueId);
      if (foundQueue) setQueue(foundQueue);
      if (sRes.data?.data) setStats(sRes.data.data);
      if (jRes.data?.data) setJobs(jRes.data.data);
      setError(null);
    } catch (err: any) {
      if (err.response?.status === 403) {
        setError(
          'You do not have permission to view this queue. Please ensure you are logged in with an account belonging to this organization.'
        );
      } else if (err.response?.status === 404) {
        setError('Queue not found.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueueData();
    const interval = setInterval(fetchQueueData, 5000);
    return () => clearInterval(interval);
  }, [queueId, statusFilter]);

  const handlePauseResume = async () => {
    if (!queue) return;
    try {
      if (queue.status === 'paused') {
        await apiClient.post(`/queues/${queue.id}/resume`);
      } else {
        await apiClient.post(`/queues/${queue.id}/pause`);
      }
      fetchQueueData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Action failed');
    }
  };

  const handleSubmitJob = async (e: React.FormEvent) => {
    e.preventDefault();

    if (submitMode === 'batch') {
      try {
        let parsedJobs: any[] = [];
        try {
          parsedJobs = JSON.parse(batchJson);
          if (!Array.isArray(parsedJobs) || parsedJobs.length === 0) {
            alert('Batch payload must be a JSON array of job objects');
            return;
          }
        } catch {
          alert('Invalid JSON in Batch payload');
          return;
        }

        await apiClient.post(`/queues/${queueId}/batch`, {
          name: batchName.trim() || `batch-group-${Date.now()}`,
          description: batchDesc.trim() || undefined,
          jobs: parsedJobs,
        });

        setShowSubmitModal(false);
        setBatchName('');
        fetchQueueData();
      } catch (err: any) {
        alert(err.response?.data?.error || 'Failed to submit batch jobs');
      }
      return;
    }

    try {
      let parsedPayload = {};
      try {
        parsedPayload = JSON.parse(jobPayload);
      } catch {
        alert('Invalid JSON in payload');
        return;
      }

      let scheduledAt: string | undefined = undefined;
      if (jobType === 'delayed') {
        scheduledAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
      }

      const priorityVal =
        isNaN(Number(jobPriority)) || Number(jobPriority) < 1 ? 5 : Number(jobPriority);

      await apiClient.post(`/queues/${queueId}/jobs`, {
        name: jobName,
        type: jobType,
        payload: parsedPayload,
        priority: priorityVal,
        scheduledAt,
      });

      setShowSubmitModal(false);
      setJobName('');
      fetchQueueData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to submit job');
    }
  };

  if (error) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center space-y-4 bg-gray-900 border border-gray-800 rounded-2xl p-8">
        <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto" />
        <h2 className="text-lg font-bold text-white">Access Restricted</h2>
        <p className="text-xs text-gray-400 max-w-md mx-auto">{error}</p>
        <button
          onClick={() => navigate('/queues')}
          className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold"
        >
          Back to Queues Explorer
        </button>
      </div>
    );
  }

  if (loading && !queue) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="w-8 h-8 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  const breakdown = stats?.breakdown || {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    dead: 0,
    scheduled: 0,
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Back button and header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/queues')}
          className="text-xs font-semibold text-gray-400 hover:text-white flex items-center gap-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Queues</span>
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePauseResume}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-900 border border-gray-800 hover:border-gray-700 text-xs font-semibold text-gray-300 hover:text-white transition-all"
          >
            {queue?.status === 'paused' ? (
              <>
                <Play className="w-3.5 h-3.5 text-emerald-400 fill-current" />
                <span>Resume Processing</span>
              </>
            ) : (
              <>
                <Pause className="w-3.5 h-3.5 text-amber-400 fill-current" />
                <span>Pause Processing</span>
              </>
            )}
          </button>
          <button
            onClick={() => navigate(`/queues/${queueId}/config`)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-900 border border-gray-800 hover:border-gray-700 text-xs font-semibold text-gray-300 hover:text-white transition-all"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Configure Queue</span>
          </button>
          <button
            onClick={() => setShowSubmitModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition-all shadow-md"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Submit Job</span>
          </button>
        </div>
      </div>

      {/* Queue Banner Card */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white tracking-tight">{queue?.name}</h1>
              <StatusBadge status={queue?.status || 'active'} type="queue" />
              <span className="text-xs px-2.5 py-0.5 rounded bg-gray-800 text-gray-300 font-semibold">
                Priority P{queue?.priority}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              ID: <span className="font-mono text-gray-500">{queue?.id}</span> · Max Concurrency:{' '}
              <strong className="text-white">{queue?.concurrencyLimit}</strong>
            </p>
          </div>

          <div className="flex items-center gap-4 bg-gray-950 px-4 py-2.5 rounded-xl border border-gray-800/80">
            <div className="text-center">
              <span className="text-xs text-gray-500 uppercase block">Pending</span>
              <span className="text-lg font-bold text-amber-400">{breakdown.pending}</span>
            </div>
            <div className="w-px h-8 bg-gray-800" />
            <div className="text-center">
              <span className="text-xs text-gray-500 uppercase block">In-Flight</span>
              <span className="text-lg font-bold text-blue-400">{breakdown.running}</span>
            </div>
            <div className="w-px h-8 bg-gray-800" />
            <div className="text-center">
              <span className="text-xs text-gray-500 uppercase block">Completed</span>
              <span className="text-lg font-bold text-emerald-400">{breakdown.completed}</span>
            </div>
            <div className="w-px h-8 bg-gray-800" />
            <div className="text-center">
              <span className="text-xs text-gray-500 uppercase block">DLQ</span>
              <span className="text-lg font-bold text-rose-400">{breakdown.dead}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Jobs List in Queue */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-base font-bold text-white">Jobs in this Queue</h2>
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
            >
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed / Retrying</option>
              <option value="dead">Dead (DLQ)</option>
            </select>
          </div>
        </div>

        {jobs.length === 0 ? (
          <div className="text-center py-12 text-sm text-gray-500">
            No jobs found for the selected filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-gray-400 border-b border-gray-800 bg-gray-950/40">
                <tr>
                  <th className="py-3 px-4">Job Name</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Attempts</th>
                  <th className="py-3 px-4">Created</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-gray-850/50 transition-colors">
                    <td className="py-3.5 px-4 font-semibold text-white">{job.name}</td>
                    <td className="py-3.5 px-4 text-xs font-mono text-gray-400 uppercase">
                      {job.type}
                    </td>
                    <td className="py-3.5 px-4">
                      <StatusBadge status={job.status} type="job" />
                    </td>
                    <td className="py-3.5 px-4 text-gray-300">
                      {job.attemptCount} / {job.maxAttempts}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-gray-400">
                      {new Date(job.createdAt).toLocaleTimeString()}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => navigate(`/jobs/${job.id}`)}
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

      {/* Modal: Submit Job */}
      {showSubmitModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">Enqueue to {queue?.name}</h2>
              <div className="flex bg-gray-950 p-1 rounded-xl border border-gray-800">
                <button
                  type="button"
                  onClick={() => setSubmitMode('single')}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                    submitMode === 'single'
                      ? 'bg-blue-600 text-white shadow'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Single Job
                </button>
                <button
                  type="button"
                  onClick={() => setSubmitMode('batch')}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                    submitMode === 'batch'
                      ? 'bg-blue-600 text-white shadow'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Batch (Bulk)
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmitJob} className="space-y-4">
              {submitMode === 'single' ? (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                      Job Name
                    </label>
                    <input
                      type="text"
                      required
                      value={jobName}
                      onChange={(e) => setJobName(e.target.value)}
                      placeholder="e.g. process-payout"
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                        Job Type
                      </label>
                      <select
                        value={jobType}
                        onChange={(e) => setJobType(e.target.value)}
                        className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                      >
                        <option value="immediate">Immediate</option>
                        <option value="delayed">Delayed (Timer)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                        Priority (1-10)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={isNaN(jobPriority) ? '' : jobPriority}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          setJobPriority(isNaN(val) ? ('' as any) : val);
                        }}
                        className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  {jobType === 'delayed' && (
                    <div>
                      <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                        Delay (Seconds)
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={isNaN(delaySeconds) ? '' : delaySeconds}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          setDelaySeconds(isNaN(val) ? ('' as any) : val);
                        }}
                        className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                      Payload (JSON)
                    </label>
                    <textarea
                      rows={4}
                      value={jobPayload}
                      onChange={(e) => setJobPayload(e.target.value)}
                      className="w-full font-mono bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-blue-300 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                      Batch Group Name
                    </label>
                    <input
                      type="text"
                      required
                      value={batchName}
                      onChange={(e) => setBatchName(e.target.value)}
                      placeholder="e.g. nightly-payroll-batch"
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                      Description (Optional)
                    </label>
                    <input
                      type="text"
                      value={batchDesc}
                      onChange={(e) => setBatchDesc(e.target.value)}
                      placeholder="e.g. Processing 500 employee payouts"
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                      Jobs Array (JSON Array)
                    </label>
                    <textarea
                      rows={6}
                      value={batchJson}
                      onChange={(e) => setBatchJson(e.target.value)}
                      className="w-full font-mono bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-blue-300 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </>
              )}

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowSubmitModal(false)}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl shadow-md"
                >
                  {submitMode === 'batch' ? 'Enqueue Batch Jobs' : 'Enqueue Job'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
