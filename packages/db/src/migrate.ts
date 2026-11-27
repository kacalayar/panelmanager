import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BetterSQLiteSession } from "drizzle-orm/better-sqlite3/session";
import { createTableRelationsHelpers, extractTablesRelationalConfig } from "drizzle-orm/relations";
import { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core/db";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core/dialect";
import * as schema from "./schema.js";

const BOOTSTRAP_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  network_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  kind TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_config_json TEXT NOT NULL DEFAULT '{}',
  env_encrypted TEXT NOT NULL DEFAULT '',
  replicas INTEGER NOT NULL DEFAULT 1,
  cpu_limit TEXT NOT NULL DEFAULT '',
  memory_limit_mb INTEGER NOT NULL DEFAULT 0,
  exposed_port INTEGER NOT NULL DEFAULT 0,
  webhook_token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'stopped',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(project_id, slug)
);

CREATE TABLE IF NOT EXISTS domains (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  host TEXT NOT NULL,
  internal_port INTEGER NOT NULL DEFAULT 80,
  path_prefix TEXT NOT NULL DEFAULT '/',
  https_enabled INTEGER NOT NULL DEFAULT 1,
  force_ssl INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mounts (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'volume',
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  read_only INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL DEFAULT 'manual',
  commit_sha TEXT NOT NULL DEFAULT '',
  image_tag TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  log_content TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS backup_destinations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  endpoint TEXT NOT NULL DEFAULT '',
  bucket TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT 'auto',
  credentials_encrypted TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS backup_schedules (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  destination_id TEXT NOT NULL REFERENCES backup_destinations(id) ON DELETE CASCADE,
  cron_expr TEXT NOT NULL,
  retention_count INTEGER NOT NULL DEFAULT 7,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS backup_runs (
  id TEXT PRIMARY KEY,
  schedule_id TEXT REFERENCES backup_schedules(id) ON DELETE SET NULL,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  destination_id TEXT NOT NULL REFERENCES backup_destinations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running',
  file_key TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS notification_channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  config_encrypted TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_services_project ON services(project_id);
CREATE INDEX IF NOT EXISTS idx_domains_service ON domains(service_id);
CREATE INDEX IF NOT EXISTS idx_mounts_service ON mounts(service_id);
CREATE INDEX IF NOT EXISTS idx_deployments_service ON deployments(service_id);
CREATE INDEX IF NOT EXISTS idx_backup_runs_service ON backup_runs(service_id);
`;

function wrapNodeSqlite(client: DatabaseSync) {
  return {
    prepare(sql: string) {
      const stmt = client.prepare(sql);
      return {
        run: (...params: any[]) => stmt.run(...params),
        all: (...params: any[]) => stmt.all(...params),
        get: (...params: any[]) => stmt.get(...params),
        raw: () => {
          const rawStmt = client.prepare(sql);
          rawStmt.setReturnArrays(true);
          return {
            all: (...params: any[]) => rawStmt.all(...params),
            get: (...params: any[]) => rawStmt.get(...params),
          };
        },
      };
    },
    transaction(fn: (tx: any) => any) {
      return (behavior: string) => (txObj: any) => {
        const begin =
          behavior === "immediate"
            ? "BEGIN IMMEDIATE"
            : behavior === "exclusive"
              ? "BEGIN EXCLUSIVE"
              : "BEGIN";
        client.exec(begin);
        try {
          const res = fn(txObj);
          client.exec("COMMIT");
          return res;
        } catch (err) {
          client.exec("ROLLBACK");
          throw err;
        }
      };
    },
  };
}

export type PanelDb = BaseSQLiteDatabase<"sync", unknown, typeof schema>;

export function createPanelDb(dbPath: string) {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const client = new DatabaseSync(dbPath);
  client.exec(BOOTSTRAP_SQL);

  const dialect = new SQLiteSyncDialect();
  const tablesConfig = extractTablesRelationalConfig(schema, createTableRelationsHelpers);
  const relationalSchema = {
    fullSchema: schema,
    schema: tablesConfig.tables,
    tableNamesMap: tablesConfig.tableNamesMap,
  };
  const session = new BetterSQLiteSession(
    wrapNodeSqlite(client) as any,
    dialect,
    relationalSchema as any
  );
  const db = new BaseSQLiteDatabase("sync", dialect, session, relationalSchema as any) as PanelDb;
  return { db, client };
}
