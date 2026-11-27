import { Hono } from "hono";
import { Cron } from "croner";
import { z } from "zod";
import {
  backupDestinations,
  backupRuns,
  backupSchedules,
  desc,
  encryptSecret,
  eq,
  generateId,
  services,
} from "@panelmanager/db";
import type { AppContext } from "../context.js";
import { restoreBackupRun, runBackup } from "../backups/worker.js";

const destinationSchema = z.object({
  name: z.string().min(1),
  provider: z.enum(["s3", "r2", "minio", "local"]),
  endpoint: z.string().optional(),
  bucket: z.string().optional(),
  region: z.string().optional(),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
});

const scheduleSchema = z.object({
  serviceId: z.string().min(1),
  destinationId: z.string().min(1),
  cronExpr: z.string().min(5),
  retentionCount: z.number().int().min(1).max(365).default(7),
});

export function createBackupRoutes(ctx: AppContext) {
  const router = new Hono();

  router.get("/destinations", (c) => {
    const list = ctx.db
      .select()
      .from(backupDestinations)
      .orderBy(desc(backupDestinations.createdAt))
      .all()
      .map((d) => ({
        id: d.id,
        name: d.name,
        provider: d.provider,
        endpoint: d.endpoint,
        bucket: d.bucket,
        region: d.region,
        createdAt: d.createdAt,
      }));
    return c.json({ destinations: list });
  });

  router.post("/destinations", async (c) => {
    const body = await c.req.json();
    const parsed = destinationSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

    const id = generateId();
    const creds = JSON.stringify({
      accessKeyId: parsed.data.accessKeyId || "",
      secretAccessKey: parsed.data.secretAccessKey || "",
    });
    ctx.db
      .insert(backupDestinations)
      .values({
        id,
        name: parsed.data.name,
        provider: parsed.data.provider,
        endpoint: parsed.data.endpoint || "",
        bucket: parsed.data.bucket || "",
        region: parsed.data.region || "auto",
        credentialsEncrypted: encryptSecret(creds, ctx.config.panelSecret),
        createdAt: Date.now(),
      })
      .run();

    return c.json({ id }, 201);
  });

  router.delete("/destinations/:id", (c) => {
    ctx.db.delete(backupDestinations).where(eq(backupDestinations.id, c.req.param("id"))).run();
    return c.json({ ok: true });
  });

  router.get("/schedules", (c) => {
    const list = ctx.db.select().from(backupSchedules).all();
    return c.json({ schedules: list });
  });

  router.post("/schedules", async (c) => {
    const body = await c.req.json();
    const parsed = scheduleSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

    try {
      const check = new Cron(parsed.data.cronExpr, { paused: true });
      check.stop();
    } catch {
      return c.json({ error: "Invalid cron expression" }, 400);
    }

    const svc = ctx.db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.id, parsed.data.serviceId))
      .get();
    if (!svc) return c.json({ error: "Service not found" }, 404);

    const dest = ctx.db
      .select({ id: backupDestinations.id })
      .from(backupDestinations)
      .where(eq(backupDestinations.id, parsed.data.destinationId))
      .get();
    if (!dest) return c.json({ error: "Backup destination not found" }, 404);

    const id = generateId();
    ctx.db
      .insert(backupSchedules)
      .values({
        id,
        serviceId: parsed.data.serviceId,
        destinationId: parsed.data.destinationId,
        cronExpr: parsed.data.cronExpr,
        retentionCount: parsed.data.retentionCount,
        enabled: true,
        createdAt: Date.now(),
      })
      .run();

    ctx.onScheduleChanged?.();
    return c.json({ id }, 201);
  });

  router.delete("/schedules/:id", (c) => {
    ctx.db.delete(backupSchedules).where(eq(backupSchedules.id, c.req.param("id"))).run();
    ctx.onScheduleChanged?.();
    return c.json({ ok: true });
  });

  router.get("/runs", (c) => {
    const serviceId = c.req.query("serviceId");
    const runs = serviceId
      ? ctx.db
          .select()
          .from(backupRuns)
          .where(eq(backupRuns.serviceId, serviceId))
          .orderBy(desc(backupRuns.createdAt))
          .all()
      : ctx.db.select().from(backupRuns).orderBy(desc(backupRuns.createdAt)).all();
    return c.json({ runs: runs.slice(0, 50) });
  });

  router.post("/run", async (c) => {
    const body = await c.req.json();
    const serviceId = String(body?.serviceId || "");
    const destinationId = String(body?.destinationId || "");
    if (!serviceId || !destinationId) {
      return c.json({ error: "serviceId and destinationId required" }, 400);
    }
    const runId = await runBackup(ctx, serviceId, destinationId);
    return c.json({ runId }, 201);
  });

  router.post("/runs/:id/restore", async (c) => {
    const runId = c.req.param("id");
    await restoreBackupRun(ctx, runId);
    return c.json({ ok: true });
  });

  return router;
}
