import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';

export function LoginPage() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const endpoint = isSignUp ? '/auth/register' : '/auth/login';
      const payload = isSignUp ? { name, email, password } : { email, password };

      const response = await apiClient.post(endpoint, payload);
      const { token } = response.data.data;

      localStorage.setItem('access_token', token);
      navigate('/orgs');
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const res = (err as { response?: { data?: { error?: string; details?: unknown } } }).response;
        setError(res?.data?.error || 'Authentication failed. Check your credentials.');
      } else {
        setError('Failed to connect to the backend server. Is the API running on port 3000?');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto my-12 bg-gray-900 border border-gray-800 rounded-xl p-8 shadow-2xl">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-white mb-2">
          {isSignUp ? 'Create an Account' : 'Welcome Back'}
        </h1>
        <p className="text-sm text-gray-400">
          {isSignUp
            ? 'Sign up to manage organizations, projects & job queues'
            : 'Sign in to access your dashboard and project resources'}
        </p>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────── */}
      <div className="flex border-b border-gray-800 mb-6">
        <button
          type="button"
          onClick={() => { setIsSignUp(false); setError(null); }}
          className={`flex-1 py-2 text-center text-sm font-semibold border-b-2 transition-colors ${
            !isSignUp
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          Sign In
        </button>
        <button
          type="button"
          onClick={() => { setIsSignUp(true); setError(null); }}
          className={`flex-1 py-2 text-center text-sm font-semibold border-b-2 transition-colors ${
            isSignUp
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          Sign Up
        </button>
      </div>

      {/* ── Error Banner ──────────────────────────────────────── */}
      {error && (
        <div className="mb-6 bg-red-950 border border-red-800 text-red-300 px-4 py-3 rounded-lg text-xs font-mono">
          ⚠ {error}
        </div>
      )}

      {/* ── Form ──────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {isSignUp && (
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1">Full Name</label>
            <input
              type="text"
              required
              placeholder="e.g. Alice Admin"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            />
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-1">Email Address</label>
          <input
            type="email"
            required
            placeholder="e.g. alice@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-1">Password</label>
          <input
            type="password"
            required
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
          />
          {isSignUp && (
            <span className="text-[10px] text-gray-500 mt-1 block">Must be at least 8 characters long</span>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white text-sm font-semibold rounded-lg transition-colors mt-2"
        >
          {loading ? 'Processing...' : isSignUp ? 'Create Account' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}
