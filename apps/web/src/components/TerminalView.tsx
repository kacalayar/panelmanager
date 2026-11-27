"use client";

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { getAuthToken, getWsBaseUrl } from "@/lib/api";

export function TerminalView({ serviceId }: { serviceId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new Terminal({
      cursorBlink: true,
      theme: {
        background: "#09090b",
        foreground: "#e4e4e7",
      },
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    const token = encodeURIComponent(getAuthToken());
    const ws = new WebSocket(
      `${getWsBaseUrl()}/ws/services/${serviceId}/terminal?token=${token}`
    );

    ws.onopen = () => {
      term.writeln("\x1b[32mConnected to container terminal...\x1b[0m");
    };
    ws.onmessage = (evt) => {
      term.write(typeof evt.data === "string" ? evt.data : "");
    };
    ws.onclose = () => {
      term.writeln("\r\n\x1b[33mTerminal session closed.\x1b[0m");
    };

    const disposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    const handleResize = () => fitAddon.fit();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      disposable.dispose();
      ws.close();
      term.dispose();
    };
  }, [serviceId]);

  return (
    <div
      ref={containerRef}
      className="h-96 w-full overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 p-2"
    />
  );
}
