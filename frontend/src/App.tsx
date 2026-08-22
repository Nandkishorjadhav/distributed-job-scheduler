import { Routes, Route, NavLink } from 'react-router-dom';
import { StatusPage }       from './pages/StatusPage';
import { ApiExplorer }      from './pages/ApiExplorer';
import { LoginPage }        from './pages/LoginPage';
import { OrgsProjectsPage } from './pages/OrgsProjectsPage';
import { Placeholder }      from './pages/Placeholder';

const nav = [
  { to: '/',         label: '🟢 Status'          },
  { to: '/api',      label: '🔌 API Explorer'    },
  { to: '/login',    label: '🔑 Login / Sign Up' },
  { to: '/orgs',     label: '🏢 Orgs & Projects' },
  { to: '/queues',   label: '📋 Queues'           },
  { to: '/jobs',     label: '⚙️  Jobs'             },
  { to: '/workers',  label: '👷 Workers'          },
  { to: '/metrics',  label: '📊 Metrics'          },
];

export function App() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">

      {/* ── Top navbar ─────────────────────────────────────── */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between gap-6">
        <div className="flex items-center gap-6">
          <span className="text-blue-400 font-bold text-lg tracking-tight whitespace-nowrap">
            ⚡ Job Scheduler
          </span>
          <nav className="flex gap-1 flex-wrap">
            {nav.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded text-sm transition-colors ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      {/* ── Page content ───────────────────────────────────── */}
      <main className="flex-1 p-6 overflow-auto">
        <Routes>
          <Route path="/"         element={<StatusPage />} />
          <Route path="/api"      element={<ApiExplorer />} />
          <Route path="/login"    element={<LoginPage />} />
          <Route path="/orgs"     element={<OrgsProjectsPage />} />
          <Route path="/projects" element={<OrgsProjectsPage />} />
          <Route path="/queues"   element={<Placeholder title="Queues"  icon="📋" />} />
          <Route path="/jobs"     element={<Placeholder title="Jobs"    icon="⚙️" />} />
          <Route path="/workers"  element={<Placeholder title="Workers" icon="👷" />} />
          <Route path="/metrics"  element={<Placeholder title="Metrics" icon="📊" />} />
          <Route path="*"         element={<StatusPage />} />
        </Routes>
      </main>

      {/* ── Footer ─────────────────────────────────────────── */}
      <footer className="bg-gray-900 border-t border-gray-800 px-6 py-2 text-center text-xs text-gray-600">
        Distributed Job Scheduler · Node.js + TypeScript + PostgreSQL + Redis + React
      </footer>
    </div>
  );
}
