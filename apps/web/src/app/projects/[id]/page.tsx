"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Box,
  Database,
  Download,
  ExternalLink,
  Layers,
  Plus,
  Rocket,
  Trash2,
} from "lucide-react";
import { AppShell } from "@/components/Sidebar";
import { apiFetch } from "@/lib/api";

interface ServiceItem {
  id: string;
  name: string;
  slug: string;
  kind: string;
  sourceType: string;
  status: string;
  replicas: number;
  domains: Array<{ id: string; host: string; httpsEnabled: boolean }>;
}

interface TemplateItem {
  id: string;
  name: string;
  category: string;
  description: string;
  logoText: string;
  fields: Array<{
    key: string;
    label: string;
    type: string;
    required?: boolean;
    defaultValue?: string;
    placeholder?: string;
  }>;
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = params.id;

  const [project, setProject] = useState<{
    id: string;
    name: string;
    slug: string;
    networkName: string;
  } | null>(null);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [modal, setModal] = useState<"app" | "db" | "template" | "compose" | null>(null);
  const [composeYaml, setComposeYaml] = useState("");
  const [error, setError] = useState("");

  // New App state
  const [appName, setAppName] = useState("");
  const [sourceType, setSourceType] = useState<"image" | "git" | "dockerfile" | "nixpacks">("git");
  const [image, setImage] = useState("nginx:alpine");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");

  // New DB state
  const [dbKind, setDbKind] = useState<"postgres" | "mysql" | "mariadb" | "mongo" | "redis">("postgres");
  const [dbName, setDbName] = useState("");

  // Template state
  const [selectedTpl, setSelectedTpl] = useState<TemplateItem | null>(null);
  const [tplInputs, setTplInputs] = useState<Record<string, string>>({});

  const loadData = useCallback(async () => {
    try {
      const [projRes, tplRes] = await Promise.all([
        apiFetch<{ project: any; services: ServiceItem[] }>(`/api/projects/${projectId}`),
        apiFetch<{ templates: TemplateItem[] }>("/api/templates"),
      ]);
      setProject(projRes.project);
      setServices(projRes.services);
      setTemplates(tplRes.templates);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleCreateApp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const res = await apiFetch<{ service: { id: string } }>("/api/services", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          name: appName,
          kind: "app",
          sourceType,
          sourceConfig:
            sourceType === "image" ? { image } : { repoUrl, branch },
        }),
      });
      setModal(null);
      router.push(`/services/${res.service.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCreateDb(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const res = await apiFetch<{ service: { id: string } }>("/api/services", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          name: dbName || `${dbKind}-db`,
          kind: dbKind,
          sourceType: "image",
          autoDeploy: true,
        }),
      });
      setModal(null);
      router.push(`/services/${res.service.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDeployTemplate(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTpl) return;
    setError("");
    try {
      await apiFetch(`/api/projects/${projectId}/templates`, {
        method: "POST",
        body: JSON.stringify({
          templateId: selectedTpl.id,
          inputs: tplInputs,
        }),
      });
      setModal(null);
      setSelectedTpl(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleExportCompose() {
    setError("");
    try {
      const yaml = await apiFetch<string>(`/api/projects/${projectId}/export-compose`);
      setComposeYaml(yaml);
      setModal("compose");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDeleteProject() {
    if (!confirm("Hapus project beserta seluruh servicenya?")) return;
    setError("");
    try {
      await apiFetch(`/api/projects/${projectId}`, { method: "DELETE" });
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="rounded-lg border border-zinc-800 p-2 text-zinc-400 hover:bg-zinc-900 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <h1 className="text-2xl font-semibold">{project?.name || "Project"}</h1>
              <p className="text-xs text-zinc-500">
                Slug: {project?.slug} • Overlay Network: {project?.networkName}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleExportCompose}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-900"
            >
              <Download className="h-3.5 w-3.5" />
              Export Compose
            </button>
            <button
              onClick={handleDeleteProject}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-900/60 px-3 py-2 text-xs text-red-400 hover:bg-red-950/40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Hapus Project
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Quick Action Bar */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setModal("app")}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400"
          >
            <Plus className="h-4 w-4" />
            Deploy App (Git / Image)
          </button>
          <button
            onClick={() => setModal("db")}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
          >
            <Database className="h-4 w-4 text-sky-400" />
            Tambah Database
          </button>
          <button
            onClick={() => setModal("template")}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
          >
            <Layers className="h-4 w-4 text-violet-400" />
            1-Click Templates ({templates.length})
          </button>
        </div>

        {/* Services List */}
        <div className="grid gap-4 md:grid-cols-2">
          {services.map((svc) => (
            <Link
              key={svc.id}
              href={`/services/${svc.id}`}
              className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 transition hover:border-emerald-500/50"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-800 text-zinc-200">
                    {svc.kind === "app" ? (
                      <Box className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <Database className="h-4 w-4 text-sky-400" />
                    )}
                  </div>
                  <div>
                    <div className="font-semibold text-zinc-100">{svc.name}</div>
                    <div className="text-xs text-zinc-500">
                      {svc.kind.toUpperCase()} • {svc.sourceType} • internal host:{" "}
                      <code className="text-zinc-300">{svc.slug}</code>
                    </div>
                  </div>
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                    svc.status === "running"
                      ? "bg-emerald-500/15 text-emerald-400"
                      : svc.status === "error"
                        ? "bg-red-500/15 text-red-400"
                        : svc.status === "building"
                          ? "bg-amber-500/15 text-amber-400"
                          : "bg-zinc-800 text-zinc-400"
                  }`}
                >
                  {svc.status}
                </span>
              </div>

              {svc.domains.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {svc.domains.map((d) => (
                    <span
                      key={d.id}
                      className="inline-flex items-center gap-1 rounded bg-zinc-800/80 px-2 py-0.5 text-xs text-zinc-300"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {d.httpsEnabled ? "https://" : "http://"}
                      {d.host}
                    </span>
                  ))}
                </div>
              )}
            </Link>
          ))}
        </div>

        {/* New App Modal */}
        {modal === "app" && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
            <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
              <h3 className="text-lg font-semibold">Deploy App Service</h3>
              <form onSubmit={handleCreateApp} className="mt-4 space-y-4">
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">Nama Service</label>
                  <input
                    required
                    value={appName}
                    onChange={(e) => setAppName(e.target.value)}
                    placeholder="api-backend"
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">Metode Build / Source</label>
                  <select
                    value={sourceType}
                    onChange={(e) => setSourceType(e.target.value as any)}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
                  >
                    <option value="git">Git Auto-Detect (Dockerfile atau Nixpacks)</option>
                    <option value="nixpacks">Git + Nixpacks (Tanpa Dockerfile)</option>
                    <option value="dockerfile">Git + Dockerfile</option>
                    <option value="image">Docker Image (Docker Hub / GHCR)</option>
                  </select>
                </div>
                {sourceType === "image" ? (
                  <div>
                    <label className="mb-1 block text-xs text-zinc-400">Docker Image</label>
                    <input
                      required
                      value={image}
                      onChange={(e) => setImage(e.target.value)}
                      placeholder="nginx:alpine"
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
                    />
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="mb-1 block text-xs text-zinc-400">Git Repository URL</label>
                      <input
                        required
                        value={repoUrl}
                        onChange={(e) => setRepoUrl(e.target.value)}
                        placeholder="https://github.com/user/repo.git"
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-zinc-400">Branch</label>
                      <input
                        value={branch}
                        onChange={(e) => setBranch(e.target.value)}
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
                      />
                    </div>
                  </>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setModal(null)}
                    className="rounded-lg border border-zinc-700 px-4 py-2 text-sm"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950"
                  >
                    Buat App
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* New DB Modal */}
        {modal === "db" && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
            <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
              <h3 className="text-lg font-semibold">Tambah Managed Database</h3>
              <form onSubmit={handleCreateDb} className="mt-4 space-y-4">
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">Engine Database</label>
                  <select
                    value={dbKind}
                    onChange={(e) => setDbKind(e.target.value as any)}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
                  >
                    <option value="postgres">PostgreSQL 16</option>
                    <option value="mysql">MySQL 8.4</option>
                    <option value="mariadb">MariaDB 11</option>
                    <option value="mongo">MongoDB 7</option>
                    <option value="redis">Redis 7</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">Nama Service</label>
                  <input
                    value={dbName}
                    onChange={(e) => setDbName(e.target.value)}
                    placeholder={`${dbKind}-main`}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
                  />
                </div>
                <p className="text-xs text-zinc-400">
                  Password kuat & volume persisten otomatis dibuatkan.
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setModal(null)}
                    className="rounded-lg border border-zinc-700 px-4 py-2 text-sm"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950"
                  >
                    Provision & Deploy
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Templates Modal */}
        {modal === "template" && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
            <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">1-Click App Templates</h3>
                <button onClick={() => setModal(null)} className="text-sm text-zinc-400">
                  Tutup
                </button>
              </div>

              {!selectedTpl ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {templates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        setSelectedTpl(t);
                        const defaults: Record<string, string> = {};
                        t.fields.forEach((f) => {
                          if (f.defaultValue) defaults[f.key] = f.defaultValue;
                        });
                        setTplInputs(defaults);
                      }}
                      className="flex items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-left hover:border-emerald-500/60"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 font-mono text-xs font-bold text-violet-300">
                        {t.logoText}
                      </div>
                      <div>
                        <div className="font-medium text-zinc-100">{t.name}</div>
                        <div className="text-[11px] text-emerald-400">{t.category}</div>
                        <div className="mt-1 text-xs text-zinc-400">{t.description}</div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <form onSubmit={handleDeployTemplate} className="mt-4 space-y-4">
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                    <div className="font-medium">{selectedTpl.name}</div>
                    <div className="text-xs text-zinc-400">{selectedTpl.description}</div>
                  </div>
                  {selectedTpl.fields.map((f) => (
                    <div key={f.key}>
                      <label className="mb-1 block text-xs text-zinc-400">{f.label}</label>
                      <input
                        required={f.required}
                        value={tplInputs[f.key] || ""}
                        placeholder={f.placeholder}
                        onChange={(e) =>
                          setTplInputs((prev) => ({ ...prev, [f.key]: e.target.value }))
                        }
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
                      />
                    </div>
                  ))}
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedTpl(null)}
                      className="rounded-lg border border-zinc-700 px-4 py-2 text-sm"
                    >
                      Kembali
                    </button>
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950"
                    >
                      <Rocket className="h-4 w-4" />
                      Deploy Sekarang
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}

        {/* Compose Export Modal */}
        {modal === "compose" && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
            <div className="w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Export docker-compose.yml</h3>
                <button onClick={() => setModal(null)} className="text-sm text-zinc-400">
                  Tutup
                </button>
              </div>
              <pre className="mt-4 max-h-96 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-xs text-emerald-300">
                {composeYaml}
              </pre>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
