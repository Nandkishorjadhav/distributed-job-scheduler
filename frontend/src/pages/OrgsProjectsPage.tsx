import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';

interface User {
  id: string;
  email: string;
  name: string;
}

interface Organization {
  id: string;
  name: string;
  slug: string;
  role?: string;
  createdAt: string;
}

interface Project {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: string;
}

export function OrgsProjectsPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);

  // Create Org Form
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgSlug, setNewOrgSlug] = useState('');
  const [orgError, setOrgError] = useState<string | null>(null);

  // Create Project Form
  const [newProjName, setNewProjName] = useState('');
  const [newProjSlug, setNewProjSlug] = useState('');
  const [newProjDesc, setNewProjDesc] = useState('');
  const [projError, setProjError] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Load User & Orgs on mount
  useEffect(() => {
    const init = async () => {
      try {
        const userRes = await apiClient.get('/auth/me');
        setCurrentUser(userRes.data.data.user);

        const orgsRes = await apiClient.get('/orgs');
        const fetchedOrgs: Organization[] = orgsRes.data.data;
        setOrgs(fetchedOrgs);

        if (fetchedOrgs.length > 0) {
          setSelectedOrgId(fetchedOrgs[0].id);
        }
      } catch {
        navigate('/login');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [navigate]);

  // Load projects when selected organization changes
  useEffect(() => {
    if (!selectedOrgId) return;
    const loadProjects = async () => {
      try {
        const res = await apiClient.get(`/projects?organizationId=${selectedOrgId}`);
        setProjects(res.data.data);
      } catch {
        setProjects([]);
      }
    };
    loadProjects();
  }, [selectedOrgId]);

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setOrgError(null);
    try {
      const res = await apiClient.post('/orgs', {
        name: newOrgName,
        slug: newOrgSlug,
      });
      const createdOrg = res.data.data.organization;
      setOrgs((prev) => [createdOrg, ...prev]);
      setSelectedOrgId(createdOrg.id);
      setNewOrgName('');
      setNewOrgSlug('');
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const res = (err as { response?: { data?: { error?: string } } }).response;
        setOrgError(res?.data?.error || 'Failed to create organization');
      }
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrgId) return;
    setProjError(null);
    try {
      const res = await apiClient.post('/projects', {
        organizationId: selectedOrgId,
        name: newProjName,
        slug: newProjSlug,
        description: newProjDesc || undefined,
      });
      const createdProj = res.data.data.project;
      setProjects((prev) => [createdProj, ...prev]);
      setNewProjName('');
      setNewProjSlug('');
      setNewProjDesc('');
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const res = (err as { response?: { data?: { error?: string } } }).response;
        setProjError(res?.data?.error || 'Failed to create project');
      }
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!confirm('Are you sure you want to delete this project?')) return;
    try {
      await apiClient.delete(`/projects/${projectId}`);
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const res = (err as { response?: { data?: { error?: string } } }).response;
        alert(res?.data?.error || 'Failed to delete project');
      }
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Loading organization resources...
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* ── User Header ────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Resource Management</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Logged in as <strong className="text-blue-400">{currentUser?.name}</strong> ({currentUser?.email})
          </p>
        </div>
        <button
          onClick={() => {
            localStorage.removeItem('access_token');
            navigate('/login');
          }}
          className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-xs font-semibold text-gray-300 border border-gray-700 rounded-lg transition-colors"
        >
          Sign Out
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        {/* ── Column 1: Organizations ───────────────────────────── */}
        <div className="space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h2 className="text-base font-bold text-white mb-4">Create Organization</h2>
            {orgError && (
              <div className="mb-4 bg-red-950 border border-red-800 text-red-300 px-3 py-2 rounded text-xs">
                ⚠ {orgError}
              </div>
            )}
            <form onSubmit={handleCreateOrg} className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1 font-semibold">Org Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Acme Corp"
                  value={newOrgName}
                  onChange={(e) => {
                    setNewOrgName(e.target.value);
                    if (!newOrgSlug) setNewOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-'));
                  }}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1 font-semibold">Org Slug</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. acme-corp"
                  value={newOrgSlug}
                  onChange={(e) => setNewOrgSlug(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                + Create Organization
              </button>
            </form>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h2 className="text-base font-bold text-white mb-3">Your Organizations ({orgs.length})</h2>
            {orgs.length === 0 ? (
              <p className="text-xs text-gray-500">No organizations found. Create one above!</p>
            ) : (
              <div className="space-y-2">
                {orgs.map((org) => (
                  <div
                    key={org.id}
                    onClick={() => setSelectedOrgId(org.id)}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors flex items-center justify-between ${
                      selectedOrgId === org.id
                        ? 'bg-blue-950/40 border-blue-600'
                        : 'bg-gray-800/40 border-gray-800 hover:border-gray-700'
                    }`}
                  >
                    <div>
                      <div className="text-sm font-semibold text-white">{org.name}</div>
                      <div className="text-xs font-mono text-gray-400">{org.slug}</div>
                    </div>
                    {org.role && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-blue-900/60 text-blue-300 border border-blue-700">
                        {org.role}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Column 2: Projects ────────────────────────────────── */}
        <div className="space-y-6">
          {selectedOrgId ? (
            <>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <h2 className="text-base font-bold text-white mb-4">Create Project</h2>
                {projError && (
                  <div className="mb-4 bg-red-950 border border-red-800 text-red-300 px-3 py-2 rounded text-xs">
                    ⚠ {projError}
                  </div>
                )}
                <form onSubmit={handleCreateProject} className="space-y-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 font-semibold">Project Name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Main Backend"
                      value={newProjName}
                      onChange={(e) => {
                        setNewProjName(e.target.value);
                        if (!newProjSlug) setNewProjSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-'));
                      }}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 font-semibold">Project Slug</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. main-backend"
                      value={newProjSlug}
                      onChange={(e) => setNewProjSlug(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 font-semibold">Description (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. Core platform services"
                      value={newProjDesc}
                      onChange={(e) => setNewProjDesc(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2 bg-green-600 hover:bg-green-500 text-white text-xs font-semibold rounded-lg transition-colors"
                  >
                    + Create Project
                  </button>
                </form>
              </div>

              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <h2 className="text-base font-bold text-white mb-3">Projects in Selected Org ({projects.length})</h2>
                {projects.length === 0 ? (
                  <p className="text-xs text-gray-500">No projects found in this organization. Create one above!</p>
                ) : (
                  <div className="space-y-3">
                    {projects.map((proj) => (
                      <div
                        key={proj.id}
                        className="p-3 bg-gray-800/40 border border-gray-800 rounded-lg flex items-center justify-between"
                      >
                        <div>
                          <div className="text-sm font-semibold text-white">{proj.name}</div>
                          <div className="text-xs font-mono text-blue-400">{proj.slug}</div>
                          {proj.description && (
                            <div className="text-xs text-gray-400 mt-1">{proj.description}</div>
                          )}
                        </div>
                        <button
                          onClick={() => handleDeleteProject(proj.id)}
                          className="px-2 py-1 bg-red-950 hover:bg-red-900 text-red-300 border border-red-800 rounded text-xs transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center text-gray-500 text-sm">
              Select or create an organization to manage its projects.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
