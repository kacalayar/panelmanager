import yaml from "js-yaml";
import { buildTraefikLabels, type DomainRouteInput } from "./traefik.js";

export interface ExportableService {
  slug: string;
  image: string;
  env: Record<string, string>;
  mounts: Array<{ type: string; source: string; target: string; readOnly?: boolean }>;
  domains: DomainRouteInput[];
  replicas: number;
  exposedPort?: number;
}

/**
 * Exports a project's services as a portable docker-compose.yml (no vendor lock-in).
 */
export function generateComposeExport(
  projectSlug: string,
  networkName: string,
  services: ExportableService[]
): string {
  const composeServices: Record<string, unknown> = {};
  const volumes: Record<string, Record<string, never>> = {};

  for (const svc of services) {
    const labels = buildTraefikLabels(`${projectSlug}-${svc.slug}`, svc.domains);
    const serviceDef: Record<string, unknown> = {
      image: svc.image,
      restart: "unless-stopped",
      networks: [networkName, "panel-net"],
    };

    if (Object.keys(svc.env).length > 0) {
      serviceDef.environment = svc.env;
    }

    if (svc.mounts.length > 0) {
      serviceDef.volumes = svc.mounts.map((m) => {
        if (m.type === "volume") {
          volumes[m.source] = {};
        }
        return `${m.source}:${m.target}${m.readOnly ? ":ro" : ""}`;
      });
    }

    if (svc.exposedPort && svc.exposedPort > 0) {
      serviceDef.ports = [`${svc.exposedPort}:${svc.exposedPort}`];
    }

    if (Object.keys(labels).length > 0) {
      serviceDef.deploy = {
        replicas: svc.replicas,
        labels,
      };
    }

    composeServices[svc.slug] = serviceDef;
  }

  const doc: Record<string, unknown> = {
    services: composeServices,
    networks: {
      [networkName]: { driver: "overlay", attachable: true },
      "panel-net": { external: true },
    },
  };

  if (Object.keys(volumes).length > 0) {
    doc.volumes = volumes;
  }

  return yaml.dump(doc, { noRefs: true, lineWidth: 120 });
}
