import { Hono } from "hono";
import { z } from "zod";
import {
  decryptSecret,
  deployments,
  desc,
  domains,
  encryptSecret,
  eq,
  generateId,
  generateToken,
  mounts,
  projects,
  services,
} from "@panelmanager/db";
import { generateComposeExport } from "@panelmanager/docker";
import { getTemplateById, instantiateTemplate } from "@panelmanager/templates";
import type { AppContext } from "../context.js";
import { getSwarmServiceName, queueDeployment, type SourceConfig } from "../builder/deploy.js";
import { slugify } from "../utils.js";

const createProjectSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(300).optional(),
});

const deployTemplateSchema = z.object({
  templateId: z.string().min(1),
  inputs: z.record(z.string()),
});

export function createProjectRoutes(ctx: AppContext) {
  const router = new Hono();

  router.get("/", (c) => {
    const list = ctx.db.select().from(projects).orderBy(desc(projects.createdAt)).all();
    const allServices = ctx.db.select().from(services).all();

    const enriched = list.map((p) => {
      const projServices = allServices.filter((s) => s.projectId === p.id);
      return {
        ...p,
        serviceCount: projServices.length,
        runningCount: projServices.filter((s) => s.status === "running").length,
      };
    });
    return c.json({ projects: enriched });
  });

  router.post("/", async (c) => {
    const body = await c.req.json();
    const parsed = createProjectSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const baseSlug = slugify(parsed.data.name, "proj");
    const existing = ctx.db.select().from(projects).where(eq(projects.slug, baseSlug)).get();
    const slug = existing ? `${baseSlug}-${generateId().slice(0, 4)}` : baseSlug;
    const networkName = `proj-${slug}`;
    const now = Date.now();
    const id = generateId();

    ctx.db
      .insert(projects)
      .values({
        id,
        name: parsed.data.name,
        slug,
        networkName,
        description: parsed.data.description || "",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // Best-effort overlay network creation if Docker is active
    try {
      const status = await ctx.swarm.getSystemStatus();
      if (status.swarmActive) {
        await ctx.swarm.ensureOverlayNetwork(networkName);
      }
    } catch {
      // Docker may not be active yet on dev machine
    }

    const created = ctx.db.select().from(projects).where(eq(projects.id, id)).get();
    return c.json({ project: created }, 201);
  });

  router.get("/:id", (c) => {
    const id = c.req.param("id");
    const project = ctx.db.select().from(projects).where(eq(projects.id, id)).get();
    if (!project) return c.json({ error: "Project not found" }, 404);

    const svcList = ctx.db
      .select()
      .from(services)
      .where(eq(services.projectId, id))
      .orderBy(desc(services.createdAt))
      .all();

    const enrichedServices = svcList.map((s) => {
      const svcDomains = ctx.db.select().from(domains).where(eq(domains.serviceId, s.id)).all();
      return {
        id: s.id,
        projectId: s.projectId,
        name: s.name,
        slug: s.slug,
        kind: s.kind,
        sourceType: s.sourceType,
        sourceConfig: JSON.parse(s.sourceConfigJson || "{}"),
        replicas: s.replicas,
        exposedPort: s.exposedPort,
        status: s.status,
        domains: svcDomains,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      };
    });

    return c.json({ project, services: enrichedServices });
  });

  router.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const project = ctx.db.select().from(projects).where(eq(projects.id, id)).get();
    if (!project) return c.json({ error: "Project not found" }, 404);

    const svcList = ctx.db.select().from(services).where(eq(services.projectId, id)).all();
    for (const s of svcList) {
      try {
        await ctx.swarm.removeService(getSwarmServiceName(project.slug, s.slug));
      } catch {
        // ignore if Docker unavailable
      }
    }

    ctx.db.delete(projects).where(eq(projects.id, id)).run();
    return c.json({ ok: true });
  });

  router.get("/:id/export-compose", (c) => {
    const id = c.req.param("id");
    const project = ctx.db.select().from(projects).where(eq(projects.id, id)).get();
    if (!project) return c.json({ error: "Project not found" }, 404);

    const svcList = ctx.db.select().from(services).where(eq(services.projectId, id)).all();
    const exportable = svcList.map((s) => {
      const src = JSON.parse(s.sourceConfigJson || "{}") as SourceConfig;
      const env = s.envEncrypted
        ? (JSON.parse(decryptSecret(s.envEncrypted, ctx.config.panelSecret)) as Record<
            string,
            string
          >)
        : {};
      const svcMounts = ctx.db.select().from(mounts).where(eq(mounts.serviceId, s.id)).all();
      const svcDomains = ctx.db.select().from(domains).where(eq(domains.serviceId, s.id)).all();
      const latestImage =
        src.image ||
        ctx.db
          .select({ imageTag: deployments.imageTag })
          .from(deployments)
          .where(eq(deployments.serviceId, s.id))
          .orderBy(desc(deployments.createdAt))
          .all()
          .find((d) => d.imageTag)?.imageTag ||
        `panel/${project.slug}-${s.slug}:latest`;
      return {
        slug: s.slug,
        image: latestImage,
        env,
        mounts: svcMounts,
        domains: svcDomains,
        replicas: s.replicas,
        exposedPort: s.exposedPort,
      };
    });

    const yaml = generateComposeExport(project.slug, project.networkName, exportable);
    return c.text(yaml, 200, { "Content-Type": "text/yaml; charset=utf-8" });
  });

  router.post("/:id/templates", async (c) => {
    const id = c.req.param("id");
    const project = ctx.db.select().from(projects).where(eq(projects.id, id)).get();
    if (!project) return c.json({ error: "Project not found" }, 404);

    const body = await c.req.json();
    const parsed = deployTemplateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const template = getTemplateById(parsed.data.templateId);
    if (!template) return c.json({ error: "Template not found" }, 404);

    const instantiated = instantiateTemplate(template, project.slug, parsed.data.inputs);
    const createdIds: string[] = [];
    const now = Date.now();

    for (const item of instantiated) {
      const svcId = generateId();
      const existingSvc = ctx.db
        .select()
        .from(services)
        .where(eq(services.projectId, project.id))
        .all()
        .find((s) => s.slug === item.slug);
      const slug = existingSvc ? `${item.slug}-${svcId.slice(0, 4)}` : item.slug;

      ctx.db
        .insert(services)
        .values({
          id: svcId,
          projectId: project.id,
          name: item.name,
          slug,
          kind: item.kind,
          sourceType: "image",
          sourceConfigJson: JSON.stringify({ image: item.image, cmd: item.cmd }),
          envEncrypted: encryptSecret(JSON.stringify(item.env), ctx.config.panelSecret),
          replicas: 1,
          webhookToken: generateToken(16),
          status: "stopped",
          createdAt: now,
          updatedAt: now,
        })
        .run();

      for (const m of item.mounts) {
        ctx.db
          .insert(mounts)
          .values({
            id: generateId(),
            serviceId: svcId,
            type: m.type,
            source: m.source,
            target: m.target,
            readOnly: false,
            createdAt: now,
          })
          .run();
      }

      if (item.domainHost) {
        ctx.db
          .insert(domains)
          .values({
            id: generateId(),
            serviceId: svcId,
            host: item.domainHost,
            internalPort: item.internalPort,
            pathPrefix: "/",
            httpsEnabled: true,
            forceSsl: true,
            createdAt: now,
          })
          .run();
      }

      await queueDeployment(ctx, svcId, "template");
      createdIds.push(svcId);
    }

    return c.json({ ok: true, serviceIds: createdIds }, 201);
  });

  return router;
}
