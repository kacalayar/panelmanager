import { EventEmitter } from "node:events";
import type { PanelDb } from "@panelmanager/db";
import type { SwarmClient } from "@panelmanager/docker";
import type { AppConfig } from "./config.js";

export interface AppContext {
  db: PanelDb;
  swarm: SwarmClient;
  config: AppConfig;
  deployEvents: EventEmitter;
  onScheduleChanged?: () => void;
}
