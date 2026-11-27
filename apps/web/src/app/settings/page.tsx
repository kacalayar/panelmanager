"use client";

import { useEffect, useState } from "react";
import { Bell, HardDriveUpload, ShieldCheck, Trash2 } from "lucide-react";
import { AppShell } from "@/components/Sidebar";
import { apiFetch } from "@/lib/api";

export default function SettingsPage() {
  const [acmeEmail, setAcmeEmail] = useState("");
  const [destinations, setDestinations] = useState<any[]>([]);
  const [channels, setChannels] = useState<any[]>([]);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  // Backup destination form
  const [destName, setDestName] = useState("");
  const [provider, setProvider] = useState<"s3" | "r2" | "minio" | "local">("r2");
  const [endpoint, setEndpoint] = useState("");
  const [bucket, setBucket] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");

  // Notification form
  const [chName, setChName] = useState("");
  const [chType, setChType] = useState<"discord" | "telegram" | "webhook">("discord");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");

  async function loadAll() {
    try {
      const [sys, dests, chs] = await Promise.all([
        apiFetch<any>("/api/system/status"),
        apiFetch<{ destinations: any[] }>("/api/backups/destinations"),
        apiFetch<{ channels: any[] }>("/api/notifications"),
      ]);
      setAcmeEmail(sys.settings?.acme_email || "");
      setDestinations(dests.destinations);
      setChannels(chs.channels);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function handleSyncTraefik(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMsg("");
    try {
      await apiFetch("/api/system/traefik/sync", {
        method: "POST",
        body: JSON.stringify({ acmeEmail }),
      });
      setMsg("Traefik v3 Swarm proxy & Let's Encrypt berhasil disinkronkan!");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleAddDestination(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await apiFetch("/api/backups/destinations", {
        method: "POST",
        body: JSON.stringify({
          name: destName,
          provider,
          endpoint,
          bucket,
          accessKeyId,
          secretAccessKey,
        }),
      });
      setDestName("");
      setEndpoint("");
      setBucket("");
      setAccessKeyId("");
      setSecretAccessKey("");
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleAddChannel(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const config =
        chType === "telegram"
          ? { botToken, chatId }
          : chType === "discord"
            ? { webhookUrl }
            : { url: webhookUrl };

      await apiFetch("/api/notifications", {
        method: "POST",
        body: JSON.stringify({ name: chName, type: chType, config }),
      });
      setChName("");
      setWebhookUrl("");
      setBotToken("");
      setChatId("");
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl space-y-8">
        <div>
          <h1 className="text-2xl font-semibold">Cluster, Backup & Alerts</h1>
          <p className="text-sm text-zinc-400">
            Konfigurasi Traefik Auto-SSL, tujuan backup S3/R2, dan notifikasi deploy.
          </p>
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

        {/* Traefik SSL */}
        <form
          onSubmit={handleSyncTraefik}
          className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-6"
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
            <h2 className="text-lg font-medium">Traefik Reverse Proxy & Let&apos;s Encrypt</h2>
          </div>
          <div className="flex flex-wrap gap-3">
            <input
              type="email"
              required
              value={acmeEmail}
              onChange={(e) => setAcmeEmail(e.target.value)}
              placeholder="ssl-admin@domainanda.com"
              className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950"
            >
              Sync Traefik Swarm
            </button>
          </div>
        </form>

        {/* Backup Destinations */}
        <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
          <div className="flex items-center gap-2">
            <HardDriveUpload className="h-5 w-5 text-sky-400" />
            <h2 className="text-lg font-medium">Backup Destinations (S3 / R2 / MinIO / Local)</h2>
          </div>

          <form onSubmit={handleAddDestination} className="grid gap-3 sm:grid-cols-2">
            <input
              required
              value={destName}
              onChange={(e) => setDestName(e.target.value)}
              placeholder="Nama Destination (mis. Cloudflare R2)"
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
            />
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as any)}
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
            >
              <option value="r2">Cloudflare R2</option>
              <option value="s3">Amazon S3</option>
              <option value="minio">MinIO / S3 Compatible</option>
              <option value="local">Local Disk (/data/backups)</option>
            </select>
            {provider !== "local" && (
              <>
                <input
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="Endpoint URL (https://...r2.cloudflarestorage.com)"
                  className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
                />
                <input
                  required
                  value={bucket}
                  onChange={(e) => setBucket(e.target.value)}
                  placeholder="Bucket Name"
                  className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
                />
                <input
                  required
                  value={accessKeyId}
                  onChange={(e) => setAccessKeyId(e.target.value)}
                  placeholder="Access Key ID"
                  className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
                />
                <input
                  required
                  type="password"
                  value={secretAccessKey}
                  onChange={(e) => setSecretAccessKey(e.target.value)}
                  placeholder="Secret Access Key"
                  className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
                />
              </>
            )}
            <div className="sm:col-span-2">
              <button
                type="submit"
                className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-zinc-950"
              >
                Tambah Destination
              </button>
            </div>
          </form>

          <div className="space-y-2">
            {destinations.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-2 text-sm"
              >
                <span>
                  {d.name} ({d.provider.toUpperCase()}) {d.bucket ? `• ${d.bucket}` : ""}
                </span>
                <button
                  onClick={async () => {
                    setError("");
                    try {
                      await apiFetch(`/api/backups/destinations/${d.id}`, { method: "DELETE" });
                      await loadAll();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err));
                    }
                  }}
                  className="text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Notifications */}
        <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-amber-400" />
              <h2 className="text-lg font-medium">Notifikasi Deploy & Backup</h2>
            </div>
            <button
              onClick={async () => {
                setError("");
                try {
                  await apiFetch("/api/notifications/test", { method: "POST" });
                  setMsg("Test notification terkirim!");
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              }}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-800"
            >
              Kirim Test Alert
            </button>
          </div>

          <form onSubmit={handleAddChannel} className="grid gap-3 sm:grid-cols-2">
            <input
              required
              value={chName}
              onChange={(e) => setChName(e.target.value)}
              placeholder="Nama Channel (mis. DevOps Discord)"
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
            />
            <select
              value={chType}
              onChange={(e) => setChType(e.target.value as any)}
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
            >
              <option value="discord">Discord Webhook</option>
              <option value="telegram">Telegram Bot</option>
              <option value="webhook">Generic Webhook</option>
            </select>
            {chType === "telegram" ? (
              <>
                <input
                  required
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  placeholder="Telegram Bot Token"
                  className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
                />
                <input
                  required
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                  placeholder="Chat ID"
                  className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
                />
              </>
            ) : (
              <input
                required
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="Webhook URL"
                className="sm:col-span-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
              />
            )}
            <div className="sm:col-span-2">
              <button
                type="submit"
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950"
              >
                Tambah Channel
              </button>
            </div>
          </form>

          <div className="space-y-2">
            {channels.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-2 text-sm"
              >
                <span>
                  {c.name} ({c.type})
                </span>
                <button
                  onClick={async () => {
                    setError("");
                    try {
                      await apiFetch(`/api/notifications/${c.id}`, { method: "DELETE" });
                      await loadAll();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err));
                    }
                  }}
                  className="text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
