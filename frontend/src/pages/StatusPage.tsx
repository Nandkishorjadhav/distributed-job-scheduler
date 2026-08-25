import { useEffect, useState } from 'react';

interface HealthData {
  status: string;
  version: string;
  environment: string;
  uptime: number;
  services: Record<string, string>;
}

interface StatusData {
  api: {
    status: string;
    version: string;
    environment: string;
    uptime_seconds: number;
    port: string;
    pid: number;
  };
  memory: {
    heap_used_mb: number;
    heap_total_mb: number;
    rss_mb: number;
  };
  endpoints: Array<{
    method: string;
    path: string;
    auth: boolean;
    status: 'live' | 'stub';
  }>;
  timestamp: string;
}

const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

function Badge({ text, color }: { text: string; color: string }) {
  const colors: Record<string, string> = {
    green: 'bg-green-900 text-green-300 border border-green-700',
    yellow: 'bg-yellow-900 text-yellow-300 border border-yellow-700',
    red: 'bg-red-900 text-red-300 border border-red-700',
    blue: 'bg-blue-900 text-blue-300 border border-blue-700',
    gray: 'bg-gray-800 text-gray-400 border border-gray-600',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-mono ${colors[color] ?? colors.gray}`}>
      {text}
    </span>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">{title}</h2>
      {children}
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-800 last:border-0">
      <span className="text-sm text-gray-400">{label}</span>
      <span className="text-sm text-white font-mono">{value}</span>
    </div>
  );
}

function methodColor(method: string): string {
  return (
    { GET: 'blue', POST: 'green', PATCH: 'yellow', DELETE: 'red', PUT: 'yellow' }[method] ?? 'gray'
  );
}

export function StatusPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [status, setStatus] = useState<StatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastPoll, setLastPoll] = useState<string>('');
  const [countdown, setCountdown] = useState(5);

  const fetchStatus = async () => {
    try {
      const [hRes, sRes] = await Promise.all([
        fetch(`${API}/api/v1/health`),
        fetch(`${API}/api/v1/status`),
      ]);
      setHealth(await hRes.json());
      setStatus(await sRes.json());
      setError(null);
      setLastPoll(new Date().toLocaleTimeString());
      setCountdown(5);
    } catch {
      setError('Cannot reach the configured API. Check the backend deployment.');
    }
  };

  useEffect(() => {
    fetchStatus();
    const poll = setInterval(fetchStatus, 5000);
    const timer = setInterval(() => setCountdown((c) => (c <= 1 ? 5 : c - 1)), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* ── Page title ─────────────────────────── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">System Status</h1>
        <div className="text-xs text-gray-500">
          {lastPoll ? `Last updated ${lastPoll} · refreshes in ${countdown}s` : 'Connecting...'}
        </div>
      </div>

      {/* ── Error banner ───────────────────────── */}
      {error && (
        <div className="bg-red-950 border border-red-700 rounded-lg p-4 text-red-300 text-sm">
          <strong>⚠ Connection Error</strong>
          <br />
          {error}
          <br />
          <br />
          <strong>Fix:</strong> Open a new terminal and run:
          <br />
          <code className="bg-red-900 px-2 py-1 rounded mt-1 inline-block text-xs">
            cd "d:\Job Scheduler\backend\api" && npm run dev
          </code>
        </div>
      )}

      {/* ── Service status cards ────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { name: 'API Server', port: '3000', up: !!health },
          { name: 'PostgreSQL', port: '5432', up: !!health },
          { name: 'Redis', port: '6379', up: !!health },
          { name: 'Frontend', port: '5173', up: true },
        ].map((svc) => (
          <div
            key={svc.name}
            className={`rounded-lg p-4 border ${
              svc.up ? 'bg-green-950 border-green-800' : 'bg-gray-900 border-gray-800'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className={`h-2 w-2 rounded-full ${svc.up ? 'bg-green-400' : 'bg-gray-600'}`} />
              <span className="text-sm font-medium">{svc.name}</span>
            </div>
            <div className="text-xs text-gray-500">port {svc.port}</div>
            <div
              className={`text-xs mt-1 font-semibold ${svc.up ? 'text-green-400' : 'text-gray-500'}`}
            >
              {svc.up ? '● RUNNING' : '○ OFFLINE'}
            </div>
          </div>
        ))}
      </div>

      {/* ── Two-column detail grid ─────────────── */}
      {status && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card title="API Info">
            <StatRow
              label="Status"
              value={<Badge text={status.api.status.toUpperCase()} color="green" />}
            />
            <StatRow label="Version" value={status.api.version} />
            <StatRow
              label="Environment"
              value={<Badge text={status.api.environment} color="blue" />}
            />
            <StatRow label="Uptime" value={`${status.api.uptime_seconds}s`} />
            <StatRow label="Port" value={status.api.port} />
            <StatRow label="PID" value={status.api.pid} />
          </Card>

          <Card title="Memory Usage">
            <StatRow label="Heap Used" value={`${status.memory.heap_used_mb} MB`} />
            <StatRow label="Heap Total" value={`${status.memory.heap_total_mb} MB`} />
            <StatRow label="RSS" value={`${status.memory.rss_mb} MB`} />
            <div className="mt-3">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Heap</span>
                <span>
                  {status.memory.heap_used_mb} / {status.memory.heap_total_mb} MB
                </span>
              </div>
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-2 bg-blue-500 rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, (status.memory.heap_used_mb / status.memory.heap_total_mb) * 100)}%`,
                  }}
                />
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ── Endpoint list ──────────────────────── */}
      {status && status.endpoints && (
        <Card title={`API Endpoints (${(status.endpoints || []).length} total)`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 text-xs border-b border-gray-800">
                  <th className="pb-2 pr-4">Method</th>
                  <th className="pb-2 pr-4">Path</th>
                  <th className="pb-2 pr-4">Auth</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {(status.endpoints || []).map((ep, i) => (
                  <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="py-1.5 pr-4">
                      <Badge text={ep.method} color={methodColor(ep.method)} />
                    </td>
                    <td className="py-1.5 pr-4 font-mono text-xs text-gray-300">{ep.path}</td>
                    <td className="py-1.5 pr-4">
                      {ep.auth ? (
                        <Badge text="🔒 JWT" color="yellow" />
                      ) : (
                        <Badge text="public" color="gray" />
                      )}
                    </td>
                    <td className="py-1.5">
                      {ep.status === 'live' ? (
                        <Badge text="✓ live" color="green" />
                      ) : (
                        <Badge text="stub" color="gray" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Last updated ───────────────────────── */}
      {status && (
        <div className="text-xs text-gray-600 text-right">
          Server time: {new Date(status.timestamp).toLocaleString()}
        </div>
      )}
    </div>
  );
}
