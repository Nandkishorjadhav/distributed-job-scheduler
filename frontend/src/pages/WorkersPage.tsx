import React, { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import {
  Server,
  AlertTriangle,
  RefreshCw,
  Power,
  XCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const WorkersPage: React.FC = () => {
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanningStale, setScanningStale] = useState(false);
  const [selectedWorker, setSelectedWorker] = useState<any>(null);
  const [workerDetails, setWorkerDetails] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const navigate = useNavigate();

  const fetchWorkers = async () => {
    try {
      const res = await apiClient.get('/workers');
      if (res.data?.data) {
        setWorkers(res.data.data);
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkers();
    const interval = setInterval(fetchWorkers, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleScanStale = async () => {
    setScanningStale(true);
    try {
      const res = await apiClient.post('/workers/stale/scan?timeoutSeconds=30');
      alert(`Stale scan complete: ${res.data?.data?.count || 0} stale workers flagged.`);
      fetchWorkers();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Stale scan failed');
    } finally {
      setScanningStale(false);
    }
  };

  const handleStopWorker = async (workerId: string) => {
    if (!confirm('Are you sure you want to stop this worker process?')) return;
    try {
      await apiClient.post(`/workers/${workerId}/stop`);
      fetchWorkers();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to stop worker');
    }
  };

  const handleInspectWorker = async (worker: any) => {
    setSelectedWorker(worker);
    setLoadingDetails(true);
    try {
      const res = await apiClient.get(`/workers/${worker.id}`);
      if (res.data?.data) {
        setWorkerDetails(res.data.data);
      }
    } catch {
      // Ignore
    } finally {
      setLoadingDetails(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Worker Fleet Telemetry</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Real-time liveness, concurrency capacity, and heartbeat health across distributed nodes
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleScanStale}
            disabled={scanningStale}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs font-semibold text-amber-400 hover:bg-amber-500/20 transition-all"
          >
            <AlertTriangle className={`w-3.5 h-3.5 ${scanningStale ? 'animate-spin' : ''}`} />
            <span>Scan Stale Workers</span>
          </button>
          <button
            onClick={fetchWorkers}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-900 border border-gray-800 hover:border-gray-700 text-xs font-semibold text-gray-300 hover:text-white transition-all shadow-sm"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Workers Fleet Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : workers.length === 0 ? (
          <div className="text-center py-16 text-gray-500 text-sm">
            No worker nodes currently registered. Start a worker process to see it here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-gray-400 border-b border-gray-800 bg-gray-950/50">
                <tr>
                  <th className="py-3.5 px-4">Hostname / PID</th>
                  <th className="py-3.5 px-4">Project</th>
                  <th className="py-3.5 px-4">Health Status</th>
                  <th className="py-3.5 px-4">Capacity Utilization</th>
                  <th className="py-3.5 px-4">Last Heartbeat</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {workers.map((w) => {
                  const percentUsed =
                    w.maxConcurrency > 0
                      ? Math.round((w.currentJobCount / w.maxConcurrency) * 100)
                      : 0;

                  return (
                    <tr key={w.id} className="hover:bg-gray-850/50 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-white flex items-center gap-2">
                          <Server className="w-4 h-4 text-blue-400" />
                          <span>{w.hostname}</span>
                        </div>
                        <div className="text-xs font-mono text-gray-500">
                          PID: {w.pid} · v{w.version || '1.0.0'}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-xs text-gray-300">
                        {w.projectName || 'Default Project'}
                      </td>
                      <td className="py-3.5 px-4">
                        <StatusBadge
                          status={w.calculatedStatus || w.status}
                          type="worker"
                        />
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="text-xs text-gray-300 mb-1">
                          {w.currentJobCount} / {w.maxConcurrency} slots ({percentUsed}%)
                        </div>
                        <div className="w-28 h-1.5 bg-gray-950 rounded-full overflow-hidden border border-gray-800">
                          <div
                            className={`h-full rounded-full ${
                              percentUsed >= 100
                                ? 'bg-amber-500'
                                : percentUsed > 0
                                ? 'bg-blue-500'
                                : 'bg-gray-700'
                            }`}
                            style={{ width: `${percentUsed}%` }}
                          />
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-xs text-gray-400">
                        {new Date(w.lastHeartbeatAt).toLocaleTimeString()}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {w.status !== 'stopped' && (
                            <button
                              onClick={() => handleStopWorker(w.id)}
                              className="p-1 rounded-lg text-rose-400 hover:bg-gray-800"
                              title="Stop Worker"
                            >
                              <Power className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => handleInspectWorker(w)}
                            className="px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs font-semibold text-blue-400 hover:text-blue-300"
                          >
                            Inspect
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Inspect Worker Details */}
      {selectedWorker && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Server className="w-5 h-5 text-blue-400" />
                  <span>{selectedWorker.hostname}</span>
                  <StatusBadge status={selectedWorker.status} type="worker" />
                </h2>
                <p className="text-xs text-gray-500 font-mono mt-0.5">ID: {selectedWorker.id}</p>
              </div>
              <button
                onClick={() => {
                  setSelectedWorker(null);
                  setWorkerDetails(null);
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
              <div className="space-y-4">
                {/* Active running jobs on this worker */}
                <div className="bg-gray-950 border border-gray-800 rounded-xl p-4">
                  <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider mb-2">
                    Currently Executing Jobs ({workerDetails?.runningJobs?.length || 0})
                  </h3>
                  {workerDetails?.runningJobs?.length === 0 ? (
                    <p className="text-xs text-gray-500 italic">No in-flight jobs on this worker.</p>
                  ) : (
                    <div className="space-y-2">
                      {workerDetails?.runningJobs?.map((rj: any) => (
                        <div
                          key={rj.id}
                          className="flex items-center justify-between p-2 rounded-lg bg-gray-900 border border-gray-800 text-xs"
                        >
                          <div>
                            <span className="font-semibold text-white block">{rj.name}</span>
                            <span className="font-mono text-gray-500 text-[10px]">{rj.id}</span>
                          </div>
                          <button
                            onClick={() => {
                              setSelectedWorker(null);
                              navigate(`/jobs/${rj.id}`);
                            }}
                            className="text-blue-400 hover:text-blue-300 font-semibold"
                          >
                            Inspect Job
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Recent Time-series Heartbeats */}
                <div className="bg-gray-950 border border-gray-800 rounded-xl p-4">
                  <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider mb-2">
                    Recent Heartbeats Telemetry
                  </h3>
                  <div className="max-h-48 overflow-y-auto space-y-1 text-xs font-mono">
                    {workerDetails?.recentHeartbeats?.map((hb: any) => (
                      <div
                        key={hb.id}
                        className="flex items-center justify-between p-1.5 rounded bg-gray-900/60 text-gray-400"
                      >
                        <span>{new Date(hb.createdAt).toLocaleTimeString()}</span>
                        <span>{hb.currentJobCount} active jobs</span>
                        <StatusBadge status={hb.status} type="worker" className="text-[10px] py-0" />
                      </div>
                    ))}
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
