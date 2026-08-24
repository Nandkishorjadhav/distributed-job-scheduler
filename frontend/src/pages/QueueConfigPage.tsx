import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { ArrowLeft, Save, Trash2, CheckCircle2 } from 'lucide-react';

export const QueueConfigPage: React.FC = () => {
  const { queueId } = useParams<{ queueId: string }>();
  const navigate = useNavigate();

  const [queue, setQueue] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Form states
  const [name, setName] = useState('');
  const [priority, setPriority] = useState(5);
  const [concurrencyLimit, setConcurrencyLimit] = useState(10);
  const [dlqEnabled, setDlqEnabled] = useState(true);

  // Retry policy
  const [strategy, setStrategy] = useState('exponential');
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [initialDelayMs, setInitialDelayMs] = useState(1000);
  const [maxDelayMs, setMaxDelayMs] = useState(30000);
  const [jitterMs, setJitterMs] = useState(500);

  useEffect(() => {
    const fetchQueue = async () => {
      try {
        const res = await apiClient.get('/queues');
        const found = res.data?.data?.find((q: any) => q.id === queueId);
        if (found) {
          setQueue(found);
          setName(found.name);
          setPriority(found.priority);
          setConcurrencyLimit(found.concurrencyLimit);
          setDlqEnabled(found.dlqEnabled);

          if (found.retryPolicy) {
            setStrategy(found.retryPolicy.strategy || 'exponential');
            setMaxAttempts(found.retryPolicy.maxAttempts || 3);
            setInitialDelayMs(found.retryPolicy.initialDelayMs || 1000);
            setMaxDelayMs(found.retryPolicy.maxDelayMs || 30000);
            setJitterMs(found.retryPolicy.jitterMs || 500);
          }
        }
      } catch {
        // Ignore
      } finally {
        setLoading(false);
      }
    };
    fetchQueue();
  }, [queueId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedSuccess(false);

    try {
      await apiClient.patch(`/queues/${queueId}`, {
        name,
        priority,
        concurrencyLimit,
        dlqEnabled,
        retryPolicy: {
          strategy,
          maxAttempts,
          initialDelayMs,
          maxDelayMs,
          jitterMs,
        },
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to update queue');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this queue? This cannot be undone.')) return;
    try {
      await apiClient.delete(`/queues/${queueId}`);
      navigate('/queues');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete queue');
    }
  };

  if (loading && !queue) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="w-8 h-8 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <button
        onClick={() => navigate(`/queues/${queueId}`)}
        className="text-xs font-semibold text-gray-400 hover:text-white flex items-center gap-1.5"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to Queue Details</span>
      </button>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Queue Configuration</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Tune concurrency thresholds, priority levels, and exponential backoff retry parameters
          </p>
        </div>
        <button
          onClick={handleDelete}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs font-semibold text-rose-400 hover:bg-rose-500/20 transition-all"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Delete Queue</span>
        </button>
      </div>

      {savedSuccess && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex items-center gap-2.5">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span>Queue configuration saved successfully!</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* General Queue Parameters */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-sm space-y-4">
          <h2 className="text-base font-bold text-white">General Settings</h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                Queue Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                Priority Level (1-10)
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={isNaN(priority) ? '' : priority}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setPriority(isNaN(val) ? ('' as any) : val);
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

          <label className="flex items-center gap-2.5 text-xs text-gray-300 cursor-pointer pt-2">
            <input
              type="checkbox"
              checked={dlqEnabled}
              onChange={(e) => setDlqEnabled(e.target.checked)}
              className="rounded bg-gray-950 border-gray-800 text-blue-600 focus:ring-0"
            />
            <span>Enable Dead Letter Queue quarantine for permanently failed jobs</span>
          </label>
        </div>

        {/* Retry Policy Engine Settings */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-sm space-y-4">
          <h2 className="text-base font-bold text-white">Retry & Backoff Policy</h2>
          <p className="text-xs text-gray-400">
            Determine how jobs in this queue back off upon execution failure to prevent thundering
            herd retry storms.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                Backoff Strategy
              </label>
              <select
                value={strategy}
                onChange={(e) => setStrategy(e.target.value)}
                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              >
                <option value="exponential">Exponential Backoff (Recommended)</option>
                <option value="linear">Linear Backoff</option>
                <option value="fixed">Fixed Delay</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                Max Retry Attempts
              </label>
              <input
                type="number"
                min={1}
                max={50}
                value={isNaN(maxAttempts) ? '' : maxAttempts}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setMaxAttempts(isNaN(val) ? ('' as any) : val);
                }}
                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            <div>
              <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                Initial Delay (ms)
              </label>
              <input
                type="number"
                min={0}
                step={100}
                value={isNaN(initialDelayMs) ? '' : initialDelayMs}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setInitialDelayMs(isNaN(val) ? ('' as any) : val);
                }}
                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                Max Delay Cap (ms)
              </label>
              <input
                type="number"
                min={0}
                step={1000}
                value={isNaN(maxDelayMs) ? '' : maxDelayMs}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setMaxDelayMs(isNaN(val) ? ('' as any) : val);
                }}
                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                Randomized Jitter (ms)
              </label>
              <input
                type="number"
                min={0}
                step={50}
                value={isNaN(jitterMs) ? '' : jitterMs}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setJitterMs(isNaN(val) ? ('' as any) : val);
                }}
                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl shadow-md transition-all disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Saving...' : 'Save Configuration'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
