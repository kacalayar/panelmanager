import { Hono } from "hono";
import { z } from "zod";
import {
  and,
  decryptSecret,
  deployments,
  desc,
  domains,
  encryptSecret,
  eq,
  generateId,
  generatePassword,
  generateToken,
  mounts,
  projects,
  services,
} from "@panelmanager/db";
import type { AppContext } from "../context.js";
import {
  getSwarmServiceName,
  queueDeployment,
  scaleService,
  type SourceConfig,
} from "../builder/deploy.js";
import { DATABASE_PRESETS, isDatabaseEngine } from "../databases/presets.js";
import { slugify } from "../utils.js";

const createServiceSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(64),
  kind: z.enum(["app", "postgres", "mysql", "mariadb", "mongo", "redis"]).default("app"),
  sourceType: z.enum(["image", "git", "dockerfile", "nixpacks"]).default("image"),
  sourceConfig: z
    .object({
      image: z.string().optional(),
      repoUrl: z.string().optional(),
      branch: z.string().optional(),
      dockerfilePath: z.string().optional(),
      buildContext: z.string().optional(),
      gitToken: z.string().optional(),
    })
    .optional(),
  dbName: z.string().optional(),
  dbUser: z.string().optional(),
  dbPassword: z.string().optional(),
  exposedPort: z.number().int().min(0).max(65535).optional(),
  autoDeploy: z.boolean().optional(),
});

const updateServiceSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  sourceType: z.enum(["image", "git", "dockerfile", "nixpacks"]).optional(),
  sourceConfig: z.record(z.any()).optional(),
  replicas: z.number().int().min(0).max(50).optional(),
  cpuLimit: z.string().optional(),
  memoryLimitMb: z.number().int().min(0).optional(),
  exposedPort: z.number().int().min(0).max(65535).optional(),
});

const envSchema = z.object({
  env: z.record(z.string()),
});

const domainSchema = z.object({
  host: z.string().min(1),
  internalPort: z.number().int().min(1).max(65535).default(80),
  pathPrefix: z.string().default("/"),
  httpsEnabled: z.boolean().default(true),
  forceSsl: z.boolean().default(true),
});

const mountSchema = z.object({
  type: z.enum(["volume", "bind"]).default("volume"),
  source: z.string().min(1),
  target: z.string().min(1),
  readOnly: z.boolean().default(false),
});

export function createServiceRoutes(ctx: AppContext) {
  const router = new Hono();

  router.post("/", async (c) => {
    const body = await c.req.json();
    const parsed = createServiceSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const data = parsed.data;
    const project = ctx.db.select().from(projects).where(eq(projects.id, data.projectId)).get();
    if (!project) return c.json({ error: "Project not found" }, 404);

    const baseSlug = slugify(data.name, "svc");
    const existing = ctx.db
      .select()
      .from(services)
      .where(eq(services.projectId, project.id))
      .all()
      .find((s) => s.slug === baseSlug);
    const slug = existing ? `${baseSlug}-${generateId().slice(0, 4)}` : baseSlug;

    const now = Date.now();
    const svcId = generateId();

    let sourceType = data.sourceType;
    let sourceConfig: SourceConfig = data.sourceConfig || {};
    let env: Record<string, string> = {};
    const initialMounts: Array<{ source: string; target: string }> = [];

    if (isDatabaseEngine(data.kind)) {
      const preset = DATABASE_PRESETS[data.kind];
      sourceType = "image";
      sourceConfig = { image: preset.image, ...(preset.cmd ? { cmd: preset.cmd } : {}) };
      const dbName = data.dbName || slug.replace(/-/g, "_");
      const dbUser = data.dbUser || "appuser";
      const dbPass = data.dbPassword || generatePassword(24);
      env = preset.buildEnv(dbName, dbUser, dbPass);
      initialMounts.push({
        source: `${project.slug}-${slug}-data`,
        target: preset.dataTargetPath,
      });
    }

    ctx.db
      .insert(services)
      .values({
        id: svcId,
        projectId: project.id,
        name: data.name,
        slug,
        kind: data.kind,
        sourceType,
        sourceConfigJson: JSON.stringify(sourceConfig),
        envEncrypted: encryptSecret(JSON.stringify(env), ctx.config.panelSecret),
        replicas: 1,
        exposedPort: data.exposedPort || 0,
        webhookToken: generateToken(16),
        status: "stopped",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    for (const m of initialMounts) {
      ctx.db
        .insert(mounts)
        .values({
          id: generateId(),
          serviceId: svcId,
          type: "volume",
          source: m.source,
          target: m.target,
          readOnly: false,
          createdAt: now,
        })
        .run();
    }

    let deploymentId: string | undefined;
    if (data.autoDeploy) {
      deploymentId = await queueDeployment(ctx, svcId, "manual");
    }

    const created = ctx.db.select().from(services).where(eq(services.id, svcId)).get();
    return c.json({ service: created, deploymentId }, 201);
  });

  router.get("/:id", async (c) => {
    const id = c.req.param("id");
    const svc = ctx.db.select().from(services).where(eq(services.id, id)).get();
    if (!svc) return c.json({ error: "Service not found" }, 404);

    const project = ctx.db.select().from(projects).where(eq(projects.id, svc.projectId)).get();
    const svcDomains = ctx.db.select().from(domains).where(eq(domains.serviceId, id)).all();
    const svcMounts = ctx.db.select().from(mounts).where(eq(mounts.serviceId, id)).all();
    const svcDeployments = ctx.db
      .select()
      .from(deployments)
      .where(eq(deployments.serviceId, id))
      .orderBy(desc(deployments.createdAt))
      .all()
      .slice(0, 20);

    const env = svc.envEncrypted
      ? (JSON.parse(decryptSecret(svc.envEncrypted, ctx.config.panelSecret)) as Record<
          string,
          string
        >)
      : {};

    let connectionUrl: string | undefined;
    if (isDatabaseEngine(svc.kind)) {
      const preset = DATABASE_PRESETS[svc.kind];
      const host = svc.slug;
      const dbName = env.POSTGRES_DB || env.MYSQL_DATABASE || env.MARIADB_DATABASE || "app";
      const user =
        env.POSTGRES_USER || env.MYSQL_USER || env.MARIADB_USER || env.MONGO_INITDB_ROOT_USERNAME || "user";
      const pass =
        env.POSTGRES_PASSWORD ||
        env.MYSQL_PASSWORD ||
        env.MARIADB_PASSWORD ||
        env.MONGO_INITDB_ROOT_PASSWORD ||
        env.REDIS_PASSWORD ||
        "";
      connectionUrl = preset.buildConnectionUrl(host, preset.defaultPort, dbName, user, pass);
    }

    return c.json({
      service: {
        ...svc,
        sourceConfig: JSON.parse(svc.sourceConfigJson || "{}"),
        env,
        connectionUrl,
        webhookUrl: `${ctx.config.publicUrl}/api/webhooks/deploy/${svc.id}/${svc.webhookToken}`,
      },
      project,
      domains: svcDomains,
      mounts: svcMounts,
      deployments: svcDeployments,
    });
  });

  router.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const svc = ctx.db.select().from(services).where(eq(services.id, id)).get();
    if (!svc) return c.json({ error: "Service not found" }, 404);

    const body = await c.req.json();
    const parsed = updateServiceSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

    const d = parsed.data;
    ctx.db
      .update(services)
      .set({
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.sourceType !== undefined ? { sourceType: d.sourceType } : {}),
        ...(d.sourceConfig !== undefined
          ? { sourceConfigJson: JSON.stringify(d.sourceConfig) }
          : {}),
        ...(d.replicas !== undefined ? { replicas: d.replicas } : {}),
        ...(d.cpuLimit !== undefined ? { cpuLimit: d.cpuLimit } : {}),
        ...(d.memoryLimitMb !== undefined ? { memoryLimitMb: d.memoryLimitMb } : {}),
        ...(d.exposedPort !== undefined ? { exposedPort: d.exposedPort } : {}),
        updatedAt: Date.now(),
      })
      .where(eq(services.id, id))
      .run();

    const updated = ctx.db.select().from(services).where(eq(services.id, id)).get();
    return c.json({ service: updated });
  });

  router.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const svc = ctx.db.select().from(services).where(eq(services.id, id)).get();
    if (!svc) return c.json({ error: "Service not found" }, 404);
    const project = ctx.db.select().from(projects).where(eq(projects.id, svc.projectId)).get();

    if (project) {
      try {
        await ctx.swarm.removeService(getSwarmServiceName(project.slug, svc.slug));
      } catch {
        // ignore if docker not active
      }
    }

    ctx.db.delete(services).where(eq(services.id, id)).run();
    return c.json({ ok: true });
  });

  router.put("/:id/env", async (c) => {
    const id = c.req.param("id");
    const svc = ctx.db.select().from(services).where(eq(services.id, id)).get();
    if (!svc) return c.json({ error: "Service not found" }, 404);

    const body = await c.req.json();
    const parsed = envSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

    ctx.db
      .update(services)
      .set({
        envEncrypted: encryptSecret(JSON.stringify(parsed.data.env), ctx.config.panelSecret),
        updatedAt: Date.now(),
      })
      .where(eq(services.id, id))
      .run();

    return c.json({ ok: true });
  });

  router.post("/:id/domains", async (c) => {
    const id = c.req.param("id");
    const svc = ctx.db.select().from(services).where(eq(services.id, id)).get();
    if (!svc) return c.json({ error: "Service not found" }, 404);

    const body = await c.req.json();
    const parsed = domainSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

    const domId = generateId();
    ctx.db
      .insert(domains)
      .values({
        id: domId,
        serviceId: id,
        host: parsed.data.host.trim().toLowerCase(),
        internalPort: parsed.data.internalPort,
        pathPrefix: parsed.data.pathPrefix,
        httpsEnabled: parsed.data.httpsEnabled,
        forceSsl: parsed.data.forceSsl,
        createdAt: Date.now(),
      })
      .run();

    const domain = ctx.db.select().from(domains).where(eq(domains.id, domId)).get();
    return c.json({ domain }, 201);
  });

  router.delete("/:id/domains/:domainId", (c) => {
    const id = c.req.param("id");
    const domainId = c.req.param("domainId");
    ctx.db.delete(domains).where(and(eq(domains.id, domainId), eq(domains.serviceId, id))).run();
    return c.json({ ok: true });
  });

  router.post("/:id/mounts", async (c) => {
    const id = c.req.param("id");
    const svc = ctx.db.select().from(services).where(eq(services.id, id)).get();
    if (!svc) return c.json({ error: "Service not found" }, 404);

    const body = await c.req.json();
    const parsed = mountSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

    const mountId = generateId();
    ctx.db
      .insert(mounts)
      .values({
        id: mountId,
        serviceId: id,
        type: parsed.data.type,
        source: parsed.data.source,
        target: parsed.data.target,
        readOnly: parsed.data.readOnly,
        createdAt: Date.now(),
      })
      .run();

    const mount = ctx.db.select().from(mounts).where(eq(mounts.id, mountId)).get();
    return c.json({ mount }, 201);
  });

  router.delete("/:id/mounts/:mountId", (c) => {
    const id = c.req.param("id");
    const mountId = c.req.param("mountId");
    ctx.db.delete(mounts).where(and(eq(mounts.id, mountId), eq(mounts.serviceId, id))).run();
    return c.json({ ok: true });
  });

  router.post("/:id/deploy", async (c) => {
    const id = c.req.param("id");
    const svc = ctx.db.select({ id: services.id }).from(services).where(eq(services.id, id)).get();
    if (!svc) return c.json({ error: "Service not found" }, 404);
    const deploymentId = await queueDeployment(ctx, id, "manual");
    return c.json({ deploymentId }, 202);
  });

  router.post("/:id/scale", async (c) => {
    const id = c.req.param("id");
    const svc = ctx.db.select({ id: services.id }).from(services).where(eq(services.id, id)).get();
    if (!svc) return c.json({ error: "Service not found" }, 404);

    const body = await c.req.json();
    const replicas = Number(body?.replicas ?? 1);
    if (!Number.isInteger(replicas) || replicas < 0 || replicas > 50) {
      return c.json({ error: "Invalid replicas" }, 400);
    }

    const result = await scaleService(ctx, id, replicas);
    return c.json({ ok: true, ...result });
  });

  router.get("/:id/logs", async (c) => {
    const id = c.req.param("id");
    const svc = ctx.db.select().from(services).where(eq(services.id, id)).get();
    if (!svc) return c.json({ error: "Service not found" }, 404);
    const project = ctx.db.select().from(projects).where(eq(projects.id, svc.projectId)).get();
    if (!project) return c.json({ error: "Project not found" }, 404);

    try {
      const logs = await ctx.swarm.getServiceLogsSnapshot(
        getSwarmServiceName(project.slug, svc.slug),
        Number(c.req.query("tail") || 200)
      );
      return c.json({ logs });
    } catch (err) {
      return c.json({
        logs: "",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.get("/:id/stats", async (c) => {
    const id = c.req.param("id");
    const svc = ctx.db.select().from(services).where(eq(services.id, id)).get();
    if (!svc) return c.json({ error: "Service not found" }, 404);
    const project = ctx.db.select().from(projects).where(eq(projects.id, svc.projectId)).get();
    if (!project) return c.json({ error: "Project not found" }, 404);

    try {
      const cid = await ctx.swarm.findRunningContainerId(
        getSwarmServiceName(project.slug, svc.slug)
      );
      if (!cid) return c.json({ stats: null, running: false });
      const stats = await ctx.swarm.getContainerStats(cid);
      return c.json({ stats, running: true });
    } catch {
      return c.json({ stats: null, running: false });
    }
  });

  return router;
}
