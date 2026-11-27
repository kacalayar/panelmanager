export const PANEL_OVERLAY_NETWORK = "panel-net";
export const TRAEFIK_SERVICE_NAME = "panel-traefik";

export interface DomainRouteInput {
  id: string;
  host: string;
  internalPort: number;
  pathPrefix: string;
  httpsEnabled: boolean;
  forceSsl: boolean;
}

function sanitizeRouterName(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
}

/**
 * Generates Traefik v3 Docker Swarm labels for a service and its configured domains.
 */
export function buildTraefikLabels(
  serviceKey: string,
  domains: DomainRouteInput[]
): Record<string, string> {
  if (domains.length === 0) {
    return {
      "traefik.enable": "false",
    };
  }

  const labels: Record<string, string> = {
    "traefik.enable": "true",
    "traefik.swarm.network": PANEL_OVERLAY_NETWORK,
    "traefik.http.middlewares.panel-redirect-https.redirectscheme.scheme": "https",
    "traefik.http.middlewares.panel-redirect-https.redirectscheme.permanent": "true",
  };

  domains.forEach((domain, idx) => {
    const routerBase = sanitizeRouterName(`${serviceKey}-${idx}-${domain.id.slice(0, 6)}`);
    const svcName = `${routerBase}-svc`;
    const prefix = domain.pathPrefix && domain.pathPrefix !== "/" ? domain.pathPrefix : "";
    const rule = prefix
      ? `Host(\`${domain.host}\`) && PathPrefix(\`${prefix}\`)`
      : `Host(\`${domain.host}\`)`;

    // Service load balancer port
    labels[`traefik.http.services.${svcName}.loadbalancer.server.port`] = String(
      domain.internalPort || 80
    );

    // HTTP router (port 80)
    const httpRouter = `${routerBase}-http`;
    labels[`traefik.http.routers.${httpRouter}.rule`] = rule;
    labels[`traefik.http.routers.${httpRouter}.entrypoints`] = "web";
    labels[`traefik.http.routers.${httpRouter}.service`] = svcName;

    if (domain.httpsEnabled && domain.forceSsl) {
      labels[`traefik.http.routers.${httpRouter}.middlewares`] = "panel-redirect-https";
    }

    // HTTPS router (port 443) with Let's Encrypt
    if (domain.httpsEnabled) {
      const httpsRouter = `${routerBase}-https`;
      labels[`traefik.http.routers.${httpsRouter}.rule`] = rule;
      labels[`traefik.http.routers.${httpsRouter}.entrypoints`] = "websecure";
      labels[`traefik.http.routers.${httpsRouter}.tls`] = "true";
      labels[`traefik.http.routers.${httpsRouter}.tls.certresolver`] = "letsencrypt";
      labels[`traefik.http.routers.${httpsRouter}.service`] = svcName;
    }
  });

  return labels;
}

/**
 * Generates the Docker Swarm ServiceSpec for Traefik v3 reverse proxy.
 */
export function buildTraefikServiceSpec(acmeEmail: string) {
  return {
    Name: TRAEFIK_SERVICE_NAME,
    Labels: {
      "panelmanager.managed": "true",
      "panelmanager.role": "proxy",
    },
    TaskTemplate: {
      ContainerSpec: {
        Image: "traefik:v3.2",
        Args: [
          "--api.dashboard=false",
          "--providers.swarm=true",
          "--providers.swarm.exposedbydefault=false",
          `--providers.swarm.network=${PANEL_OVERLAY_NETWORK}`,
          "--entrypoints.web.address=:80",
          "--entrypoints.websecure.address=:443",
          "--certificatesresolvers.letsencrypt.acme.httpchallenge=true",
          "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web",
          `--certificatesresolvers.letsencrypt.acme.email=${acmeEmail || "admin@localhost"}`,
          "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json",
          "--log.level=INFO",
        ],
        Mounts: [
          {
            Type: "bind" as const,
            Source: "/var/run/docker.sock",
            Target: "/var/run/docker.sock",
            ReadOnly: true,
          },
          {
            Type: "volume" as const,
            Source: "panel-traefik-acme",
            Target: "/letsencrypt",
          },
        ],
      },
      Placement: {
        Constraints: ["node.role == manager"],
      },
      RestartPolicy: {
        Condition: "any" as const,
      },
    },
    Mode: {
      Replicated: { Replicas: 1 },
    },
    Networks: [{ Target: PANEL_OVERLAY_NETWORK }],
    EndpointSpec: {
      Ports: [
        {
          Protocol: "tcp" as const,
          TargetPort: 80,
          PublishedPort: 80,
          PublishMode: "ingress" as const,
        },
        {
          Protocol: "tcp" as const,
          TargetPort: 443,
          PublishedPort: 443,
          PublishMode: "ingress" as const,
        },
      ],
    },
  };
}
