import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { Layers, Plus, Play, Pause, Settings, ArrowRight } from 'lucide-react';

export const QueuesPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('projectId');
  const navigate = useNavigate();

  const [queues, setQueues] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Create queue modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState(projectId || '');
  const [queueName, setQueueName] = useState('');
  const [queuePriority, setQueuePriority] = useState(5);
  const [concurrencyLimit, setConcurrencyLimit] = useState(10);
  const [dlqEnabled, setDlqEnabled] = useState(true);

  const fetchQueues = async () => {
    try {
      const url = projectId ? `/queues?projectId=${projectId}` : '/queues';
      const [qRes, pRes] = await Promise.all([
        apiClient.get(url),
        apiClient.get('/projects'),
      ]);

      if (qRes.data?.data) {
        setQueues(qRes.data.data);
      }
      if (pRes.data?.data) {
        setProjects(pRes.data.data);
        if (!selectedProjectId && pRes.data.data.length > 0) {
          setSelectedProjectId(pRes.data.data[0].id);
        }
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueues();
  }, [projectId]);

  const handlePauseResume = async (queue: any) => {
    try {
      if (queue.status === 'paused') {
        await apiClient.post(`/queues/${queue.id}/resume`);
      } else {
        await apiClient.post(`/queues/${queue.id}/pause`);
      }
      fetchQueues();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to update queue status');
    }
  };

  const handleCreateQueue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) {
      alert('Please select a project or create a project first.');
      return;
    }

    try {
      await apiClient.post('/queues', {
        projectId: selectedProjectId,
        name: queueName,
        priority: queuePriority,
        concurrencyLimit,
        dlqEnabled,
      });
      setShowCreateModal(false);
      setQueueName('');
      fetchQueues();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to create queue');
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Queues Management</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Configure concurrency limits, priority levels, and execution flow
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition-all shadow-md hover:shadow-blue-500/20"
        >
          <Plus className="w-4 h-4" />
          <span>New Queue</span>
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <div className="w-8 h-8 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : queues.length === 0 ? (
        <div className="text-center py-16 bg-gray-900 border border-gray-800 rounded-2xl">
          <Layers className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-white">No queues found</h3>
          <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
            Create a queue with customized concurrency and retry policies to start processing jobs.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold"
          >
            Create Queue
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {queues.map((q) => (
            <div
              key={q.id}
              className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl p-5 transition-all shadow-sm flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={q.status} type="queue" />
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-gray-800 text-gray-300">
                      Priority {q.priority}
                    </span>
                  </div>
                  <button
                    onClick={() => handlePauseResume(q)}
                    className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
                    title={q.status === 'paused' ? 'Resume Queue' : 'Pause Queue'}
                  >
                    {q.status === 'paused' ? (
                      <Play className="w-3.5 h-3.5 text-emerald-400 fill-current" />
                    ) : (
                      <Pause className="w-3.5 h-3.5 text-amber-400 fill-current" />
                    )}
                  </button>
                </div>

                <h3 className="text-base font-bold text-white mt-3">{q.name}</h3>
                <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                  {q.description || 'General processing queue.'}
                </p>

                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 rounded-lg bg-gray-950 border border-gray-800/80">
                    <span className="text-gray-500 block">Concurrency Limit</span>
                    <span className="font-semibold text-white">{q.concurrencyLimit} slots</span>
                  </div>
                  <div className="p-2 rounded-lg bg-gray-950 border border-gray-800/80">
                    <span className="text-gray-500 block">DLQ Enabled</span>
                    <span className="font-semibold text-emerald-400">{q.dlqEnabled ? 'Yes' : 'No'}</span>
                  </div>
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-gray-800 flex items-center justify-between">
                <button
                  onClick={() => navigate(`/queues/${q.id}`)}
                  className="text-xs text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-1"
                >
                  <span>Inspect Queue</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => navigate(`/queues/${q.id}/config`)}
                  className="p-1 text-gray-400 hover:text-white transition-colors"
                  title="Queue Settings"
                >
                  <Settings className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Create Queue */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-white mb-4">Create New Queue</h2>
            <form onSubmit={handleCreateQueue} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                  Target Project
                </label>
                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.slug})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                  Queue Name
                </label>
                <input
                  type="text"
                  required
                  value={queueName}
                  onChange={(e) => setQueueName(e.target.value)}
                  placeholder="e.g. email-notifications"
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                    Priority (1-10)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={isNaN(queuePriority) ? '' : queuePriority}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setQueuePriority(isNaN(val) ? ('' as any) : val);
                    }}
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                    Concurrency Limit
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={isNaN(concurrencyLimit) ? '' : concurrencyLimit}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setConcurrencyLimit(isNaN(val) ? ('' as any) : val);
                    }}
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer pt-2">
                <input
                  type="checkbox"
                  checked={dlqEnabled}
                  onChange={(e) => setDlqEnabled(e.target.checked)}
                  className="rounded bg-gray-950 border-gray-800 text-blue-600 focus:ring-0"
                />
                <span>Enable Dead Letter Queue (Quarantine exhausted failures)</span>
              </label>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl shadow-md"
                >
                  Create Queue
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
