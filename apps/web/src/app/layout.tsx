import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PanelManager — Self-Hosted Docker Swarm PaaS",
  description: "Self-hosted server control panel powered by Docker Swarm & Traefik",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className="dark">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
