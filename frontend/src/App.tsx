import { Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';

// Pages
import { DashboardPage } from './pages/DashboardPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { QueuesPage } from './pages/QueuesPage';
import { QueueDetailsPage } from './pages/QueueDetailsPage';
import { QueueConfigPage } from './pages/QueueConfigPage';
import { JobsPage } from './pages/JobsPage';
import { JobDetailsPage } from './pages/JobDetailsPage';
import { WorkersPage } from './pages/WorkersPage';
import { DLQPage } from './pages/DLQPage';
import { LoginPage } from './pages/LoginPage';
import { StatusPage } from './pages/StatusPage';
import { ApiExplorer } from './pages/ApiExplorer';

import {
  LayoutDashboard,
  Building2,
  Layers,
  ListTodo,
  Server,
  Skull,
  Activity,
  Code2,
  LogOut,
  LogIn,
  Zap,
} from 'lucide-react';

const navigationLinks = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/projects', label: 'Projects', icon: Building2 },
  { to: '/queues', label: 'Queues', icon: Layers },
  { to: '/jobs', label: 'Jobs', icon: ListTodo },
  { to: '/workers', label: 'Workers', icon: Server },
  { to: '/dlq', label: 'DLQ', icon: Skull },
  { to: '/api', label: 'API Docs', icon: Code2 },
  { to: '/status', label: 'System Status', icon: Activity },
];

export function App() {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col font-sans">
      {/* ── Top Navbar ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-gray-900/90 backdrop-blur-md border-b border-gray-800 px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          {/* Logo */}
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2.5 text-left group focus:outline-none"
          >
            <div className="p-1.5 rounded-xl bg-blue-600 text-white shadow-md shadow-blue-500/20 group-hover:bg-blue-500 transition-all">
              <Zap className="w-5 h-5 fill-current" />
            </div>
            <div>
              <span className="text-sm font-black tracking-tight text-white block">
                DISTRIBUTED SCHEDULER
              </span>
              <span className="text-[10px] uppercase font-bold tracking-widest text-blue-400 block -mt-1">
                Enterprise Node
              </span>
            </div>
          </button>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-1">
            {navigationLinks.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800/60'
                  }`
                }
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        {/* User Account / Auth Actions */}
        <div className="flex items-center gap-3">
          {isAuthenticated && user ? (
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex flex-col text-right">
                <span className="text-xs font-semibold text-white leading-tight">{user.name}</span>
                <span className="text-[10px] text-gray-500 leading-tight">{user.email}</span>
              </div>
              <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center justify-center font-bold text-xs">
                {user.name ? user.name[0].toUpperCase() : 'U'}
              </div>
              <button
                onClick={logout}
                className="p-1.5 rounded-lg text-gray-400 hover:text-rose-400 hover:bg-gray-800 transition-colors"
                title="Sign Out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => navigate('/login')}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl transition-all shadow-md shadow-blue-500/10"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Sign In</span>
            </button>
          )}
        </div>
      </header>

      {/* ── Mobile Nav Bar ─────────────────────────────────────── */}
      <div className="md:hidden bg-gray-900 border-b border-gray-800 px-4 py-2 flex items-center gap-2 overflow-x-auto">
        {navigationLinks.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                isActive ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
              }`
            }
          >
            <Icon className="w-3 h-3" />
            <span>{label}</span>
          </NavLink>
        ))}
      </div>

      {/* ── Main Page Content ──────────────────────────────────── */}
      <main className="flex-1 p-4 sm:p-6 overflow-auto">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/orgs" element={<ProjectsPage />} />
          <Route path="/queues" element={<QueuesPage />} />
          <Route path="/queues/:queueId" element={<QueueDetailsPage />} />
          <Route path="/queues/:queueId/config" element={<QueueConfigPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/jobs/:jobId" element={<JobDetailsPage />} />
          <Route path="/workers" element={<WorkersPage />} />
          <Route path="/dlq" element={<DLQPage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/api" element={<ApiExplorer />} />
          <Route path="*" element={<DashboardPage />} />
        </Routes>
      </main>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="bg-gray-900/80 border-t border-gray-800 px-6 py-2.5 text-center text-xs text-gray-500 flex flex-col sm:flex-row items-center justify-between gap-2">
        <span><i>Engineered by Nandkishor Jadhav</i></span>
        {/* <div className="flex items-center gap-4 text-[11px] text-gray-400">
          <span>PostgreSQL 17</span>
          <span>·</span>
          <span>Redis 7</span>
          <span>·</span>
          <span>React 18</span>
        </div> */}
      </footer>
    </div>
  );
}
