import { EventEmitter } from "node:events";
import { serve } from "@hono/node-server";
import { createPanelDb } from "@panelmanager/db";
import { SwarmClient } from "@panelmanager/docker";
import { createApp } from "./app.js";
import { BackupScheduler } from "./backups/worker.js";
import { loadConfig } from "./config.js";
import type { AppContext } from "./context.js";
import { attachWebSocketServer } from "./ws.js";

const config = loadConfig();
const { db } = createPanelDb(config.dbPath);
const swarm = new SwarmClient();
const deployEvents = new EventEmitter();

const ctx: AppContext = {
  db,
  swarm,
  config,
  deployEvents,
};

const scheduler = new BackupScheduler(ctx);
ctx.onScheduleChanged = () => scheduler.reload();
scheduler.reload();

const app = createApp(ctx);

const server = serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  (info) => {
    console.log(`PanelManager Control Plane listening on http://0.0.0.0:${info.port}`);
    console.log(`SQLite DB: ${config.dbPath}`);
  }
);

attachWebSocketServer(server, ctx);
