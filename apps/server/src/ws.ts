import type { Duplex } from "node:stream";
import type { IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { deployments, eq, projects, services } from "@panelmanager/db";
import { resolveSessionUser, SESSION_COOKIE_NAME } from "./auth.js";
import type { AppContext } from "./context.js";
import { getSwarmServiceName } from "./builder/deploy.js";
import { isAllowedOrigin } from "./utils.js";

function parseCookieToken(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === SESSION_COOKIE_NAME) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return undefined;
}

export function attachWebSocketServer(
  httpServer: { on: (event: string, listener: (...args: any[]) => void) => unknown },
  ctx: AppContext
) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url || "/", "http://localhost");
    if (!url.pathname.startsWith("/ws/")) {
      return;
    }

    if (req.headers.origin && !isAllowedOrigin(req.headers.origin, ctx.config.publicUrl, req.headers.host)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    const token =
      url.searchParams.get("token") ||
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7).trim()
        : undefined) ||
      parseCookieToken(req.headers.cookie);

    const user = resolveSessionUser(ctx.db, token);
    if (!user) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleWsConnection(ws, url, ctx);
    });
  });

  return wss;
}

async function handleWsConnection(ws: WebSocket, url: URL, ctx: AppContext) {
  // /ws/deployments/:id
  const deployMatch = url.pathname.match(/^\/ws\/deployments\/([^/]+)$/);
  if (deployMatch) {
    const deployId = deployMatch[1];
    const dep = ctx.db.select().from(deployments).where(eq(deployments.id, deployId)).get();
    if (!dep) {
      ws.send(JSON.stringify({ type: "done", status: "failed", error: "Deployment not found" }));
      ws.close();
      return;
    }
    if (dep.logContent) {
      ws.send(JSON.stringify({ type: "history", data: dep.logContent }));
    }
    if (dep.status === "running" || dep.status === "failed") {
      ws.send(JSON.stringify({ type: "done", status: dep.status }));
      return;
    }

    const onLog = (line: string) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "log", data: line + "\n" }));
      }
    };
    const onDone = (info: { status: string; error?: string }) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "done", ...info }));
      }
    };

    ctx.deployEvents.on(`log:${deployId}`, onLog);
    ctx.deployEvents.on(`done:${deployId}`, onDone);
    ws.on("close", () => {
      ctx.deployEvents.off(`log:${deployId}`, onLog);
      ctx.deployEvents.off(`done:${deployId}`, onDone);
    });
    return;
  }

  // /ws/services/:id/terminal
  const termMatch = url.pathname.match(/^\/ws\/services\/([^/]+)\/terminal$/);
  if (termMatch) {
    const serviceId = termMatch[1];
    const shell = url.searchParams.get("shell") || "/bin/sh";
    const svc = ctx.db.select().from(services).where(eq(services.id, serviceId)).get();
    if (!svc) {
      ws.send("\r\nService not found.\r\n");
      ws.close();
      return;
    }
    const project = ctx.db.select().from(projects).where(eq(projects.id, svc.projectId)).get();
    if (!project) {
      ws.close();
      return;
    }

    let execStream: Duplex | null = null;
    try {
      const swarmName = getSwarmServiceName(project.slug, svc.slug);
      const cid = await ctx.swarm.findRunningContainerId(swarmName);
      if (!cid) {
        ws.send(`\r\nContainer for ${swarmName} is not running.\r\n`);
        ws.close();
        return;
      }
      execStream = await ctx.swarm.createInteractiveExec(cid, shell);
      execStream.on("data", (chunk: Buffer) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(chunk.toString("utf8"));
        }
      });
      execStream.on("end", () => ws.close());
      ws.on("message", (data) => {
        if (execStream) {
          execStream.write(typeof data === "string" ? data : data.toString("utf8"));
        }
      });
      ws.on("close", () => {
        execStream?.destroy();
        execStream = null;
      });
    } catch (err) {
      ws.send(`\r\nTerminal error: ${err instanceof Error ? err.message : String(err)}\r\n`);
      ws.close();
    }
    return;
  }

  ws.close(4404, "Not found");
}
