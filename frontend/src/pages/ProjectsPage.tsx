import React, { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { useNavigate } from 'react-router-dom';
import { Building2, FolderKanban, Plus, ArrowRight } from 'lucide-react';

export const ProjectsPage: React.FC = () => {
  const [projects, setProjects] = useState<any[]>([]);
  const [orgs, setOrgs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');

  // Modals
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');

  const [showCreateProject, setShowCreateProject] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectSlug, setProjectSlug] = useState('');
  const [projectDesc, setProjectDesc] = useState('');

  const navigate = useNavigate();

  const fetchData = async () => {
    try {
      const [projRes, orgRes] = await Promise.all([
        apiClient.get('/projects'),
        apiClient.get('/orgs'),
      ]);

      if (projRes.data?.data) {
        setProjects(projRes.data.data);
      }
      if (orgRes.data?.data) {
        setOrgs(orgRes.data.data);
        if (!selectedOrgId && orgRes.data.data.length > 0) {
          setSelectedOrgId(orgRes.data.data[0].id);
        }
      }
    } catch {
      // Handle error
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const formatSlug = (str: string) =>
    str
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanSlug = formatSlug(orgSlug || orgName);
    if (cleanSlug.length < 2) {
      alert('Organization slug must be at least 2 characters.');
      return;
    }

    try {
      const res = await apiClient.post('/orgs', { name: orgName.trim(), slug: cleanSlug });
      setShowCreateOrg(false);
      setOrgName('');
      setOrgSlug('');
      const newOrg = res.data?.data?.organization;
      if (newOrg) {
        setSelectedOrgId(newOrg.id);
      }
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to create organization');
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrgId) {
      alert('Please select or create an organization first.');
      return;
    }

    const cleanSlug = formatSlug(projectSlug || projectName);
    if (cleanSlug.length < 2) {
      alert('Project slug must be at least 2 characters.');
      return;
    }

    try {
      await apiClient.post('/projects', {
        organizationId: selectedOrgId,
        name: projectName.trim(),
        slug: cleanSlug,
        description: projectDesc.trim(),
      });
      setShowCreateProject(false);
      setProjectName('');
      setProjectSlug('');
      setProjectDesc('');
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to create project');
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Projects & Organizations</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Multi-tenant tenant boundaries and resource grouping
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowCreateOrg(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-900 border border-gray-800 hover:border-gray-700 text-xs font-semibold text-gray-300 hover:text-white transition-all shadow-sm"
          >
            <Building2 className="w-4 h-4" />
            <span>New Organization</span>
          </button>
          <button
            onClick={() => {
              if (orgs.length === 0) {
                setShowCreateOrg(true);
              } else {
                setShowCreateProject(true);
              }
            }}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition-all shadow-md hover:shadow-blue-500/20"
          >
            <Plus className="w-4 h-4" />
            <span>New Project</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <div className="w-8 h-8 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-16 bg-gray-900 border border-gray-800 rounded-2xl">
          <FolderKanban className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-white">No projects found</h3>
          <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
            {orgs.length === 0
              ? 'Create an organization first to establish a tenant boundary, then add projects.'
              : 'Create a project inside your organization to start dispatching distributed queues.'}
          </p>
          <button
            onClick={() => (orgs.length === 0 ? setShowCreateOrg(true) : setShowCreateProject(true))}
            className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold"
          >
            {orgs.length === 0 ? 'Create Organization' : 'Create Project'}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {projects.map((p) => (
            <div
              key={p.id}
              className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl p-5 transition-all shadow-sm flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between">
                  <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    <FolderKanban className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-mono text-gray-500">{p.slug}</span>
                </div>
                <h3 className="text-base font-bold text-white mt-3.5">{p.name}</h3>
                <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                  {p.description || 'No description provided.'}
                </p>
              </div>

              <div className="mt-6 pt-4 border-t border-gray-800 flex items-center justify-between">
                <button
                  onClick={() => navigate(`/queues?projectId=${p.id}`)}
                  className="text-xs text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-1.5"
                >
                  <span>View Queues</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs text-gray-500">
                  {new Date(p.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Create Organization */}
      {showCreateOrg && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-white mb-4">Create Organization</h2>
            <form onSubmit={handleCreateOrg} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                  Organization Name
                </label>
                <input
                  type="text"
                  required
                  value={orgName}
                  onChange={(e) => {
                    setOrgName(e.target.value);
                    if (!orgSlug) setOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-'));
                  }}
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                  Slug (Identifier)
                </label>
                <input
                  type="text"
                  required
                  value={orgSlug}
                  onChange={(e) => setOrgSlug(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowCreateOrg(false)}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl shadow-md"
                >
                  Create Organization
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Create Project */}
      {showCreateProject && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-white mb-4">Create Project</h2>
            <form onSubmit={handleCreateProject} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                  Target Organization
                </label>
                <select
                  value={selectedOrgId}
                  onChange={(e) => setSelectedOrgId(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} ({o.slug})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                  Project Name
                </label>
                <input
                  type="text"
                  required
                  value={projectName}
                  onChange={(e) => {
                    setProjectName(e.target.value);
                    if (!projectSlug) setProjectSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-'));
                  }}
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                  Slug
                </label>
                <input
                  type="text"
                  required
                  value={projectSlug}
                  onChange={(e) => setProjectSlug(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-300 uppercase mb-1.5">
                  Description
                </label>
                <textarea
                  value={projectDesc}
                  onChange={(e) => setProjectDesc(e.target.value)}
                  rows={2}
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowCreateProject(false)}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl shadow-md"
                >
                  Create Project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
