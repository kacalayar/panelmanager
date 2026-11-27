import { Hono } from "hono";
import { z } from "zod";
import {
  desc,
  encryptSecret,
  eq,
  generateId,
  notificationChannels,
} from "@panelmanager/db";
import type { AppContext } from "../context.js";
import { sendNotification } from "../notifications/sender.js";

const channelSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["telegram", "discord", "webhook"]),
  config: z.record(z.string()),
});

export function createNotificationRoutes(ctx: AppContext) {
  const router = new Hono();

  router.get("/", (c) => {
    const list = ctx.db
      .select()
      .from(notificationChannels)
      .orderBy(desc(notificationChannels.createdAt))
      .all()
      .map((ch) => ({
        id: ch.id,
        name: ch.name,
        type: ch.type,
        enabled: ch.enabled,
        createdAt: ch.createdAt,
      }));
    return c.json({ channels: list });
  });

  router.post("/", async (c) => {
    const body = await c.req.json();
    const parsed = channelSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

    const id = generateId();
    ctx.db
      .insert(notificationChannels)
      .values({
        id,
        name: parsed.data.name,
        type: parsed.data.type,
        configEncrypted: encryptSecret(JSON.stringify(parsed.data.config), ctx.config.panelSecret),
        enabled: true,
        createdAt: Date.now(),
      })
      .run();

    return c.json({ id }, 201);
  });

  router.delete("/:id", (c) => {
    ctx.db
      .delete(notificationChannels)
      .where(eq(notificationChannels.id, c.req.param("id")))
      .run();
    return c.json({ ok: true });
  });

  router.post("/test", async (c) => {
    await sendNotification(ctx.db, ctx.config.panelSecret, {
      title: "PanelManager Test Notification",
      message: "Channel notifikasi berhasil terhubung dengan PanelManager!",
      level: "info",
    });
    return c.json({ ok: true });
  });

  return router;
}
