import { Hono } from "hono";
import os from "node:os";
import { z } from "zod";
import { eq, settings } from "@panelmanager/db";
import type { AppContext } from "../context.js";

const traefikSchema = z.object({
  acmeEmail: z.string().email(),
});

export function createSystemRoutes(ctx: AppContext) {
  const router = new Hono();

  router.get("/status", async (c) => {
    const dockerStatus = await ctx.swarm.getSystemStatus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const load = os.loadavg();

    const allSettings = ctx.db.select().from(settings).all();
    const settingsMap = Object.fromEntries(allSettings.map((s) => [s.key, s.value]));

    return c.json({
      docker: dockerStatus,
      host: {
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        uptimeSeconds: Math.round(os.uptime()),
        cpus: os.cpus().length,
        loadAvg: load,
        memoryTotalMb: Math.round(totalMem / (1024 * 1024)),
        memoryUsedMb: Math.round((totalMem - freeMem) / (1024 * 1024)),
      },
      settings: settingsMap,
    });
  });

  router.post("/swarm/init", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    await ctx.swarm.ensureSwarmInitialized(body?.advertiseAddr);
    const status = await ctx.swarm.getSystemStatus();
    return c.json({ ok: true, docker: status });
  });

  router.post("/traefik/sync", async (c) => {
    const body = await c.req.json();
    const parsed = traefikSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const now = Date.now();
    const upsertSetting = (key: string, value: string) => {
      const existing = ctx.db.select().from(settings).where(eq(settings.key, key)).get();
      if (existing) {
        ctx.db.update(settings).set({ value, updatedAt: now }).where(eq(settings.key, key)).run();
      } else {
        ctx.db.insert(settings).values({ key, value, updatedAt: now }).run();
      }
    };

    upsertSetting("acme_email", parsed.data.acmeEmail);

    await ctx.swarm.ensureTraefik(parsed.data.acmeEmail);
    return c.json({ ok: true });
  });

  return router;
}
