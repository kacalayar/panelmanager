"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, LayoutDashboard, LogOut, Settings, Server } from "lucide-react";
import { apiFetch, clearAuthToken } from "@/lib/api";

export function AppShell({
  children,
  onLoggedOut,
}: {
  children: React.ReactNode;
  onLoggedOut?: () => void;
}) {
  const pathname = usePathname();

  async function handleLogout() {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    clearAuthToken();
    if (onLoggedOut) onLoggedOut();
    else window.location.href = "/";
  }

  const navItems = [
    { href: "/", label: "Dashboard & Projects", icon: LayoutDashboard },
    { href: "/settings", label: "Cluster, Backup & Alerts", icon: Settings },
  ];

  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
      <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800/80 bg-zinc-900/40">
        <div className="flex items-center gap-2.5 border-b border-zinc-800/80 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
            <Boxes className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight">PanelManager</div>
            <div className="text-[11px] text-zinc-400">Docker Swarm PaaS</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                  active
                    ? "bg-zinc-800 text-white font-medium"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-zinc-800/80 p-3">
          <div className="mb-2 flex items-center gap-2 px-3 py-1 text-xs text-zinc-500">
            <Server className="h-3.5 w-3.5" />
            <span>Self-Hosted Unlimited</span>
          </div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-400 transition hover:bg-zinc-900 hover:text-red-400"
          >
            <LogOut className="h-4 w-4" />
            Keluar
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-6 lg:p-8">{children}</main>
    </div>
  );
}
