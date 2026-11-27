import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { GetObjectCommand, PutObjectCommand, S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Cron } from "croner";
import {
  backupDestinations,
  backupRuns,
  backupSchedules,
  decryptSecret,
  desc,
  eq,
  generateId,
  projects,
  services,
} from "@panelmanager/db";
import type { AppContext } from "../context.js";
import { getSwarmServiceName } from "../builder/deploy.js";
import { sendNotification } from "../notifications/sender.js";

function createS3(dest: typeof backupDestinations.$inferSelect, panelSecret: string): S3Client {
  const creds = dest.credentialsEncrypted
    ? (JSON.parse(decryptSecret(dest.credentialsEncrypted, panelSecret)) as {
        accessKeyId: string;
        secretAccessKey: string;
      })
    : { accessKeyId: "", secretAccessKey: "" };

  return new S3Client({
    region: dest.region || "auto",
    endpoint: dest.endpoint || undefined,
    forcePathStyle: Boolean(dest.endpoint),
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
    },
  });
}

export function getBackupCommand(
  kind: string,
  env: Record<string, string>
): { cmd: string[]; env: string[]; ext: string } {
  switch (kind) {
    case "postgres":
      return {
        cmd: ["sh", "-c", 'pg_dumpall -U "$PGUSER" | gzip'],
        env: [
          `PGPASSWORD=${env.POSTGRES_PASSWORD || ""}`,
          `PGUSER=${env.POSTGRES_USER || "postgres"}`,
        ],
        ext: "sql.gz",
      };
    case "mysql":
    case "mariadb":
      return {
        cmd: ["sh", "-c", "mysqldump -u root --all-databases --single-transaction | gzip"],
        env: [`MYSQL_PWD=${env.MYSQL_ROOT_PASSWORD || env.MARIADB_ROOT_PASSWORD || ""}`],
        ext: "sql.gz",
      };
    case "mongo":
      return {
        cmd: [
          "sh",
          "-c",
          'mongodump --username "$MONGO_USER" --password "$MONGO_PASS" --authenticationDatabase admin --archive --gzip',
        ],
        env: [
          `MONGO_USER=${env.MONGO_INITDB_ROOT_USERNAME || "root"}`,
          `MONGO_PASS=${env.MONGO_INITDB_ROOT_PASSWORD || ""}`,
        ],
        ext: "archive.gz",
      };
    case "redis":
      return {
        cmd: [
          "sh",
          "-c",
          "redis-cli --rdb /tmp/dump.rdb >/dev/null && gzip -c /tmp/dump.rdb; st=$?; rm -f /tmp/dump.rdb; exit $st",
        ],
        env: env.REDIS_PASSWORD ? [`REDISCLI_AUTH=${env.REDIS_PASSWORD}`] : [],
        ext: "rdb.gz",
      };
    default:
      return {
        cmd: ["sh", "-c", "tar -czf - /data 2>/dev/null || tar -czf - /app"],
        env: [],
        ext: "tar.gz",
      };
  }
}

export function getRestoreCommand(
  kind: string,
  env: Record<string, string>
): { cmd: string[]; env: string[] } {
  switch (kind) {
    case "postgres":
      return {
        cmd: ["sh", "-c", 'gunzip | psql -v ON_ERROR_STOP=1 -U "$PGUSER"'],
        env: [
          `PGPASSWORD=${env.POSTGRES_PASSWORD || ""}`,
          `PGUSER=${env.POSTGRES_USER || "postgres"}`,
        ],
      };
    case "mysql":
    case "mariadb":
      return {
        cmd: ["sh", "-c", "gunzip | mysql -u root"],
        env: [`MYSQL_PWD=${env.MYSQL_ROOT_PASSWORD || env.MARIADB_ROOT_PASSWORD || ""}`],
      };
    case "mongo":
      return {
        cmd: [
          "sh",
          "-c",
          'mongorestore --username "$MONGO_USER" --password "$MONGO_PASS" --authenticationDatabase admin --archive --gzip --drop',
        ],
        env: [
          `MONGO_USER=${env.MONGO_INITDB_ROOT_USERNAME || "root"}`,
          `MONGO_PASS=${env.MONGO_INITDB_ROOT_PASSWORD || ""}`,
        ],
      };
    default:
      throw new Error(`Restore is not supported automatically for service type: ${kind}`);
  }
}

export async function runBackup(
  ctx: AppContext,
  serviceId: string,
  destinationId: string,
  scheduleId?: string
): Promise<string> {
  const svc = ctx.db.select().from(services).where(eq(services.id, serviceId)).get();
  if (!svc) throw new Error("Service not found");
  const project = ctx.db.select().from(projects).where(eq(projects.id, svc.projectId)).get();
  if (!project) throw new Error("Project not found");
  const dest = ctx.db
    .select()
    .from(backupDestinations)
    .where(eq(backupDestinations.id, destinationId))
    .get();
  if (!dest) throw new Error("Backup destination not found");

  const runId = generateId();
  const now = Date.now();
  ctx.db
    .insert(backupRuns)
    .values({
      id: runId,
      scheduleId: scheduleId ?? null,
      serviceId,
      destinationId,
      status: "running",
      createdAt: now,
    })
    .run();

  const tempFile = join(tmpdir(), `panel-backup-${runId}`);

  try {
    const swarmName = getSwarmServiceName(project.slug, svc.slug);
    const containerId = await ctx.swarm.findRunningContainerId(swarmName);
    if (!containerId) {
      throw new Error(`No running container found for service ${swarmName}`);
    }

    const env = svc.envEncrypted
      ? (JSON.parse(decryptSecret(svc.envEncrypted, ctx.config.panelSecret)) as Record<
          string,
          string
        >)
      : {};
    const { cmd, env: execEnv, ext } = getBackupCommand(svc.kind, env);

    const writeStream = createWriteStream(tempFile);
    const result = await ctx.swarm.execToStream(containerId, cmd, writeStream, execEnv);
    await new Promise<void>((resolve, reject) => {
      writeStream.on("error", reject);
      writeStream.end(resolve);
    });

    if (result.exitCode !== 0) {
      throw new Error(result.stderr.toString("utf8") || `Backup exited with ${result.exitCode}`);
    }

    const sizeBytes = statSync(tempFile).size;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileKey = `${project.slug}/${svc.slug}/${stamp}-${runId.slice(0, 6)}.${ext}`;

    if (dest.provider === "local") {
      const targetFile = join(ctx.config.dataDir, "backups", fileKey);
      mkdirSync(dirname(targetFile), { recursive: true });
      renameSync(tempFile, targetFile);
    } else {
      const s3 = createS3(dest, ctx.config.panelSecret);
      await s3.send(
        new PutObjectCommand({
          Bucket: dest.bucket,
          Key: fileKey,
          Body: createReadStream(tempFile),
          ContentLength: sizeBytes,
        })
      );
    }

    ctx.db
      .update(backupRuns)
      .set({
        status: "success",
        fileKey,
        sizeBytes,
        finishedAt: Date.now(),
      })
      .where(eq(backupRuns.id, runId))
      .run();

    if (scheduleId) {
      ctx.db
        .update(backupSchedules)
        .set({ lastRunAt: Date.now() })
        .where(eq(backupSchedules.id, scheduleId))
        .run();

      const schedule = ctx.db
        .select()
        .from(backupSchedules)
        .where(eq(backupSchedules.id, scheduleId))
        .get();
      if (schedule) {
        await enforceRetention(ctx, dest, schedule.id, schedule.retentionCount);
      }
    }

    return runId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.db
      .update(backupRuns)
      .set({
        status: "failed",
        errorMessage: msg,
        finishedAt: Date.now(),
      })
      .where(eq(backupRuns.id, runId))
      .run();

    await sendNotification(ctx.db, ctx.config.panelSecret, {
      title: `Backup Failed: ${project.name} / ${svc.name}`,
      message: msg,
      level: "error",
    });
    throw err;
  } finally {
    rmSync(tempFile, { force: true });
  }
}

async function enforceRetention(
  ctx: AppContext,
  dest: typeof backupDestinations.$inferSelect,
  scheduleId: string,
  retentionCount: number
) {
  const runs = ctx.db
    .select()
    .from(backupRuns)
    .where(eq(backupRuns.scheduleId, scheduleId))
    .orderBy(desc(backupRuns.createdAt))
    .all()
    .filter((r) => r.status === "success");

  const stale = runs.slice(retentionCount);
  for (const old of stale) {
    try {
      if (dest.provider === "local" && old.fileKey) {
        unlinkSync(join(ctx.config.dataDir, "backups", old.fileKey));
      } else if (old.fileKey) {
        const s3 = createS3(dest, ctx.config.panelSecret);
        await s3.send(new DeleteObjectCommand({ Bucket: dest.bucket, Key: old.fileKey }));
      }
      ctx.db.delete(backupRuns).where(eq(backupRuns.id, old.id)).run();
    } catch {
      // ignore retention cleanup error
    }
  }
}

export async function restoreBackupRun(ctx: AppContext, runId: string): Promise<void> {
  const run = ctx.db.select().from(backupRuns).where(eq(backupRuns.id, runId)).get();
  if (!run || !run.fileKey) throw new Error("Backup run not found");

  const svc = ctx.db.select().from(services).where(eq(services.id, run.serviceId)).get();
  if (!svc) throw new Error("Service not found");
  const project = ctx.db.select().from(projects).where(eq(projects.id, svc.projectId)).get();
  if (!project) throw new Error("Project not found");
  const dest = ctx.db
    .select()
    .from(backupDestinations)
    .where(eq(backupDestinations.id, run.destinationId))
    .get();
  if (!dest) throw new Error("Destination not found");

  const swarmName = getSwarmServiceName(project.slug, svc.slug);
  const containerId = await ctx.swarm.findRunningContainerId(swarmName);
  if (!containerId) throw new Error("Target service container is not running");

  const env = svc.envEncrypted
    ? (JSON.parse(decryptSecret(svc.envEncrypted, ctx.config.panelSecret)) as Record<
        string,
        string
      >)
    : {};

  const { cmd, env: execEnv } = getRestoreCommand(svc.kind, env);

  let payloadStream: Readable;
  if (dest.provider === "local") {
    payloadStream = createReadStream(join(ctx.config.dataDir, "backups", run.fileKey));
  } else {
    const s3 = createS3(dest, ctx.config.panelSecret);
    const res = await s3.send(new GetObjectCommand({ Bucket: dest.bucket, Key: run.fileKey }));
    if (!res.Body) throw new Error("Empty backup object");
    payloadStream = res.Body as Readable;
  }

  const result = await ctx.swarm.execFromStream(containerId, cmd, payloadStream, execEnv);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString("utf8") || `Restore exited with ${result.exitCode}`);
  }
}

export class BackupScheduler {
  private jobs: Cron[] = [];

  constructor(private readonly ctx: AppContext) {}

  reload(): void {
    for (const job of this.jobs) {
      job.stop();
    }
    this.jobs = [];

    const schedules = this.ctx.db
      .select()
      .from(backupSchedules)
      .where(eq(backupSchedules.enabled, true))
      .all();

    for (const sched of schedules) {
      try {
        const job = new Cron(sched.cronExpr, async () => {
          try {
            await runBackup(this.ctx, sched.serviceId, sched.destinationId, sched.id);
          } catch (err) {
            console.error(`Scheduled backup ${sched.id} failed:`, err);
          }
        });
        this.jobs.push(job);
      } catch (err) {
        console.error(`Skipping invalid backup schedule ${sched.id} (${sched.cronExpr}):`, err);
      }
    }
  }

  stop(): void {
    for (const job of this.jobs) {
      job.stop();
    }
    this.jobs = [];
  }
}
