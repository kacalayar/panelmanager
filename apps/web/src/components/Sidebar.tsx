"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Server,
  Settings,
  X,
} from "lucide-react";
import { apiFetch, clearAuthToken } from "@/lib/api";

const STORAGE_KEY = "panel_sidebar_collapsed";

export function AppShell({
  children,
  onLoggedOut,
}: {
  children: React.ReactNode;
  onLoggedOut?: () => void;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(STORAGE_KEY) === "true");
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }

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
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100 md:flex-row">
      {/* Mobile Top Bar */}
      <header className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-900/40 px-4 py-3 md:hidden">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
            <Boxes className="h-5 w-5" />
          </div>
          <span className="text-sm font-semibold tracking-tight">PanelManager</span>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen((prev) => !prev)}
          aria-label="Toggle navigation"
          className="rounded-lg border border-zinc-800 p-2 text-zinc-300 hover:bg-zinc-900"
        >
          {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>
      </header>

      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex shrink-0 flex-col border-r border-zinc-800/80 bg-zinc-950 transition-all duration-200 md:static md:bg-zinc-900/40 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        } ${collapsed ? "w-64 md:w-16" : "w-64"}`}
      >
        <div
          className={`flex items-center border-b border-zinc-800/80 py-4 ${
            collapsed ? "justify-between px-4 md:justify-center md:px-2" : "justify-between px-4"
          }`}
        >
          <div className={`flex items-center gap-2.5 ${collapsed ? "md:hidden" : ""}`}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
              <Boxes className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">PanelManager</div>
              <div className="text-[11px] text-zinc-400">Docker Swarm PaaS</div>
            </div>
          </div>

          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? "Perluas sidebar" : "Ciutkan sidebar"}
            aria-label={collapsed ? "Perluas sidebar" : "Ciutkan sidebar"}
            className="hidden rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100 md:inline-flex"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Tutup menu"
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 md:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                  collapsed ? "md:justify-center md:px-2" : ""
                } ${
                  active
                    ? "bg-zinc-800 font-medium text-white"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className={collapsed ? "md:hidden" : ""}>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-zinc-800/80 p-3">
          <div
            className={`mb-2 flex items-center gap-2 px-3 py-1 text-xs text-zinc-500 ${
              collapsed ? "md:hidden" : ""
            }`}
          >
            <Server className="h-3.5 w-3.5 shrink-0" />
            <span>Self-Hosted Unlimited</span>
          </div>
          <button
            onClick={handleLogout}
            title={collapsed ? "Keluar" : undefined}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-400 transition hover:bg-zinc-900 hover:text-red-400 ${
              collapsed ? "md:justify-center md:px-2" : ""
            }`}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span className={collapsed ? "md:hidden" : ""}>Keluar</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-6 lg:p-8">{children}</main>
    </div>
  );
}
