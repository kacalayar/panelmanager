import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { generateToken } from "@panelmanager/db";

export interface AppConfig {
  port: number;
  dataDir: string;
  dbPath: string;
  panelSecret: string;
  publicUrl: string;
}

export function loadConfig(): AppConfig {
  const port = Number(process.env.PORT || 3001);
  const dataDir = resolve(process.env.DATA_DIR || "./data");
  mkdirSync(dataDir, { recursive: true });

  let panelSecret = process.env.PANEL_SECRET || "";
  if (!panelSecret || panelSecret.length < 16) {
    const secretFile = join(dataDir, ".panel_secret");
    if (existsSync(secretFile)) {
      panelSecret = readFileSync(secretFile, "utf8").trim();
    } else {
      panelSecret = generateToken(32);
      writeFileSync(secretFile, panelSecret, { encoding: "utf8", mode: 0o600 });
    }
  }

  return {
    port,
    dataDir,
    dbPath: join(dataDir, "panel.db"),
    panelSecret,
    publicUrl: (process.env.PANEL_PUBLIC_URL || "http://localhost:3000").replace(/\/$/, ""),
  };
}
