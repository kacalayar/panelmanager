import { Hono } from "hono";
import { cors } from "hono/cors";
import { eq, services } from "@panelmanager/db";
import { createAuthMiddleware } from "./auth.js";
import { queueDeployment } from "./builder/deploy.js";
import type { AppContext } from "./context.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createBackupRoutes } from "./routes/backups.js";
import { createNotificationRoutes } from "./routes/notifications.js";
import { createProjectRoutes } from "./routes/projects.js";
import { createServiceRoutes } from "./routes/services.js";
import { createSystemRoutes } from "./routes/system.js";
import { createTemplateRoutes } from "./routes/templates.js";
import { isAllowedOrigin } from "./utils.js";

export function createApp(ctx: AppContext) {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof SyntaxError) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    console.error("Unhandled API error:", err);
    return c.json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  });

  app.use(
    "/api/*",
    cors({
      origin: (origin, c) =>
        isAllowedOrigin(origin, ctx.config.publicUrl, c.req.header("host")) ? origin : null,
      credentials: true,
    })
  );

  app.get("/health", (c) => c.json({ ok: true, service: "panelmanager" }));

  // Public auth endpoints
  app.route("/api/auth", createAuthRoutes(ctx));

  // Public Git webhook auto-deploy endpoint (verified by per-service webhookToken)
  app.post("/api/webhooks/deploy/:serviceId/:token", async (c) => {
    const serviceId = c.req.param("serviceId");
    const token = c.req.param("token");
    const svc = ctx.db.select().from(services).where(eq(services.id, serviceId)).get();
    if (!svc || svc.webhookToken !== token) {
      return c.json({ error: "Invalid webhook token" }, 403);
    }
    const deploymentId = await queueDeployment(ctx, serviceId, "webhook");
    return c.json({ ok: true, deploymentId }, 202);
  });

  // Protected API routes
  const authGuard = createAuthMiddleware(ctx.db);
  app.use("/api/system/*", authGuard);
  app.use("/api/projects/*", authGuard);
  app.use("/api/projects", authGuard);
  app.use("/api/services/*", authGuard);
  app.use("/api/services", authGuard);
  app.use("/api/backups/*", authGuard);
  app.use("/api/notifications/*", authGuard);
  app.use("/api/notifications", authGuard);
  app.use("/api/templates/*", authGuard);
  app.use("/api/templates", authGuard);

  app.route("/api/system", createSystemRoutes(ctx));
  app.route("/api/projects", createProjectRoutes(ctx));
  app.route("/api/services", createServiceRoutes(ctx));
  app.route("/api/backups", createBackupRoutes(ctx));
  app.route("/api/notifications", createNotificationRoutes(ctx));
  app.route("/api/templates", createTemplateRoutes());

  return app;
}
