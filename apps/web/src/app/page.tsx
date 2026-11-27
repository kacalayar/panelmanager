"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Boxes,
  Cpu,
  FolderPlus,
  HardDrive,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { AppShell } from "@/components/Sidebar";
import { apiFetch, setAuthToken } from "@/lib/api";

interface AuthStatus {
  initialized: boolean;
  user: { id: string; email: string; name: string; role: string } | null;
}

interface SystemStatus {
  docker: {
    connected: boolean;
    dockerVersion: string;
    swarmActive: boolean;
    nodeCount: number;
    cpus: number;
    totalMemoryMb: number;
    containersRunning: number;
    error?: string;
  };
  host: {
    hostname: string;
    cpus: number;
    memoryTotalMb: number;
    memoryUsedMb: number;
  };
}

interface ProjectItem {
  id: string;
  name: string;
  slug: string;
  description: string;
  networkName: string;
  serviceCount: number;
  runningCount: number;
}

export default function HomePage() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // Auth form
  const [email, setEmail] = useState("");
  const [name, setName] = useState("Admin");
  const [password, setPassword] = useState("");

  // Create project modal
  const [showCreate, setShowCreate] = useState(false);
  const [projName, setProjName] = useState("");
  const [projDesc, setProjDesc] = useState("");

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const a = await apiFetch<AuthStatus>("/api/auth/status");
      setAuth(a);
      if (a.user) {
        const [sys, proj] = await Promise.all([
          apiFetch<SystemStatus>("/api/system/status"),
          apiFetch<{ projects: ProjectItem[] }>("/api/projects"),
        ]);
        setSystem(sys);
        setProjects(proj.projects);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const endpoint = auth?.initialized ? "/api/auth/login" : "/api/auth/setup";
      const payload = auth?.initialized ? { email, password } : { email, name, password };
      const res = await apiFetch<{ token: string }>(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setAuthToken(res.token);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiFetch("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name: projName, description: projDesc }),
      });
      setProjName("");
      setProjDesc("");
      setShowCreate(false);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleInitSwarm() {
    try {
      await apiFetch("/api/system/swarm/init", { method: "POST", body: "{}" });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (loading && !auth) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-zinc-400">
        Memuat PanelManager...
      </div>
    );
  }

  if (!auth?.user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
        <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 shadow-xl">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
              <Boxes className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">
                {auth?.initialized ? "Masuk ke PanelManager" : "Setup PanelManager"}
              </h1>
              <p className="text-xs text-zinc-400">
                {auth?.initialized
                  ? "Kelola server Docker Swarm & Traefik Anda"
                  : "Buat akun Owner pertama untuk mengaktifkan panel"}
              </p>
            </div>
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            {!auth?.initialized && (
              <div>
                <label className="mb-1 block text-xs text-zinc-400">Nama</label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@domain.com"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Password</label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimal 8 karakter"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-medium text-zinc-950 transition hover:bg-emerald-400"
            >
              {auth?.initialized ? "Masuk" : "Buat Akun & Mulai"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const memPct = system
    ? Math.round((system.host.memoryUsedMb / Math.max(1, system.host.memoryTotalMb)) * 100)
    : 0;

  return (
    <AppShell onLoggedOut={() => void loadAll()}>
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-sm text-zinc-400">
              Halo, {auth.user.name}. Kelola semua project, database, dan domain tanpa batas.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-emerald-400"
          >
            <FolderPlus className="h-4 w-4" />
            Project Baru
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* System Status Grid */}
        {system && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Docker Swarm</span>
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-lg font-semibold">
                  {system.docker.swarmActive
                    ? `Active (${system.docker.nodeCount} Node)`
                    : system.docker.connected
                      ? "Swarm Inactive"
                      : "Docker Offline"}
                </span>
                {system.docker.connected && !system.docker.swarmActive && (
                  <button
                    onClick={handleInitSwarm}
                    className="rounded bg-emerald-500/20 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/30"
                  >
                    Init Swarm
                  </button>
                )}
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                {system.docker.connected
                  ? `Engine v${system.docker.dockerVersion}`
                  : system.docker.error || "Hubungkan daemon Docker"}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Host Memory</span>
                <HardDrive className="h-4 w-4 text-sky-400" />
              </div>
              <div className="mt-2 text-lg font-semibold">
                {system.host.memoryUsedMb} / {system.host.memoryTotalMb} MB
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full bg-sky-400" style={{ width: `${memPct}%` }} />
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>CPU & Containers</span>
                <Cpu className="h-4 w-4 text-amber-400" />
              </div>
              <div className="mt-2 text-lg font-semibold">{system.host.cpus} vCPU</div>
              <div className="mt-1 text-xs text-zinc-500">
                {system.docker.containersRunning} containers berjalan
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Total Projects</span>
                <Activity className="h-4 w-4 text-violet-400" />
              </div>
              <div className="mt-2 text-lg font-semibold">{projects.length} Projects</div>
              <div className="mt-1 text-xs text-zinc-500">Unlimited free tier</div>
            </div>
          </div>
        )}

        {/* Projects Grid */}
        <section className="space-y-4">
          <h2 className="text-lg font-medium">Projects</h2>
          {projects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-800 p-12 text-center">
              <Sparkles className="mx-auto mb-3 h-8 w-8 text-emerald-400" />
              <h3 className="text-base font-medium">Belum ada Project</h3>
              <p className="mt-1 text-sm text-zinc-400">
                Buat project pertama untuk mulai deploy aplikasi, database, atau template 1-klik.
              </p>
              <button
                onClick={() => setShowCreate(true)}
                className="mt-4 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400"
              >
                + Buat Project Pertama
              </button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => (
                <Link
                  key={p.id}
                  href={`/projects/${p.id}`}
                  className="group rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 transition hover:border-emerald-500/50 hover:bg-zinc-900/80"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-zinc-100 group-hover:text-emerald-400">
                        {p.name}
                      </h3>
                      <p className="mt-0.5 text-xs text-zinc-500">Network: {p.networkName}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-zinc-600 transition group-hover:translate-x-0.5 group-hover:text-emerald-400" />
                  </div>
                  {p.description && (
                    <p className="mt-3 line-clamp-2 text-xs text-zinc-400">{p.description}</p>
                  )}
                  <div className="mt-4 flex items-center gap-3 text-xs text-zinc-400">
                    <span>{p.serviceCount} services</span>
                    <span className="text-emerald-400">{p.runningCount} running</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Create Project Modal */}
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
              <h3 className="text-lg font-semibold">Buat Project Baru</h3>
              <form onSubmit={handleCreateProject} className="mt-4 space-y-4">
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">Nama Project</label>
                  <input
                    required
                    value={projName}
                    onChange={(e) => setProjName(e.target.value)}
                    placeholder="Contoh: SaaS Production"
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">Deskripsi (Opsional)</label>
                  <input
                    value={projDesc}
                    onChange={(e) => setProjDesc(e.target.value)}
                    placeholder="Stack aplikasi & database klien"
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCreate(false)}
                    className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400"
                  >
                    Simpan
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
