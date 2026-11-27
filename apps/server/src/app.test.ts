import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { backupDestinations, backupSchedules, createPanelDb, domains, services } from "@panelmanager/db";
import { SwarmClient } from "@panelmanager/docker";
import { createApp } from "./app.js";
import { BackupScheduler, getBackupCommand, getRestoreCommand } from "./backups/worker.js";
import { redactSecrets, scaleService } from "./builder/deploy.js";
import { attachWebSocketServer } from "./ws.js";

describe("Control Plane API", () => {
  function setupTestApp(publicUrl = "https://panel.example.com") {
    const { db, client } = createPanelDb(":memory:");
    const swarm = new SwarmClient();
    const ctx = {
      db,
      swarm,
      config: {
        port: 3001,
        dataDir: "./tmp-test-data",
        dbPath: ":memory:",
        panelSecret: "test-secret-key-at-least-32-characters",
        publicUrl,
      },
      deployEvents: new EventEmitter(),
    };
    const app = createApp(ctx);
    return { app, client, ctx };
  }

  it("handles setup, auth protection, project CRUD, DB creation, and compose export", async () => {
    const { app, client } = setupTestApp();

    // 1. Health & uninitialized status
    const status1 = await app.request("/api/auth/status");
    expect(status1.status).toBe(200);
    expect(await status1.json()).toEqual({ initialized: false, user: null });

    // 2. Protected route rejects unauthenticated calls
    const unauth = await app.request("/api/projects");
    expect(unauth.status).toBe(401);

    // 3. Setup first owner (and reject second setup)
    const setupRes = await app.request("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "owner@panel.local",
        name: "Owner",
        password: "SuperPassword123",
      }),
    });
    expect(setupRes.status).toBe(200);
    const { token } = (await setupRes.json()) as { token: string };
    expect(token).toBeTruthy();

    const secondSetup = await app.request("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "attacker@panel.local",
        name: "Attacker",
        password: "SuperPassword123",
      }),
    });
    expect(secondSetup.status).toBe(400);

    const authHeaders = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    // 4. Create project
    const projRes = await app.request("/api/projects", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "My Client App", description: "Production stack" }),
    });
    expect(projRes.status).toBe(201);
    const { project } = (await projRes.json()) as { project: { id: string; slug: string } };
    expect(project.slug).toBe("my-client-app");

    // 5. Create managed Postgres database & Redis database (with --requirepass)
    const dbRes = await app.request("/api/services", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        projectId: project.id,
        name: "Primary DB",
        kind: "postgres",
      }),
    });
    expect(dbRes.status).toBe(201);
    const { service } = (await dbRes.json()) as { service: { id: string } };

    const redisRes = await app.request("/api/services", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        projectId: project.id,
        name: "Cache Redis",
        kind: "redis",
      }),
    });
    expect(redisRes.status).toBe(201);
    const { service: redisSvc } = (await redisRes.json()) as {
      service: { id: string; sourceConfigJson: string };
    };
    expect(JSON.parse(redisSvc.sourceConfigJson).cmd).toEqual([
      "sh",
      "-c",
      'exec redis-server --requirepass "$REDIS_PASSWORD"',
    ]);

    // 6. Export docker-compose.yml & verify service detail
    const svcDetailRes = await app.request(`/api/services/${service.id}`, {
      headers: authHeaders,
    });
    expect(svcDetailRes.status).toBe(200);
    const detail = (await svcDetailRes.json()) as { service: { connectionUrl: string } };
    expect(detail.service.connectionUrl).toContain("postgresql://");

    const composeRes = await app.request(`/api/projects/${project.id}/export-compose`, {
      headers: authHeaders,
    });
    expect(composeRes.status).toBe(200);
    const yaml = await composeRes.text();
    expect(yaml).toContain("postgres:16-alpine");

    // 7. Templates catalog endpoint
    const tplRes = await app.request("/api/templates", { headers: authHeaders });
    expect(tplRes.status).toBe(200);
    const tplJson = (await tplRes.json()) as { templates: Array<{ id: string }> };
    expect(tplJson.templates.length).toBeGreaterThanOrEqual(8);

    client.close();
  });

  it("blocks sibling-subdomain CORS, invalid JSON, cross-service domain delete, and invalid cron", async () => {
    const { app, client, ctx } = setupTestApp("https://panel.example.com");

    const setupRes = await app.request("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "owner@panel.local",
        name: "Owner",
        password: "SuperPassword123",
      }),
    });
    const { token } = (await setupRes.json()) as { token: string };
    const authHeaders = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    // Sibling subdomain must NOT receive Access-Control-Allow-Origin
    const evilCors = await app.request("/api/auth/status", {
      headers: { Origin: "https://user-app.example.com", Host: "panel.example.com" },
    });
    expect(evilCors.headers.get("access-control-allow-origin")).toBeNull();

    // Configured publicUrl IS allowed
    const goodCors = await app.request("/api/auth/status", {
      headers: { Origin: "https://panel.example.com", Host: "panel.example.com" },
    });
    expect(goodCors.headers.get("access-control-allow-origin")).toBe("https://panel.example.com");

    // Invalid JSON returns 400 instead of 500
    const badJson = await app.request("/api/projects", {
      method: "POST",
      headers: authHeaders,
      body: "{not-json",
    });
    expect(badJson.status).toBe(400);

    // Cross-service domain deletion is ignored
    const projRes = await app.request("/api/projects", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "App" }),
    });
    const { project } = (await projRes.json()) as { project: { id: string } };
    const svc1Res = await app.request("/api/services", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ projectId: project.id, name: "Svc One" }),
    });
    const svc2Res = await app.request("/api/services", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ projectId: project.id, name: "Svc Two" }),
    });
    const { service: s1 } = (await svc1Res.json()) as { service: { id: string } };
    const { service: s2 } = (await svc2Res.json()) as { service: { id: string } };

    const domRes = await app.request(`/api/services/${s1.id}/domains`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ host: "one.example.com" }),
    });
    const { domain } = (await domRes.json()) as { domain: { id: string } };

    // Deleting s1's domain via s2's URL must not delete it
    await app.request(`/api/services/${s2.id}/domains/${domain.id}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    expect(ctx.db.select().from(domains).all()).toHaveLength(1);

    // Invalid cron expression is rejected with 400
    ctx.db
      .insert(backupDestinations)
      .values({ id: "dest1", name: "Local", provider: "local", createdAt: Date.now() })
      .run();
    const badCron = await app.request("/api/backups/schedules", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        serviceId: s1.id,
        destinationId: "dest1",
        cronExpr: "not a cron",
      }),
    });
    expect(badCron.status).toBe(400);

    // BackupScheduler.reload survives corrupt DB cron rows
    ctx.db
      .insert(backupSchedules)
      .values({
        id: "bad-sched",
        serviceId: s1.id,
        destinationId: "dest1",
        cronExpr: "broken-cron",
        enabled: true,
        createdAt: Date.now(),
      })
      .run();
    const scheduler = new BackupScheduler(ctx);
    expect(() => scheduler.reload()).not.toThrow();
    scheduler.stop();

    client.close();
  });

  it("scales existing image service with Swarm alias without rebuilding, and redacts git tokens", async () => {
    const { app, client, ctx } = setupTestApp();
    const upsertSpy = vi.spyOn(ctx.swarm, "upsertService").mockResolvedValue("swarm-svc-id");

    const setupRes = await app.request("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "owner@panel.local",
        name: "Owner",
        password: "SuperPassword123",
      }),
    });
    const { token } = (await setupRes.json()) as { token: string };
    const authHeaders = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const projRes = await app.request("/api/projects", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "Scale Test" }),
    });
    const { project } = (await projRes.json()) as { project: { id: string } };
    const svcRes = await app.request("/api/services", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        projectId: project.id,
        name: "Web App",
        sourceType: "image",
        sourceConfig: { image: "nginx:alpine" },
      }),
    });
    const { service: svc } = (await svcRes.json()) as { service: { id: string } };

    await scaleService(ctx, svc.id, 0);
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceName: "scale-test-web-app",
        serviceSlug: "web-app",
        image: "nginx:alpine",
        replicas: 0,
      })
    );
    const updated = ctx.db.select().from(services).all().find((s) => s.id === svc.id);
    expect(updated?.status).toBe("stopped");

    // Secret redaction
    expect(redactSecrets("fatal: https://oauth2:ghp_secret123@github.com/a/b", ["ghp_secret123"])).toBe(
      "fatal: https://oauth2:***@github.com/a/b"
    );

    // Backup/restore commands pass passwords in Env, never interpolated in sh -c
    const dangerousPass = 'p@ss"$(whoami)`id`';
    const pgBackup = getBackupCommand("postgres", { POSTGRES_PASSWORD: dangerousPass, POSTGRES_USER: "u1" });
    expect(pgBackup.cmd.join(" ")).not.toContain(dangerousPass);
    expect(pgBackup.env).toContain(`PGPASSWORD=${dangerousPass}`);

    const mysqlRestore = getRestoreCommand("mysql", { MYSQL_ROOT_PASSWORD: dangerousPass });
    expect(mysqlRestore.cmd.join(" ")).not.toContain(dangerousPass);
    expect(mysqlRestore.env).toContain(`MYSQL_PWD=${dangerousPass}`);

    client.close();
  });

  it("rejects WebSocket upgrades without auth or with disallowed Origin", async () => {
    const { client, ctx } = setupTestApp("https://panel.example.com");
    const server = createServer();
    const wss = attachWebSocketServer(server, ctx);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    const unauthStatus = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/deployments/d1`);
      ws.on("unexpected-response", (_req, res) => resolve(res.statusCode || 0));
    });
    expect(unauthStatus).toBe(401);

    const badOriginStatus = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/deployments/d1`, {
        headers: { Origin: "https://evil.example.com" },
      });
      ws.on("unexpected-response", (_req, res) => resolve(res.statusCode || 0));
    });
    expect(badOriginStatus).toBe(403);

    wss.close();
    server.close();
    client.close();
  });
});
