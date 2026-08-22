import { useState } from 'react';

const API = 'http://localhost:3000';

const ENDPOINTS = [
  { method: 'GET',  path: '/api/v1/health',  auth: false, body: null,
    desc: 'Health check — no auth needed' },
  { method: 'GET',  path: '/api/v1/status',  auth: false, body: null,
    desc: 'Full system status — version, memory, uptime, all endpoints' },
  { method: 'POST', path: '/api/v1/auth/register', auth: false,
    body: JSON.stringify({ name: 'Alice', email: 'alice@example.com', password: 'secret123' }, null, 2),
    desc: 'Register a new user account' },
  { method: 'POST', path: '/api/v1/auth/login', auth: false,
    body: JSON.stringify({ email: 'alice@example.com', password: 'secret123' }, null, 2),
    desc: 'Login and get a JWT token' },
  { method: 'POST', path: '/api/v1/orgs', auth: true,
    body: JSON.stringify({ name: 'Acme Corp', slug: 'acme' }, null, 2),
    desc: 'Create an organisation (requires JWT)' },
  { method: 'POST', path: '/api/v1/queues', auth: true,
    body: JSON.stringify({ name: 'email-queue', priority: 1, concurrencyLimit: 5 }, null, 2),
    desc: 'Create a job queue' },
  { method: 'POST', path: '/api/v1/queues/QUEUE_ID/jobs', auth: true,
    body: JSON.stringify({ name: 'send-email', type: 'immediate', payload: { to: 'user@example.com' } }, null, 2),
    desc: 'Submit a job to a queue' },
];

function methodColor(method: string) {
  return {
    GET:    'text-blue-400  bg-blue-950  border-blue-800',
    POST:   'text-green-400 bg-green-950 border-green-800',
    PATCH:  'text-yellow-400 bg-yellow-950 border-yellow-800',
    DELETE: 'text-red-400   bg-red-950   border-red-800',
  }[method] ?? 'text-gray-400 bg-gray-900 border-gray-700';
}

export function ApiExplorer() {
  const [selected, setSelected] = useState(ENDPOINTS[0]);
  const [token, setToken]       = useState('');
  const [body, setBody]         = useState(ENDPOINTS[0].body ?? '');
  const [response, setResponse] = useState<string>('');
  const [status, setStatus]     = useState<number | null>(null);
  const [loading, setLoading]   = useState(false);
  const [elapsed, setElapsed]   = useState<number | null>(null);

  const select = (ep: typeof ENDPOINTS[0]) => {
    setSelected(ep);
    setBody(ep.body ?? '');
    setResponse('');
    setStatus(null);
    setElapsed(null);
  };

  const send = async () => {
    setLoading(true);
    setResponse('');
    const start = Date.now();
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (selected.auth && token) headers['Authorization'] = `Bearer ${token}`;
      const opts: RequestInit = { method: selected.method, headers };
      if (selected.body !== null && body.trim()) opts.body = body;
      const res = await fetch(`${API}${selected.path}`, opts);
      setStatus(res.status);
      setElapsed(Date.now() - start);
      const text = await res.text();
      try { setResponse(JSON.stringify(JSON.parse(text), null, 2)); }
      catch { setResponse(text); }
    } catch (e: unknown) {
      setStatus(0);
      setElapsed(Date.now() - start);
      setResponse(`Network error: ${e instanceof Error ? e.message : String(e)}\n\nMake sure the API server is running:\n  cd "d:\\Job Scheduler\\backend\\api"\n  npm run dev`);
    }
    setLoading(false);
  };

  const statusColor = !status ? 'text-gray-400'
    : status < 300  ? 'text-green-400'
    : status < 400  ? 'text-yellow-400'
    : status < 500  ? 'text-orange-400'
    : 'text-red-400';

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">API Explorer</h1>
      <p className="text-sm text-gray-400">Click an endpoint, optionally edit the body, then hit <strong>Send</strong>.</p>

      <div className="grid md:grid-cols-[280px_1fr] gap-4">

        {/* ── Left: endpoint list ──────────── */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          {ENDPOINTS.map((ep, i) => (
            <button
              key={i}
              onClick={() => select(ep)}
              className={`w-full text-left px-3 py-2.5 border-b border-gray-800 last:border-0 hover:bg-gray-800 transition-colors ${selected.path === ep.path && selected.method === ep.method ? 'bg-gray-800' : ''}`}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${methodColor(ep.method)}`}>
                  {ep.method}
                </span>
                {ep.auth && <span className="text-yellow-500 text-xs">🔒</span>}
              </div>
              <div className="text-xs font-mono text-gray-300 truncate">{ep.path}</div>
            </button>
          ))}
        </div>

        {/* ── Right: request + response ────── */}
        <div className="space-y-3">

          {/* Endpoint header */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="flex items-center gap-3 mb-1">
              <span className={`text-sm font-bold px-2 py-1 rounded border ${methodColor(selected.method)}`}>
                {selected.method}
              </span>
              <code className="text-sm font-mono text-blue-300">{selected.path}</code>
            </div>
            <p className="text-sm text-gray-400">{selected.desc}</p>
          </div>

          {/* JWT token input (for protected routes) */}
          {selected.auth && (
            <div className="bg-gray-900 border border-yellow-800/50 rounded-lg p-3">
              <label className="text-xs text-yellow-400 font-semibold block mb-1">
                🔒 Bearer Token (from POST /auth/login)
              </label>
              <input
                type="text"
                placeholder="Paste your JWT token here..."
                value={token}
                onChange={e => setToken(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-xs font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600"
              />
            </div>
          )}

          {/* Request body */}
          {selected.body !== null && (
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
              <label className="text-xs text-gray-400 font-semibold block mb-1">Request Body (JSON)</label>
              <textarea
                rows={6}
                value={body}
                onChange={e => setBody(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs font-mono text-gray-200 focus:outline-none focus:border-blue-600 resize-y"
              />
            </div>
          )}

          {/* Send button */}
          <button
            onClick={send}
            disabled={loading}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 rounded-lg text-sm font-semibold transition-colors"
          >
            {loading ? 'Sending...' : `▶  Send ${selected.method} Request`}
          </button>

          {/* Response */}
          {(response || status !== null) && (
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xs text-gray-400">Response</span>
                {status !== null && (
                  <span className={`text-sm font-bold font-mono ${statusColor}`}>
                    HTTP {status}
                  </span>
                )}
                {elapsed !== null && (
                  <span className="text-xs text-gray-500">{elapsed} ms</span>
                )}
              </div>
              <pre className="text-xs font-mono text-gray-300 overflow-auto max-h-72 whitespace-pre-wrap break-all">
                {response}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
