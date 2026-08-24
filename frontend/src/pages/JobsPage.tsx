import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import {
  Search,
  Plus,
  RotateCcw,
  XCircle,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

export const JobsPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [jobs, setJobs] = useState<any[]>([]);
  const [queues, setQueues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({
    page: parseInt(searchParams.get('page') || '1', 10),
    pageSize: 20,
    total: 0,
    totalPages: 1,
  });

  // Filters
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [status, setStatus] = useState(searchParams.get('status') || '');
  const [queueId, setQueueId] = useState(searchParams.get('queueId') || '');
  const [jobType, setJobType] = useState('');

  // Submit Modal
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitMode, setSubmitMode] = useState<'single' | 'batch'>('single');
  const [newJobQueueId, setNewJobQueueId] = useState('');
  const [newJobName, setNewJobName] = useState('');
  const [newJobType, setNewJobType] = useState('immediate');
  const [newJobDelaySeconds, setNewJobDelaySeconds] = useState(60);
  const [newJobPayload, setNewJobPayload] = useState('{}');
  const [newJobPriority, setNewJobPriority] = useState(5);

  // Batch fields
  const [batchName, setBatchName] = useState('');
  const [batchDesc, setBatchDesc] = useState('');
  const [batchJson, setBatchJson] = useState('[\n  {\n    "name": "job-1",\n    "type": "immediate",\n    "priority": 5,\n    "payload": {}\n  }\n]');

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', pagination.page.toString());
      params.set('pageSize', pagination.pageSize.toString());
      if (search) params.set('search', search);
      if (status) params.set('status', status);
      if (queueId) params.set('queueId', queueId);
      if (jobType) params.set('type', jobType);

      const [jobsRes, queuesRes] = await Promise.all([
        apiClient.get(`/jobs?${params.toString()}`),
        apiClient.get('/queues'),
      ]);

      if (jobsRes.data?.data) {
        setJobs(jobsRes.data.data);
        if (jobsRes.data.pagination) {
          setPagination(jobsRes.data.pagination);
        }
      }
      if (queuesRes.data?.data) {
        setQueues(queuesRes.data.data);
        if (!newJobQueueId && queuesRes.data.data.length > 0) {
          setNewJobQueueId(queuesRes.data.data[0].id);
        }
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, [pagination.page, status, queueId, jobType]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPagination((prev) => ({ ...prev, page: 1 }));
    fetchJobs();
  };

  const handleCancelJob = async (id: string) => {
    if (!confirm('Are you sure you want to cancel this job?')) return;
    try {
      await apiClient.post(`/jobs/${id}/cancel`);
      fetchJobs();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to cancel job');
    }
  };

  const handleRetryJob = async (id: string) => {
    try {
      await apiClient.post(`/jobs/${id}/retry`);
      fetchJobs();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to retry job');
    }
  };

  const handleSubmitNewJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newJobQueueId) {
      alert('Please select a target queue first.');
      return;
    }

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

        const cleanedJobs = parsedJobs.map((j: any, idx: number) => ({
          name: typeof j.name === 'string' && j.name.trim() ? j.name.trim() : `batch-task-${idx + 1}`,
          type: j.type || 'immediate',
          priority: isNaN(Number(j.priority)) ? 5 : Math.max(1, Math.min(10, Number(j.priority))),
          payload:
            j.payload && typeof j.payload === 'object' ? j.payload : typeof j === 'object' ? j : {},
          scheduledAt: j.scheduledAt || undefined,
          maxAttempts: isNaN(Number(j.maxAttempts)) ? undefined : Number(j.maxAttempts),
          timeoutMs: isNaN(Number(j.timeoutMs)) ? undefined : Number(j.timeoutMs),
        }));

        await apiClient.post(`/queues/${newJobQueueId}/batch`, {
          name: batchName.trim() || `batch-group-${Date.now()}`,
          description: batchDesc.trim() || undefined,
          jobs: cleanedJobs,
        });

        setShowSubmitModal(false);
        setBatchName('');
        fetchJobs();
      } catch (err: any) {
        alert(err.response?.data?.error || 'Failed to submit batch jobs');
      }
      return;
    }

    try {
      let parsed = {};
      try {
        parsed = JSON.parse(newJobPayload);
      } catch {
        alert('Invalid JSON in payload');
        return;
      }

      const priorityVal =
        isNaN(Number(newJobPriority)) || Number(newJobPriority) < 1 ? 5 : Number(newJobPriority);

      let scheduledAt: string | undefined = undefined;
      if (newJobType === 'delayed') {
        const delay =
          isNaN(Number(newJobDelaySeconds)) || Number(newJobDelaySeconds) < 1
            ? 60
            : Number(newJobDelaySeconds);
        scheduledAt = new Date(Date.now() + delay * 1000).toISOString();
      }

      await apiClient.post(`/queues/${newJobQueueId}/jobs`, {
        name: newJobName.trim(),
        type: newJobType,
        payload: parsed,
        priority: priorityVal,
        scheduledAt,
      });

      setShowSubmitModal(false);
      setNewJobName('');
      fetchJobs();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to submit job');
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header & Submit Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Jobs Explorer</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Search, inspect execution timelines, and manage jobs across all queues
          </p>
        </div>
        <button
          onClick={() => setShowSubmitModal(true)}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition-all shadow-md hover:shadow-blue-500/20"
        >
          <Plus className="w-4 h-4" />
          <span>Submit Job</span>
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 shadow-sm">
        <form
          onSubmit={handleSearchSubmit}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-center"
        >
          {/* Search Input */}
          <div className="relative lg:col-span-2">
            <Search className="w-4 h-4 absolute left-3 top-3 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search job name or ID..."
              className="w-full bg-gray-950 border border-gray-800 rounded-xl pl-9 pr-4 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Status Filter */}
          <div>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPagination((prev) => ({ ...prev, page: 1 }));
              }}
              className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
            >
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="scheduled">Scheduled / Delayed</option>
              <option value="dead">Dead (DLQ)</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {/* Queue Filter */}
          <div>
            <select
              value={queueId}
              onChange={(e) => {
                setQueueId(e.target.value);
                setPagination((prev) => ({ ...prev, page: 1 }));
              }}
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

          {/* Search Button */}
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white text-xs font-semibold rounded-xl transition-all"
            >
              Search
            </button>
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setStatus('');
                setQueueId('');
                setJobType('');
                setPagination((prev) => ({ ...prev, page: 1 }));
              }}
              className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white text-xs font-semibold rounded-xl"
              title="Clear Filters"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>
      </div>

      {/* Jobs Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-16 text-gray-500 text-sm">
            No jobs found matching the selected criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-gray-400 border-b border-gray-800 bg-gray-950/50">
                <tr>
                  <th className="py-3.5 px-4">Job Name / ID</th>
                  <th className="py-3.5 px-4">Queue</th>
                  <th className="py-3.5 px-4">Type</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Attempts</th>
                  <th className="py-3.5 px-4">Created / Enqueued</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-gray-850/50 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-white">{job.name}</div>
                      <div className="text-xs font-mono text-gray-500">{job.id}</div>
                    </td>
                    <td className="py-3.5 px-4 text-xs font-medium text-gray-300">
                      {queues.find((q) => q.id === job.queueId)?.name || 'Default Queue'}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="text-xs font-mono uppercase text-gray-400 bg-gray-800/60 px-2 py-0.5 rounded">
                        {job.type}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <StatusBadge status={job.status} type="job" />
                    </td>
                    <td className="py-3.5 px-4 text-xs text-gray-300">
                      {job.attemptCount} / {job.maxAttempts}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-gray-400">
                      {new Date(job.createdAt).toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {['failed', 'dead'].includes(job.status) && (
                          <button
                            onClick={() => handleRetryJob(job.id)}
                            className="p-1 rounded-lg text-blue-400 hover:bg-gray-800"
                            title="Retry Job"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}
                        {['pending', 'scheduled'].includes(job.status) && (
                          <button
                            onClick={() => handleCancelJob(job.id)}
                            className="p-1 rounded-lg text-rose-400 hover:bg-gray-800"
                            title="Cancel Job"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => navigate(`/jobs/${job.id}`)}
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

        {/* Pagination Footer */}
        <div className="px-4 py-3 border-t border-gray-800 flex items-center justify-between text-xs text-gray-400">
          <span>
            Showing <strong>{jobs.length}</strong> of <strong>{pagination.total}</strong> jobs
          </span>
          <div className="flex items-center gap-2">
            <button
              disabled={pagination.page <= 1}
              onClick={() => setPagination((prev) => ({ ...prev, page: prev.page - 1 }))}
              className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed text-gray-300"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span>
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setPagination((prev) => ({ ...prev, page: prev.page + 1 }))}
              className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed text-gray-300"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Modal: Submit Job */}
      {showSubmitModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">Submit New Job</h2>
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

            <form onSubmit={handleSubmitNewJob} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                  Target Queue
                </label>
                <select
                  value={newJobQueueId}
                  onChange={(e) => setNewJobQueueId(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  {queues.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.name}
                    </option>
                  ))}
                </select>
              </div>

              {submitMode === 'single' ? (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                      Job Name
                    </label>
                    <input
                      type="text"
                      required
                      value={newJobName}
                      onChange={(e) => setNewJobName(e.target.value)}
                      placeholder="e.g. generate-monthly-report"
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div
                    className={`grid ${newJobType === 'delayed' ? 'grid-cols-3' : 'grid-cols-2'} gap-3`}
                  >
                    <div>
                      <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                        Job Type
                      </label>
                      <select
                        value={newJobType}
                        onChange={(e) => setNewJobType(e.target.value)}
                        className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                      >
                        <option value="immediate">Immediate</option>
                        <option value="delayed">Delayed</option>
                      </select>
                    </div>

                    {newJobType === 'delayed' && (
                      <div>
                        <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                          Delay (sec)
                        </label>
                        <input
                          type="number"
                          min={1}
                          value={newJobDelaySeconds}
                          onChange={(e) => setNewJobDelaySeconds(parseInt(e.target.value, 10) || 0)}
                          className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                        Priority (1-10)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={isNaN(newJobPriority) ? '' : newJobPriority}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          setNewJobPriority(isNaN(val) ? ('' as any) : val);
                        }}
                        className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold text-gray-300 uppercase">
                        Payload (JSON Object)
                      </label>
                      <span className="text-[10px] text-gray-500 font-medium">Quick Templates:</span>
                    </div>

                    {/* Quick Template Pills */}
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      <button
                        type="button"
                        onClick={() =>
                          setNewJobPayload(
                            JSON.stringify(
                              {
                                to: 'customer@example.com',
                                subject: 'Order Confirmation #8821',
                                template: 'order_receipt',
                                metadata: { orderId: 'ORD-8821', total: 129.99, currency: 'USD' },
                              },
                              null,
                              2
                            )
                          )
                        }
                        className="px-2 py-0.5 rounded-lg bg-gray-900 hover:bg-gray-800 border border-gray-800 text-[10px] text-blue-400 font-medium"
                      >
                        📧 Email
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setNewJobPayload(
                            JSON.stringify(
                              {
                                customerId: 'CUST-4421',
                                invoiceId: 'INV-2026-904',
                                amount: 250.0,
                                currency: 'USD',
                                paymentMethod: 'card_visa_4242',
                              },
                              null,
                              2
                            )
                          )
                        }
                        className="px-2 py-0.5 rounded-lg bg-gray-900 hover:bg-gray-800 border border-gray-800 text-[10px] text-emerald-400 font-medium"
                      >
                        💳 Payment
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setNewJobPayload(
                            JSON.stringify(
                              {
                                reportType: 'monthly_financial_summary',
                                format: 'pdf',
                                fiscalMonth: '2026-08',
                                delivery: { channel: 'email', target: 'finance@example.com' },
                              },
                              null,
                              2
                            )
                          )
                        }
                        className="px-2 py-0.5 rounded-lg bg-gray-900 hover:bg-gray-800 border border-gray-800 text-[10px] text-purple-400 font-medium"
                      >
                        📊 PDF Report
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setNewJobPayload(
                            JSON.stringify(
                              {
                                task: 'heavy_dataset_processing',
                                recordsCount: 5000,
                                sleepMs: 2000,
                              },
                              null,
                              2
                            )
                          )
                        }
                        className="px-2 py-0.5 rounded-lg bg-gray-900 hover:bg-gray-800 border border-gray-800 text-[10px] text-amber-400 font-medium"
                      >
                        ⏳ Slow Task (2s)
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setNewJobPayload(
                            JSON.stringify(
                              {
                                shouldFail: true,
                                errorMessage: 'Payment Gateway Timeout (504)',
                                errorCode: 'GATEWAY_TIMEOUT',
                              },
                              null,
                              2
                            )
                          )
                        }
                        className="px-2 py-0.5 rounded-lg bg-rose-950/30 hover:bg-rose-900/40 border border-rose-800/50 text-[10px] text-rose-400 font-medium"
                      >
                        ⚠️ Fail/DLQ Test
                      </button>
                    </div>

                    <textarea
                      rows={5}
                      value={newJobPayload}
                      onChange={(e) => setNewJobPayload(e.target.value)}
                      className="w-full font-mono bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-blue-300 focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-[11px] text-gray-500 mt-1">
                      Format: Valid JSON object <code className="text-gray-400">{`{ "key": "value" }`}</code>. Test flags: <code className="text-gray-400">"shouldFail": true</code> (triggers retry/DLQ) or <code className="text-gray-400">"sleepMs": 1000</code>.
                    </p>
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
                      placeholder="e.g. monthly-settlements-batch"
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
                      placeholder="e.g. Bulk processing 100 settlement jobs"
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold text-gray-300 uppercase">
                        Jobs Array (JSON Array of Objects)
                      </label>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setBatchJson(
                              JSON.stringify(
                                [
                                  {
                                    name: 'process-order-101',
                                    type: 'immediate',
                                    priority: 5,
                                    payload: { orderId: 'ORD-101', total: 49.99 },
                                  },
                                  {
                                    name: 'process-order-102',
                                    type: 'immediate',
                                    priority: 8,
                                    payload: { orderId: 'ORD-102', total: 129.5 },
                                  },
                                  {
                                    name: 'process-order-103',
                                    type: 'immediate',
                                    priority: 6,
                                    payload: { orderId: 'ORD-103', total: 85.0 },
                                  },
                                ],
                                null,
                                2
                              )
                            )
                          }
                          className="px-2 py-0.5 rounded-lg bg-gray-900 hover:bg-gray-800 border border-gray-800 text-[10px] text-blue-400 font-medium"
                        >
                          📦 3 Orders
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setBatchJson(
                              JSON.stringify(
                                Array.from({ length: 10 }, (_, i) => ({
                                  name: `parallel-batch-worker-${i + 1}`,
                                  type: 'immediate',
                                  priority: (i % 5) + 3,
                                  payload: { partitionId: i + 1, batchChunk: 1000 },
                                })),
                                null,
                                2
                              )
                            )
                          }
                          className="px-2 py-0.5 rounded-lg bg-gray-900 hover:bg-gray-800 border border-gray-800 text-[10px] text-emerald-400 font-medium"
                        >
                          🚀 10 Parallel Tasks
                        </button>
                      </div>
                    </div>
                    <textarea
                      rows={6}
                      value={batchJson}
                      onChange={(e) => setBatchJson(e.target.value)}
                      className="w-full font-mono bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-blue-300 focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-[11px] text-gray-500 mt-1">
                      Format: JSON array of job objects with <code className="text-gray-400">name</code>, <code className="text-gray-400">priority (1-10)</code>, <code className="text-gray-400">type</code>, and <code className="text-gray-400">payload</code>.
                    </p>
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
                  {submitMode === 'batch' ? 'Enqueue Batch Jobs' : 'Enqueue'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
