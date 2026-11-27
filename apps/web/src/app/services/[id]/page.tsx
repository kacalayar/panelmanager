"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ArrowLeft,
  Cpu,
  Globe,
  HardDrive,
  Play,
  RotateCcw,
  Save,
  Square,
  Terminal as TerminalIcon,
  Trash2,
} from "lucide-react";
import { AppShell } from "@/components/Sidebar";
import { apiFetch, getAuthToken, getWsBaseUrl } from "@/lib/api";

const TerminalView = dynamic(
  () => import("@/components/TerminalView").then((m) => m.TerminalView),
  { ssr: false }
);

type TabKey = "general" | "env" | "domains" | "mounts" | "logs" | "terminal" | "backups";

export default function ServiceDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const serviceId = params.id;

  const [tab, setTab] = useState<TabKey>("general");
  const [data, setData] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [runtimeLogs, setRuntimeLogs] = useState("");
  const [liveDeployLogs, setLiveDeployLogs] = useState("");
  const [envText, setEnvText] = useState("");
  const [destinations, setDestinations] = useState<any[]>([]);
  const [backupRuns, setBackupRuns] = useState<any[]>([]);
  const [selectedDestId, setSelectedDestId] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  // Domain form
  const [host, setHost] = useState("");
  const [internalPort, setInternalPort] = useState(80);
  const [httpsEnabled, setHttpsEnabled] = useState(true);

  // Mount form
  const [mountSource, setMountSource] = useState("");
  const [mountTarget, setMountTarget] = useState("");

  // Source edit
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [image, setImage] = useState("");
  const [cpuLimit, setCpuLimit] = useState("");
  const [memoryLimitMb, setMemoryLimitMb] = useState(0);
  const deployWsRef = useRef<WebSocket | null>(null);

  const loadService = useCallback(async () => {
    try {
      const [res, destRes, runRes] = await Promise.all([
        apiFetch<any>(`/api/services/${serviceId}`),
        apiFetch<{ destinations: any[] }>("/api/backups/destinations"),
        apiFetch<{ runs: any[] }>(`/api/backups/runs?serviceId=${serviceId}`),
      ]);
      setData(res);
      setDestinations(destRes.destinations);
      setBackupRuns(runRes.runs);
      if (destRes.destinations[0]) {
        setSelectedDestId((prev) => prev || destRes.destinations[0].id);
      }

      const envEntries = Object.entries(res.service.env || {}).map(([k, v]) => `${k}=${v}`);
      setEnvText(envEntries.join("\n"));
      setRepoUrl(res.service.sourceConfig?.repoUrl || "");
      setBranch(res.service.sourceConfig?.branch || "main");
      setImage(res.service.sourceConfig?.image || "");
      setCpuLimit(res.service.cpuLimit || "");
      setMemoryLimitMb(res.service.memoryLimitMb || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [serviceId]);

  useEffect(() => {
    void loadService();
  }, [loadService]);

  useEffect(() => {
    return () => {
      deployWsRef.current?.close();
      deployWsRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (tab !== "terminal" && tab !== "general") return;
    const timer = setInterval(async () => {
      try {
        const s = await apiFetch<any>(`/api/services/${serviceId}/stats`);
        setStats(s);
      } catch {
        // ignore
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [serviceId, tab]);

  async function handleDeploy() {
    setError("");
    setMsg("");
    try {
      const { deploymentId } = await apiFetch<{ deploymentId: string }>(
        `/api/services/${serviceId}/deploy`,
        { method: "POST" }
      );
      setTab("logs");
      setLiveDeployLogs("");
      deployWsRef.current?.close();
      const token = encodeURIComponent(getAuthToken());
      const ws = new WebSocket(`${getWsBaseUrl()}/ws/deployments/${deploymentId}?token=${token}`);
      deployWsRef.current = ws;
      ws.onmessage = (evt) => {
        const payload = JSON.parse(evt.data);
        if (payload.type === "history" || payload.type === "log") {
          setLiveDeployLogs((prev) => prev + payload.data);
        } else if (payload.type === "done") {
          ws.close();
          if (deployWsRef.current === ws) {
            deployWsRef.current = null;
          }
          void loadService();
        }
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleScale(replicas: number) {
    setError("");
    setMsg("");
    try {
      await apiFetch(`/api/services/${serviceId}/scale`, {
        method: "POST",
        body: JSON.stringify({ replicas }),
      });
      await loadService();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSaveGeneral(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMsg("");
    try {
      await apiFetch(`/api/services/${serviceId}`, {
        method: "PATCH",
        body: JSON.stringify({
          sourceConfig:
            data.service.sourceType === "image"
              ? { ...data.service.sourceConfig, image }
              : { ...data.service.sourceConfig, repoUrl, branch },
          cpuLimit,
          memoryLimitMb: Number(memoryLimitMb),
        }),
      });
      setMsg("Konfigurasi disimpan. Klik Deploy untuk menerapkan.");
      await loadService();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSaveEnv() {
    setError("");
    setMsg("");
    try {
      const env: Record<string, string> = {};
      for (const line of envText.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const idx = trimmed.indexOf("=");
        if (idx > 0) {
          env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1);
        }
      }
      await apiFetch(`/api/services/${serviceId}/env`, {
        method: "PUT",
        body: JSON.stringify({ env }),
      });
      setMsg("Environment variables disimpan (terenkripsi AES-256-GCM).");
      await loadService();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleAddDomain(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await apiFetch(`/api/services/${serviceId}/domains`, {
        method: "POST",
        body: JSON.stringify({ host, internalPort: Number(internalPort), httpsEnabled, forceSsl: httpsEnabled }),
      });
      setHost("");
      await loadService();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleAddMount(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await apiFetch(`/api/services/${serviceId}/mounts`, {
        method: "POST",
        body: JSON.stringify({ type: "volume", source: mountSource, target: mountTarget }),
      });
      setMountSource("");
      setMountTarget("");
      await loadService();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleFetchRuntimeLogs() {
    setError("");
    try {
      const res = await apiFetch<{ logs: string }>(`/api/services/${serviceId}/logs?tail=300`);
      setRuntimeLogs(res.logs || "Belum ada output log.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRunBackup() {
    if (!selectedDestId) return;
    setError("");
    setMsg("");
    try {
      await apiFetch("/api/backups/run", {
        method: "POST",
        body: JSON.stringify({ serviceId, destinationId: selectedDestId }),
      });
      setMsg("Backup selesai dijalankan.");
      await loadService();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRestore(runId: string) {
    if (!confirm("Restore snapshot ini ke database service?")) return;
    setError("");
    setMsg("");
    try {
      await apiFetch(`/api/backups/runs/${runId}/restore`, { method: "POST" });
      setMsg("Restore berhasil dijalankan.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete() {
    if (!confirm("Hapus service ini permanen?")) return;
    setError("");
    try {
      await apiFetch(`/api/services/${serviceId}`, { method: "DELETE" });
      router.push(`/projects/${data.project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!data) {
    return (
      <AppShell>
        <div className="text-sm text-zinc-400">Memuat detail service...</div>
      </AppShell>
    );
  }

  const svc = data.service;
  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "general", label: "General & Source" },
    { key: "env", label: "Environment" },
    { key: "domains", label: `Domains (${data.domains.length})` },
    { key: "mounts", label: `Storage (${data.mounts.length})` },
    { key: "logs", label: "Deploy & Logs" },
    { key: "terminal", label: "Terminal & Stats" },
    { key: "backups", label: "Backups" },
  ];

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href={`/projects/${data.project.id}`}
              className="rounded-lg border border-zinc-800 p-2 text-zinc-400 hover:bg-zinc-900 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <h1 className="text-2xl font-semibold">{svc.name}</h1>
              <p className="text-xs text-zinc-400">
                {data.project.name} / {svc.slug} • Status:{" "}
                <span className="font-medium text-emerald-400">{svc.status}</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleDeploy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400"
            >
              <Play className="h-4 w-4" />
              Deploy
            </button>
            <button
              onClick={() => handleScale(svc.replicas > 0 ? 0 : 1)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900"
            >
              <Square className="h-3.5 w-3.5" />
              {svc.replicas > 0 ? "Stop" : "Start"}
            </button>
            <button
              onClick={handleDelete}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-900/60 px-3 py-2 text-sm text-red-400 hover:bg-red-950/40"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {msg && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300">
            {msg}
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Tab Bar */}
        <div className="flex flex-wrap gap-1 border-b border-zinc-800 pb-2">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${
                tab === t.key
                  ? "bg-zinc-800 font-medium text-white"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* General Tab */}
        {tab === "general" && (
          <div className="grid gap-6 lg:grid-cols-2">
            <form
              onSubmit={handleSaveGeneral}
              className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5"
            >
              <h3 className="font-medium">Source & Resource Limits</h3>
              {svc.sourceType === "image" ? (
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">Docker Image</label>
                  <input
                    value={image}
                    onChange={(e) => setImage(e.target.value)}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
                  />
                </div>
              ) : (
                <>
                  <div>
                    <label className="mb-1 block text-xs text-zinc-400">Git Repo URL</label>
                    <input
                      value={repoUrl}
                      onChange={(e) => setRepoUrl(e.target.value)}
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">CPU Limit (cores)</label>
                  <input
                    value={cpuLimit}
                    onChange={(e) => setCpuLimit(e.target.value)}
                    placeholder="e.g. 0.5 or 1"
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">Memory Limit (MB)</label>
                  <input
                    type="number"
                    value={memoryLimitMb}
                    onChange={(e) => setMemoryLimitMb(Number(e.target.value))}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950"
              >
                <Save className="h-4 w-4" />
                Simpan
              </button>
            </form>

            <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
              <h3 className="font-medium">Integrasi & Koneksi</h3>
              {svc.connectionUrl && (
                <div>
                  <div className="text-xs text-zinc-400">Internal Connection URL (Project Network)</div>
                  <code className="mt-1 block break-all rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-emerald-300">
                    {svc.connectionUrl}
                  </code>
                </div>
              )}
              <div>
                <div className="text-xs text-zinc-400">Auto-Deploy Webhook URL (POST)</div>
                <code className="mt-1 block break-all rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-sky-300">
                  {svc.webhookUrl}
                </code>
              </div>
            </div>
          </div>
        )}

        {/* Environment Tab */}
        {tab === "env" && (
          <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium">Environment Variables</h3>
                <p className="text-xs text-zinc-400">Format KEY=VALUE per baris (disimpan terenkripsi).</p>
              </div>
              <button
                onClick={handleSaveEnv}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950"
              >
                <Save className="h-4 w-4" />
                Simpan Env
              </button>
            </div>
            <textarea
              rows={12}
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              placeholder={"NODE_ENV=production\nPORT=3000"}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-200 outline-none focus:border-emerald-500"
            />
          </div>
        )}

        {/* Domains Tab */}
        {tab === "domains" && (
          <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
            <h3 className="font-medium">Custom Domains & Auto-SSL (Traefik)</h3>
            <form onSubmit={handleAddDomain} className="flex flex-wrap gap-3">
              <input
                required
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="app.domainanda.com"
                className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
              />
              <input
                type="number"
                value={internalPort}
                onChange={(e) => setInternalPort(Number(e.target.value))}
                placeholder="Port (80/3000)"
                className="w-28 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
              />
              <label className="flex items-center gap-2 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={httpsEnabled}
                  onChange={(e) => setHttpsEnabled(e.target.checked)}
                />
                HTTPS (Let&apos;s Encrypt)
              </label>
              <button
                type="submit"
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950"
              >
                Tambah Domain
              </button>
            </form>

            <div className="space-y-2">
              {data.domains.map((d: any) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-emerald-400" />
                    <span>
                      {d.httpsEnabled ? "https://" : "http://"}
                      {d.host}
                    </span>
                    <span className="text-xs text-zinc-500">→ port {d.internalPort}</span>
                  </div>
                  <button
                    onClick={async () => {
                      setError("");
                      try {
                        await apiFetch(`/api/services/${serviceId}/domains/${d.id}`, {
                          method: "DELETE",
                        });
                        await loadService();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : String(err));
                      }
                    }}
                    className="text-xs text-red-400 hover:underline"
                  >
                    Hapus
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Mounts Tab */}
        {tab === "mounts" && (
          <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
            <h3 className="font-medium">Persistent Storage / Volumes</h3>
            <form onSubmit={handleAddMount} className="flex flex-wrap gap-3">
              <input
                required
                value={mountSource}
                onChange={(e) => setMountSource(e.target.value)}
                placeholder="Nama Volume (mis. app-uploads)"
                className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
              />
              <input
                required
                value={mountTarget}
                onChange={(e) => setMountTarget(e.target.value)}
                placeholder="Container Path (mis. /app/uploads)"
                className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950"
              >
                Tambah Volume
              </button>
            </form>
            <div className="space-y-2">
              {data.mounts.map((m: any) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <HardDrive className="h-4 w-4 text-sky-400" />
                    <span>
                      {m.source} → <code>{m.target}</code>
                    </span>
                  </div>
                  <button
                    onClick={async () => {
                      setError("");
                      try {
                        await apiFetch(`/api/services/${serviceId}/mounts/${m.id}`, {
                          method: "DELETE",
                        });
                        await loadService();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : String(err));
                      }
                    }}
                    className="text-xs text-red-400 hover:underline"
                  >
                    Hapus
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Logs Tab */}
        {tab === "logs" && (
          <div className="space-y-4">
            {liveDeployLogs && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <h3 className="mb-2 text-sm font-medium text-emerald-400">Live Build Stream</h3>
                <pre className="max-h-72 overflow-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-200">
                  {liveDeployLogs}
                </pre>
              </div>
            )}

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium">Runtime Container Logs</h3>
                <button
                  onClick={handleFetchRuntimeLogs}
                  className="rounded-lg border border-zinc-700 px-3 py-1 text-xs hover:bg-zinc-800"
                >
                  Refresh Logs
                </button>
              </div>
              <pre className="max-h-80 overflow-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-300">
                {runtimeLogs || "Klik Refresh Logs untuk mengambil output terbaru dari Docker Swarm."}
              </pre>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
              <h3 className="mb-3 text-sm font-medium">Riwayat Deployment</h3>
              <div className="space-y-2">
                {data.deployments.map((dep: any) => (
                  <details
                    key={dep.id}
                    className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs"
                  >
                    <summary className="flex cursor-pointer items-center justify-between">
                      <span>
                        {new Date(dep.createdAt).toLocaleString()} • {dep.trigger} •{" "}
                        <code>{dep.imageTag || "-"}</code>
                      </span>
                      <span
                        className={
                          dep.status === "running" ? "text-emerald-400" : "text-amber-400"
                        }
                      >
                        {dep.status}
                      </span>
                    </summary>
                    <pre className="mt-2 max-h-60 overflow-auto text-[11px] text-zinc-400">
                      {dep.logContent}
                    </pre>
                  </details>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Terminal & Stats Tab */}
        {tab === "terminal" && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <Cpu className="h-4 w-4 text-emerald-400" />
                  CPU Usage
                </div>
                <div className="mt-1 text-xl font-semibold">
                  {stats?.stats ? `${stats.stats.cpuPercent}%` : "N/A"}
                </div>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="text-xs text-zinc-400">Memory Usage</div>
                <div className="mt-1 text-xl font-semibold">
                  {stats?.stats
                    ? `${stats.stats.memoryUsedMb} MB (${stats.stats.memoryPercent}%)`
                    : "N/A"}
                </div>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="text-xs text-zinc-400">Network Rx / Tx</div>
                <div className="mt-1 text-sm font-semibold">
                  {stats?.stats
                    ? `${Math.round(stats.stats.networkRxBytes / 1024)} KB / ${Math.round(stats.stats.networkTxBytes / 1024)} KB`
                    : "N/A"}
                </div>
              </div>
            </div>

            <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <TerminalIcon className="h-4 w-4 text-emerald-400" />
                Web Terminal (/bin/sh)
              </div>
              <TerminalView serviceId={serviceId} />
            </div>
          </div>
        )}

        {/* Backups Tab */}
        {tab === "backups" && (
          <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-medium">Database & Volume Backups</h3>
                <p className="text-xs text-zinc-400">
                  Jalankan backup manual atau restore snapshot ke container yang sedang berjalan.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={selectedDestId}
                  onChange={(e) => setSelectedDestId(e.target.value)}
                  className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs"
                >
                  {destinations.length === 0 && <option value="">Tambah destination di Settings</option>}
                  {destinations.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.provider})
                    </option>
                  ))}
                </select>
                <button
                  disabled={!selectedDestId}
                  onClick={handleRunBackup}
                  className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-medium text-zinc-950 disabled:opacity-40"
                >
                  Backup Sekarang
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {backupRuns.map((run) => (
                <div
                  key={run.id}
                  className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-xs"
                >
                  <div>
                    <div className="font-medium text-zinc-200">{run.fileKey || run.id}</div>
                    <div className="text-zinc-500">
                      {new Date(run.createdAt).toLocaleString()} • {run.status} •{" "}
                      {Math.round((run.sizeBytes || 0) / 1024)} KB
                    </div>
                  </div>
                  {run.status === "success" && (
                    <button
                      onClick={() => handleRestore(run.id)}
                      className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2.5 py-1 text-emerald-400 hover:bg-zinc-900"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Restore
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
