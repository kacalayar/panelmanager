import { describe, expect, it } from "vitest";
import { generateComposeExport } from "./compose.js";
import { stripDockerStreamHeaders } from "./swarm.js";
import { buildTraefikLabels, buildTraefikServiceSpec } from "./traefik.js";

describe("Traefik Swarm label generator", () => {
  it("disables traefik when no domains are configured", () => {
    expect(buildTraefikLabels("my-app", [])).toEqual({
      "traefik.enable": "false",
    });
  });

  it("generates HTTP + HTTPS + redirect labels for custom domains", () => {
    const labels = buildTraefikLabels("demo-web", [
      {
        id: "dom123456",
        host: "app.example.com",
        internalPort: 3000,
        pathPrefix: "/",
        httpsEnabled: true,
        forceSsl: true,
      },
    ]);

    expect(labels["traefik.enable"]).toBe("true");
    expect(labels["traefik.swarm.network"]).toBe("panel-net");
    expect(labels["traefik.http.routers.demo-web-0-dom123-http.rule"]).toBe(
      "Host(`app.example.com`)"
    );
    expect(labels["traefik.http.routers.demo-web-0-dom123-http.middlewares"]).toBe(
      "panel-redirect-https"
    );
    expect(labels["traefik.http.routers.demo-web-0-dom123-https.tls.certresolver"]).toBe(
      "letsencrypt"
    );
    expect(labels["traefik.http.services.demo-web-0-dom123-svc.loadbalancer.server.port"]).toBe(
      "3000"
    );
  });

  it("includes PathPrefix when non-root prefix is provided", () => {
    const labels = buildTraefikLabels("api", [
      {
        id: "d1",
        host: "example.com",
        internalPort: 8080,
        pathPrefix: "/api",
        httpsEnabled: false,
        forceSsl: false,
      },
    ]);

    expect(labels["traefik.http.routers.api-0-d1-http.rule"]).toBe(
      "Host(`example.com`) && PathPrefix(`/api`)"
    );
  });

  it("builds valid Traefik Swarm service spec", () => {
    const spec = buildTraefikServiceSpec("ops@example.com");
    expect(spec.Name).toBe("panel-traefik");
    expect(spec.TaskTemplate.ContainerSpec.Args).toContain("--providers.swarm=true");
    expect(spec.TaskTemplate.ContainerSpec.Args).toContain(
      "--certificatesresolvers.letsencrypt.acme.email=ops@example.com"
    );
  });
});

describe("Compose IaC export", () => {
  it("exports valid docker-compose YAML with volumes and networks", () => {
    const yamlStr = generateComposeExport("blog", "proj-blog", [
      {
        slug: "web",
        image: "ghost:5-alpine",
        env: { url: "https://blog.example.com" },
        mounts: [{ type: "volume", source: "blog-content", target: "/var/lib/ghost/content" }],
        domains: [
          {
            id: "d1",
            host: "blog.example.com",
            internalPort: 2368,
            pathPrefix: "/",
            httpsEnabled: true,
            forceSsl: true,
          },
        ],
        replicas: 1,
      },
    ]);

    expect(yamlStr).toContain("ghost:5-alpine");
    expect(yamlStr).toContain("blog-content:");
    expect(yamlStr).toContain("proj-blog:");
  });
});

describe("Docker stream header stripping", () => {
  it("preserves short plain-text logs under 8 bytes", () => {
    expect(stripDockerStreamHeaders(Buffer.from("OK\n"))).toBe("OK\n");
  });

  it("strips 8-byte multiplexed Docker stream frames", () => {
    const payload = Buffer.from("hello world\n");
    const header = Buffer.alloc(8);
    header[0] = 1; // stdout
    header.writeUInt32BE(payload.length, 4);
    const framed = Buffer.concat([header, payload]);
    expect(stripDockerStreamHeaders(framed)).toBe("hello world\n");
  });

  it("returns plain UTF-8 logs without Docker headers intact", () => {
    const plain = Buffer.from("Server listening on :3000\n");
    expect(stripDockerStreamHeaders(plain)).toBe("Server listening on :3000\n");
  });
});
