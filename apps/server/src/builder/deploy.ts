import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  decryptSecret,
  deployments,
  desc,
  domains,
  eq,
  generateId,
  mounts,
  projects,
  services,
} from "@panelmanager/db";
import type { AppContext } from "../context.js";
import { sendNotification } from "../notifications/sender.js";

export interface SourceConfig {
  image?: string;
  repoUrl?: string;
  branch?: string;
  dockerfilePath?: string;
  buildContext?: string;
  gitToken?: string;
  cmd?: string[];
}

const serviceDeployQueues = new Map<string, Promise<void>>();

export function getSwarmServiceName(projectSlug: string, serviceSlug: string): string {
  return `${projectSlug}-${serviceSlug}`;
}

export function redactSecrets(text: string, secrets: Array<string | undefined>): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length > 0) {
      out = out.split(secret).join("***");
    }
  }
  return out;
}

function decryptServiceEnv(envEncrypted: string, panelSecret: string): Record<string, string> {
  return envEncrypted
    ? (JSON.parse(decryptSecret(envEncrypted, panelSecret)) as Record<string, string>)
    : {};
}

async function upsertSwarmFromDb(
  ctx: AppContext,
  svc: typeof services.$inferSelect,
  project: typeof projects.$inferSelect,
  imageTag: string,
  envVars: Record<string, string>,
  cmd?: string[]
) {
  const svcDomains = ctx.db.select().from(domains).where(eq(domains.serviceId, svc.id)).all();
  const svcMounts = ctx.db.select().from(mounts).where(eq(mounts.serviceId, svc.id)).all();
  const swarmName = getSwarmServiceName(project.slug, svc.slug);

  await ctx.swarm.upsertService({
    serviceName: swarmName,
    serviceSlug: svc.slug,
    image: imageTag,
    projectNetwork: project.networkName,
    env: envVars,
    mounts: svcMounts.map((m) => ({
      type: m.type === "bind" ? "bind" : "volume",
      source: m.source,
      target: m.target,
      readOnly: m.readOnly,
    })),
    domains: svcDomains.map((d) => ({
      id: d.id,
      host: d.host,
      internalPort: d.internalPort,
      pathPrefix: d.pathPrefix,
      httpsEnabled: d.httpsEnabled,
      forceSsl: d.forceSsl,
    })),
    replicas: svc.replicas,
    cpuLimit: svc.cpuLimit || undefined,
    memoryLimitMb: svc.memoryLimitMb || undefined,
    exposedPort: svc.exposedPort || undefined,
    cmd,
    extraLabels: {
      "panelmanager.project": project.slug,
      "panelmanager.service": svc.slug,
    },
  });
}

function runCommandWithLogs(
  cmd: string,
  args: string[],
  cwd: string | undefined,
  onLog: (line: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, env: process.env });
    proc.stdout.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        if (line) onLog(line);
      }
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        if (line) onLog(line);
      }
    });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

function injectGitToken(repoUrl: string, token?: string): string {
  if (!token) return repoUrl;
  try {
    const parsed = new URL(repoUrl);
    if (parsed.protocol === "https:" && !parsed.username) {
      parsed.username = "oauth2";
      parsed.password = token;
      return parsed.toString();
    }
  } catch {
    // non-HTTP git URL
  }
  return repoUrl;
}

export async function queueDeployment(
  ctx: AppContext,
  serviceId: string,
  trigger: "manual" | "webhook" | "template" = "manual"
): Promise<string> {
  const svc = ctx.db.select().from(services).where(eq(services.id, serviceId)).get();
  if (!svc) throw new Error("Service not found");

  const deployId = generateId();
  const now = Date.now();
  const initialLog = `[${new Date(now).toISOString()}] Queued ${trigger} deployment...\n`;
  ctx.db
    .insert(deployments)
    .values({
      id: deployId,
      serviceId,
      trigger,
      status: "queued",
      logContent: initialLog,
      createdAt: now,
    })
    .run();

  ctx.db
    .update(services)
    .set({ status: "building", updatedAt: now })
    .where(eq(services.id, serviceId))
    .run();

  // Serialize builds per serviceId to prevent concurrent clones clobbering the build directory.
  const prev = serviceDeployQueues.get(serviceId) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => executeDeployment(ctx, deployId, serviceId, initialLog));
  serviceDeployQueues.set(serviceId, next);
  void next.finally(() => {
    if (serviceDeployQueues.get(serviceId) === next) {
      serviceDeployQueues.delete(serviceId);
    }
  });
  return deployId;
}

export async function scaleService(
  ctx: AppContext,
  serviceId: string,
  replicas: number
): Promise<{ deploymentId?: string }> {
  const svc = ctx.db.select().from(services).where(eq(services.id, serviceId)).get();
  if (!svc) throw new Error("Service not found");
  const project = ctx.db.select().from(projects).where(eq(projects.id, svc.projectId)).get();
  if (!project) throw new Error("Project not found");

  const sourceConfig = JSON.parse(svc.sourceConfigJson || "{}") as SourceConfig;
  const latestBuilt = ctx.db
    .select()
    .from(deployments)
    .where(eq(deployments.serviceId, serviceId))
    .orderBy(desc(deployments.createdAt))
    .all()
    .find((d) => d.imageTag);
  const imageTag = sourceConfig.image || latestBuilt?.imageTag || "";

  if (!imageTag) {
    if (replicas > 0) {
      const deploymentId = await queueDeployment(ctx, serviceId, "manual");
      return { deploymentId };
    }
    ctx.db
      .update(services)
      .set({ replicas: 0, status: "stopped", updatedAt: Date.now() })
      .where(eq(services.id, serviceId))
      .run();
    return {};
  }

  ctx.db
    .update(services)
    .set({
      replicas,
      status: replicas === 0 ? "stopped" : "running",
      updatedAt: Date.now(),
    })
    .where(eq(services.id, serviceId))
    .run();

  const updatedSvc = ctx.db.select().from(services).where(eq(services.id, serviceId)).get()!;
  const envVars = decryptServiceEnv(updatedSvc.envEncrypted, ctx.config.panelSecret);
  await upsertSwarmFromDb(ctx, updatedSvc, project, imageTag, envVars, sourceConfig.cmd);
  return {};
}

async function executeDeployment(
  ctx: AppContext,
  deployId: string,
  serviceId: string,
  initialLog: string
): Promise<void> {
  const svc = ctx.db.select().from(services).where(eq(services.id, serviceId)).get();
  if (!svc) return;
  const project = ctx.db.select().from(projects).where(eq(projects.id, svc.projectId)).get();
  if (!project) return;

  const sourceConfig = JSON.parse(svc.sourceConfigJson || "{}") as SourceConfig;
  const secretsToRedact = [sourceConfig.gitToken];

  let logBuffer = initialLog;
  let dirty = false;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flushLogs = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (!dirty) return;
    dirty = false;
    ctx.db
      .update(deployments)
      .set({ logContent: logBuffer })
      .where(eq(deployments.id, deployId))
      .run();
  };

  const appendLog = (line: string) => {
    const safeLine = redactSecrets(line, secretsToRedact);
    const formatted = `[${new Date().toISOString()}] ${safeLine}`;
    logBuffer += formatted + "\n";
    dirty = true;
    ctx.deployEvents.emit(`log:${deployId}`, formatted);
    if (!flushTimer) {
      flushTimer = setTimeout(flushLogs, 1000);
    }
  };

  const swarmName = getSwarmServiceName(project.slug, svc.slug);
  const buildDir = join(ctx.config.dataDir, "builds", serviceId, deployId);

  try {
    ctx.db
      .update(deployments)
      .set({ status: "building" })
      .where(eq(deployments.id, deployId))
      .run();

    const envVars = decryptServiceEnv(svc.envEncrypted, ctx.config.panelSecret);
    let imageTag = sourceConfig.image || "";

    if (svc.sourceType === "image") {
      if (!imageTag) throw new Error("Docker image name is required");
      appendLog(`Pulling image ${imageTag}...`);
      await ctx.swarm.pullImage(imageTag, (line) => appendLog(line));
    } else {
      if (!sourceConfig.repoUrl) throw new Error("Git repository URL is required");
      const branch = sourceConfig.branch || "main";
      if (existsSync(buildDir)) {
        rmSync(buildDir, { recursive: true, force: true });
      }
      mkdirSync(buildDir, { recursive: true });

      const cloneUrl = injectGitToken(sourceConfig.repoUrl, sourceConfig.gitToken);
      appendLog(`Cloning ${sourceConfig.repoUrl} (branch: ${branch})...`);
      await runCommandWithLogs(
        "git",
        ["clone", "--depth", "1", "--branch", branch, cloneUrl, "."],
        buildDir,
        appendLog
      );

      imageTag = `panel/${project.slug}-${svc.slug}:${deployId.slice(0, 10)}`;
      const contextDir = sourceConfig.buildContext
        ? join(buildDir, sourceConfig.buildContext)
        : buildDir;

      const dockerfilePath = join(contextDir, sourceConfig.dockerfilePath || "Dockerfile");
      const useNixpacks =
        svc.sourceType === "nixpacks" ||
        (svc.sourceType === "git" && !existsSync(dockerfilePath));

      if (useNixpacks) {
        appendLog(`Building with Nixpacks -> ${imageTag}...`);
        const envArgs = Object.entries(envVars).flatMap(([k, v]) => ["--env", `${k}=${v}`]);
        await runCommandWithLogs(
          "nixpacks",
          ["build", contextDir, "--name", imageTag, ...envArgs],
          contextDir,
          appendLog
        );
      } else {
        appendLog(`Building Dockerfile (${dockerfilePath}) -> ${imageTag}...`);
        await runCommandWithLogs(
          "docker",
          ["build", "-t", imageTag, "-f", dockerfilePath, contextDir],
          contextDir,
          appendLog
        );
      }
    }

    ctx.db
      .update(deployments)
      .set({ status: "deploying", imageTag })
      .where(eq(deployments.id, deployId))
      .run();

    appendLog(`Updating Docker Swarm service "${swarmName}" (replicas: ${svc.replicas})...`);

    await upsertSwarmFromDb(ctx, svc, project, imageTag, envVars, sourceConfig.cmd);

    const finishedAt = Date.now();
    appendLog(`Deployment succeeded! Service ${swarmName} is live.`);
    flushLogs();

    ctx.db
      .update(deployments)
      .set({ status: "running", finishedAt })
      .where(eq(deployments.id, deployId))
      .run();
    ctx.db
      .update(services)
      .set({ status: svc.replicas > 0 ? "running" : "stopped", updatedAt: finishedAt })
      .where(eq(services.id, serviceId))
      .run();

    ctx.deployEvents.emit(`done:${deployId}`, { status: "running" });
    await sendNotification(ctx.db, ctx.config.panelSecret, {
      title: `Deploy Success: ${project.name} / ${svc.name}`,
      message: `Image \`${imageTag}\` berhasil dideploy.`,
      level: "success",
    });
  } catch (err) {
    const message = redactSecrets(err instanceof Error ? err.message : String(err), secretsToRedact);
    const finishedAt = Date.now();
    appendLog(`ERROR: ${message}`);
    flushLogs();

    ctx.db
      .update(deployments)
      .set({ status: "failed", errorMessage: message, finishedAt })
      .where(eq(deployments.id, deployId))
      .run();
    ctx.db
      .update(services)
      .set({ status: "error", updatedAt: finishedAt })
      .where(eq(services.id, serviceId))
      .run();

    ctx.deployEvents.emit(`done:${deployId}`, { status: "failed", error: message });
    await sendNotification(ctx.db, ctx.config.panelSecret, {
      title: `Deploy Failed: ${project.name} / ${svc.name}`,
      message,
      level: "error",
    });
  } finally {
    flushLogs();
    if (existsSync(buildDir)) {
      rmSync(buildDir, { recursive: true, force: true });
    }
  }
}
