import Docker from "dockerode";
import type { Duplex, Readable, Writable } from "node:stream";
import {
  buildTraefikLabels,
  buildTraefikServiceSpec,
  PANEL_OVERLAY_NETWORK,
  TRAEFIK_SERVICE_NAME,
  type DomainRouteInput,
} from "./traefik.js";

export interface UpsertSwarmServiceOptions {
  serviceName: string;
  serviceSlug?: string;
  image: string;
  projectNetwork: string;
  env: Record<string, string>;
  mounts: Array<{
    type: "volume" | "bind";
    source: string;
    target: string;
    readOnly?: boolean;
  }>;
  domains: DomainRouteInput[];
  replicas: number;
  cpuLimit?: string;
  memoryLimitMb?: number;
  exposedPort?: number;
  internalPort?: number;
  cmd?: string[];
  extraLabels?: Record<string, string>;
}

export interface ContainerStatsSnapshot {
  cpuPercent: number;
  memoryUsedMb: number;
  memoryLimitMb: number;
  memoryPercent: number;
  networkRxBytes: number;
  networkTxBytes: number;
}

export interface DockerSystemStatus {
  connected: boolean;
  dockerVersion: string;
  swarmActive: boolean;
  isManager: boolean;
  nodeCount: number;
  cpus: number;
  totalMemoryMb: number;
  containersRunning: number;
  error?: string;
}

export class SwarmClient {
  public readonly docker: Docker;

  constructor(options?: Docker.DockerOptions) {
    this.docker = new Docker(options);
  }

  async getSystemStatus(): Promise<DockerSystemStatus> {
    try {
      const info = (await this.docker.info()) as Record<string, any>;
      const swarm = info.Swarm || {};
      const state = String(swarm.LocalNodeState || "").toLowerCase();
      return {
        connected: true,
        dockerVersion: String(info.ServerVersion || "unknown"),
        swarmActive: state === "active",
        isManager: Boolean(swarm.ControlAvailable),
        nodeCount: Number(swarm.Nodes || (state === "active" ? 1 : 0)),
        cpus: Number(info.NCPU || 0),
        totalMemoryMb: Math.round(Number(info.MemTotal || 0) / (1024 * 1024)),
        containersRunning: Number(info.ContainersRunning || 0),
      };
    } catch (err) {
      return {
        connected: false,
        dockerVersion: "",
        swarmActive: false,
        isManager: false,
        nodeCount: 0,
        cpus: 0,
        totalMemoryMb: 0,
        containersRunning: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async ensureSwarmInitialized(advertiseAddr?: string): Promise<void> {
    const status = await this.getSystemStatus();
    if (!status.connected) {
      throw new Error(`Docker daemon unreachable: ${status.error}`);
    }
    if (!status.swarmActive) {
      await this.docker.swarmInit({
        ListenAddr: "0.0.0.0:2377",
        ...(advertiseAddr ? { AdvertiseAddr: advertiseAddr } : {}),
      });
    }
  }

  async ensureOverlayNetwork(name: string): Promise<void> {
    const networks = await this.docker.listNetworks({
      filters: { name: [name] },
    });
    const exact = networks.find((n) => n.Name === name);
    if (!exact) {
      await this.docker.createNetwork({
        Name: name,
        Driver: "overlay",
        Attachable: true,
        Labels: { "panelmanager.managed": "true" },
      });
    }
  }

  async ensureVolume(name: string): Promise<void> {
    try {
      await this.docker.getVolume(name).inspect();
    } catch {
      await this.docker.createVolume({
        Name: name,
        Labels: { "panelmanager.managed": "true" },
      });
    }
  }

  async ensureTraefik(acmeEmail: string): Promise<void> {
    await this.ensureSwarmInitialized();
    await this.ensureOverlayNetwork(PANEL_OVERLAY_NETWORK);
    await this.ensureVolume("panel-traefik-acme");

    const spec = buildTraefikServiceSpec(acmeEmail);
    const services = await this.docker.listServices({
      filters: { name: [TRAEFIK_SERVICE_NAME] },
    });
    const existing = services.find((s) => s.Spec?.Name === TRAEFIK_SERVICE_NAME);

    if (!existing) {
      await this.docker.createService(spec);
    } else {
      const full = await this.docker.getService(existing.ID).inspect();
      await this.docker.getService(existing.ID).update({
        ...spec,
        version: Number(full.Version?.Index || 0),
      });
    }
  }

  async pullImage(image: string, onLog?: (line: string) => void): Promise<void> {
    const stream = await this.docker.pull(image);
    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(
        stream,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        },
        (event: { status?: string; progress?: string; id?: string }) => {
          if (onLog && event.status) {
            const msg = [event.id, event.status, event.progress].filter(Boolean).join(" ");
            onLog(msg);
          }
        }
      );
    });
  }

  async upsertService(opts: UpsertSwarmServiceOptions): Promise<string> {
    await this.ensureOverlayNetwork(PANEL_OVERLAY_NETWORK);
    await this.ensureOverlayNetwork(opts.projectNetwork);

    for (const m of opts.mounts) {
      if (m.type === "volume") {
        await this.ensureVolume(m.source);
      }
    }

    const envArray = Object.entries(opts.env).map(([k, v]) => `${k}=${v}`);
    const traefikLabels = buildTraefikLabels(opts.serviceName, opts.domains);
    const labels: Record<string, string> = {
      "panelmanager.managed": "true",
      ...traefikLabels,
      ...(opts.extraLabels || {}),
    };

    const resources: Record<string, unknown> = {};
    const limits: Record<string, number> = {};
    if (opts.cpuLimit && Number(opts.cpuLimit) > 0) {
      limits.NanoCPUs = Math.round(Number(opts.cpuLimit) * 1e9);
    }
    if (opts.memoryLimitMb && opts.memoryLimitMb > 0) {
      limits.MemoryBytes = opts.memoryLimitMb * 1024 * 1024;
    }
    if (Object.keys(limits).length > 0) {
      resources.Limits = limits;
    }

    const networks: Array<{ Target: string; Aliases?: string[] }> = [
      {
        Target: opts.projectNetwork,
        ...(opts.serviceSlug ? { Aliases: [opts.serviceSlug] } : {}),
      },
    ];
    if (opts.domains.length > 0) {
      networks.push({ Target: PANEL_OVERLAY_NETWORK });
    }

    const endpointSpec =
      opts.exposedPort && opts.exposedPort > 0
        ? {
            Ports: [
              {
                Protocol: "tcp" as const,
                TargetPort: opts.internalPort || opts.exposedPort,
                PublishedPort: opts.exposedPort,
                PublishMode: "ingress" as const,
              },
            ],
          }
        : undefined;

    const spec: Record<string, any> = {
      Name: opts.serviceName,
      Labels: labels,
      TaskTemplate: {
        ContainerSpec: {
          Image: opts.image,
          Env: envArray,
          ...(opts.cmd && opts.cmd.length > 0 ? { Command: opts.cmd } : {}),
          Mounts: opts.mounts.map((m) => ({
            Type: m.type,
            Source: m.source,
            Target: m.target,
            ReadOnly: Boolean(m.readOnly),
          })),
        },
        ...(Object.keys(resources).length > 0 ? { Resources: resources } : {}),
        RestartPolicy: {
          Condition: "any",
        },
      },
      Mode: {
        Replicated: {
          Replicas: Math.max(0, opts.replicas),
        },
      },
      UpdateConfig: {
        Parallelism: 1,
        Delay: 2_000_000_000,
        Order: "start-first",
        FailureAction: "rollback",
      },
      Networks: networks,
      ...(endpointSpec ? { EndpointSpec: endpointSpec } : {}),
    };

    const existingList = await this.docker.listServices({
      filters: { name: [opts.serviceName] },
    });
    const existing = existingList.find((s) => s.Spec?.Name === opts.serviceName);

    if (!existing) {
      const created = await this.docker.createService(spec);
      return created.id;
    }

    const inspected = await this.docker.getService(existing.ID).inspect();
    await this.docker.getService(existing.ID).update({
      ...spec,
      version: Number(inspected.Version?.Index || 0),
    });
    return existing.ID;
  }

  async removeService(serviceName: string): Promise<void> {
    const existingList = await this.docker.listServices({
      filters: { name: [serviceName] },
    });
    const existing = existingList.find((s) => s.Spec?.Name === serviceName);
    if (existing) {
      await this.docker.getService(existing.ID).remove();
    }
  }

  async findRunningContainerId(serviceName: string): Promise<string | null> {
    const tasks = await this.docker.listTasks({
      filters: {
        service: [serviceName],
        "desired-state": ["running"],
      },
    });
    for (const task of tasks) {
      const cid = task.Status?.ContainerStatus?.ContainerID;
      if (cid && task.Status?.State === "running") {
        return cid;
      }
    }
    return null;
  }

  async getContainerStats(containerId: string): Promise<ContainerStatsSnapshot> {
    const container = this.docker.getContainer(containerId);
    const stats = (await container.stats({ stream: false })) as Record<string, any>;

    const cpuDelta =
      (stats.cpu_stats?.cpu_usage?.total_usage || 0) -
      (stats.precpu_stats?.cpu_usage?.total_usage || 0);
    const systemDelta =
      (stats.cpu_stats?.system_cpu_usage || 0) -
      (stats.precpu_stats?.system_cpu_usage || 0);
    const onlineCpus =
      stats.cpu_stats?.online_cpus ||
      stats.cpu_stats?.cpu_usage?.percpu_usage?.length ||
      1;

    const cpuPercent =
      systemDelta > 0 && cpuDelta > 0 ? (cpuDelta / systemDelta) * onlineCpus * 100 : 0;

    const memUsage = stats.memory_stats?.usage || 0;
    const memCache =
      stats.memory_stats?.stats?.cache ?? stats.memory_stats?.stats?.inactive_file ?? 0;
    const actualMem = Math.max(0, memUsage - memCache);
    const memLimit = stats.memory_stats?.limit || 1;

    let rx = 0;
    let tx = 0;
    const networks = stats.networks || {};
    for (const iface of Object.values(networks) as Array<{ rx_bytes?: number; tx_bytes?: number }>) {
      rx += iface.rx_bytes || 0;
      tx += iface.tx_bytes || 0;
    }

    return {
      cpuPercent: Number(cpuPercent.toFixed(2)),
      memoryUsedMb: Number((actualMem / (1024 * 1024)).toFixed(2)),
      memoryLimitMb: Number((memLimit / (1024 * 1024)).toFixed(2)),
      memoryPercent: Number(((actualMem / memLimit) * 100).toFixed(2)),
      networkRxBytes: rx,
      networkTxBytes: tx,
    };
  }

  async getServiceLogsSnapshot(serviceName: string, tail = 200): Promise<string> {
    const services = await this.docker.listServices({
      filters: { name: [serviceName] },
    });
    const svc = services.find((s) => s.Spec?.Name === serviceName);
    if (!svc) return "";

    const raw = (await this.docker.getService(svc.ID).logs({
      follow: false,
      stdout: true,
      stderr: true,
      tail,
      timestamps: true,
    })) as unknown;

    if (typeof raw === "string") return raw;
    if (Buffer.isBuffer(raw)) return stripDockerStreamHeaders(raw);
    if (raw && typeof (raw as any).on === "function") {
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        (raw as NodeJS.ReadableStream).on("data", (c: Buffer | string) =>
          chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c))
        );
        (raw as NodeJS.ReadableStream).on("end", resolve);
        (raw as NodeJS.ReadableStream).on("error", reject);
      });
      return stripDockerStreamHeaders(Buffer.concat(chunks));
    }
    return "";
  }

  async execInContainer(
    containerId: string,
    cmd: string[],
    env?: string[]
  ): Promise<{ exitCode: number; stdout: Buffer; stderr: Buffer }> {
    const stdoutChunks: Buffer[] = [];
    const sink = {
      write: (chunk: Buffer) => {
        stdoutChunks.push(Buffer.from(chunk));
        return true;
      },
      on: () => sink,
    } as unknown as Writable;
    const { exitCode, stderr } = await this.execToStream(containerId, cmd, sink, env);
    return {
      exitCode,
      stdout: Buffer.concat(stdoutChunks),
      stderr,
    };
  }

  /**
   * Executes a command in a container and streams stdout directly to a Writable without buffering.
   */
  async execToStream(
    containerId: string,
    cmd: string[],
    stdout: Writable,
    env?: string[]
  ): Promise<{ exitCode: number; stderr: Buffer }> {
    const container = this.docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: cmd,
      ...(env && env.length > 0 ? { Env: env } : {}),
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = (await exec.start({ hijack: true, stdin: false })) as Duplex;
    const stderrChunks: Buffer[] = [];

    await new Promise<void>((resolve, reject) => {
      this.docker.modem.demuxStream(
        stream,
        stdout,
        {
          write: (chunk: Buffer) => {
            stderrChunks.push(Buffer.from(chunk));
            return true;
          },
        } as any
      );
      stream.on("end", resolve);
      stream.on("error", reject);
      stdout.on("error", reject);
    });

    const inspect = await exec.inspect();
    return {
      exitCode: Number(inspect.ExitCode ?? 0),
      stderr: Buffer.concat(stderrChunks),
    };
  }

  /**
   * Executes a command in a container, streaming a Readable into stdin and returning exit code.
   */
  async execFromStream(
    containerId: string,
    cmd: string[],
    stdin: Readable,
    env?: string[]
  ): Promise<{ exitCode: number; stderr: Buffer }> {
    const container = this.docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: cmd,
      ...(env && env.length > 0 ? { Env: env } : {}),
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = (await exec.start({ hijack: true, stdin: true })) as Duplex;
    const stderrChunks: Buffer[] = [];

    await new Promise<void>((resolve, reject) => {
      this.docker.modem.demuxStream(
        stream,
        { write: () => true } as any,
        {
          write: (chunk: Buffer) => {
            stderrChunks.push(Buffer.from(chunk));
            return true;
          },
        } as any
      );
      stdin.on("error", reject);
      stream.on("error", reject);
      stream.on("end", resolve);
      stdin.pipe(stream, { end: false });
      stdin.on("end", () => {
        stream.end();
      });
    });

    const inspect = await exec.inspect();
    return {
      exitCode: Number(inspect.ExitCode ?? 0),
      stderr: Buffer.concat(stderrChunks),
    };
  }

  async createInteractiveExec(containerId: string, shell = "/bin/sh"): Promise<Duplex> {
    const container = this.docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: [shell],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
    });
    const stream = (await exec.start({
      hijack: true,
      stdin: true,
      Tty: true,
    })) as Duplex;
    return stream;
  }
}

/**
 * Strips Docker 8-byte multiplexed stream headers if present.
 */
export function stripDockerStreamHeaders(buf: Buffer): string {
  if (buf.length < 8) {
    return buf.toString("utf8");
  }
  const lines: string[] = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const streamType = buf[offset];
    const isDockerHeader =
      streamType <= 2 && buf[offset + 1] === 0 && buf[offset + 2] === 0 && buf[offset + 3] === 0;
    if (!isDockerHeader) {
      return offset === 0
        ? buf.toString("utf8")
        : lines.join("") + buf.subarray(offset).toString("utf8");
    }
    const payloadSize = buf.readUInt32BE(offset + 4);
    offset += 8;
    const end = Math.min(offset + payloadSize, buf.length);
    lines.push(buf.subarray(offset, end).toString("utf8"));
    offset = end;
  }
  if (offset < buf.length) {
    lines.push(buf.subarray(offset).toString("utf8"));
  }
  return lines.join("");
}
