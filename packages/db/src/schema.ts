import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("owner"), // owner | admin | member
  createdAt: integer("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  networkName: text("network_name").notNull(),
  description: text("description").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const services = sqliteTable("services", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  kind: text("kind").notNull(), // app | postgres | mysql | mariadb | mongo | redis
  sourceType: text("source_type").notNull(), // image | git | dockerfile | nixpacks
  sourceConfigJson: text("source_config_json").notNull().default("{}"),
  envEncrypted: text("env_encrypted").notNull().default(""),
  replicas: integer("replicas").notNull().default(1),
  cpuLimit: text("cpu_limit").notNull().default(""),
  memoryLimitMb: integer("memory_limit_mb").notNull().default(0),
  exposedPort: integer("exposed_port").notNull().default(0),
  webhookToken: text("webhook_token").notNull(),
  status: text("status").notNull().default("stopped"), // stopped | building | deploying | running | error
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const domains = sqliteTable("domains", {
  id: text("id").primaryKey(),
  serviceId: text("service_id")
    .notNull()
    .references(() => services.id, { onDelete: "cascade" }),
  host: text("host").notNull(),
  internalPort: integer("internal_port").notNull().default(80),
  pathPrefix: text("path_prefix").notNull().default("/"),
  httpsEnabled: integer("https_enabled", { mode: "boolean" }).notNull().default(true),
  forceSsl: integer("force_ssl", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
});

export const mounts = sqliteTable("mounts", {
  id: text("id").primaryKey(),
  serviceId: text("service_id")
    .notNull()
    .references(() => services.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("volume"), // volume | bind
  source: text("source").notNull(),
  target: text("target").notNull(),
  readOnly: integer("read_only", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
});

export const deployments = sqliteTable("deployments", {
  id: text("id").primaryKey(),
  serviceId: text("service_id")
    .notNull()
    .references(() => services.id, { onDelete: "cascade" }),
  trigger: text("trigger").notNull().default("manual"), // manual | webhook | template
  commitSha: text("commit_sha").notNull().default(""),
  imageTag: text("image_tag").notNull().default(""),
  status: text("status").notNull().default("queued"), // queued | building | deploying | running | failed
  logContent: text("log_content").notNull().default(""),
  errorMessage: text("error_message").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  finishedAt: integer("finished_at"),
});

export const backupDestinations = sqliteTable("backup_destinations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  provider: text("provider").notNull(), // s3 | r2 | minio | local
  endpoint: text("endpoint").notNull().default(""),
  bucket: text("bucket").notNull().default(""),
  region: text("region").notNull().default("auto"),
  credentialsEncrypted: text("credentials_encrypted").notNull().default(""),
  createdAt: integer("created_at").notNull(),
});

export const backupSchedules = sqliteTable("backup_schedules", {
  id: text("id").primaryKey(),
  serviceId: text("service_id")
    .notNull()
    .references(() => services.id, { onDelete: "cascade" }),
  destinationId: text("destination_id")
    .notNull()
    .references(() => backupDestinations.id, { onDelete: "cascade" }),
  cronExpr: text("cron_expr").notNull(),
  retentionCount: integer("retention_count").notNull().default(7),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastRunAt: integer("last_run_at"),
  createdAt: integer("created_at").notNull(),
});

export const backupRuns = sqliteTable("backup_runs", {
  id: text("id").primaryKey(),
  scheduleId: text("schedule_id").references(() => backupSchedules.id, { onDelete: "set null" }),
  serviceId: text("service_id")
    .notNull()
    .references(() => services.id, { onDelete: "cascade" }),
  destinationId: text("destination_id")
    .notNull()
    .references(() => backupDestinations.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("running"), // running | success | failed
  fileKey: text("file_key").notNull().default(""),
  sizeBytes: integer("size_bytes").notNull().default(0),
  errorMessage: text("error_message").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  finishedAt: integer("finished_at"),
});

export const notificationChannels = sqliteTable("notification_channels", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // telegram | discord | webhook
  configEncrypted: text("config_encrypted").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
});
