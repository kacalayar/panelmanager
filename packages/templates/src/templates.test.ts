import { describe, expect, it } from "vitest";
import { getTemplateById, TEMPLATE_CATALOG } from "./catalog.js";
import { instantiateTemplate } from "./schema.js";

describe("template catalog & parser", () => {
  it("contains core self-hosted templates", () => {
    expect(TEMPLATE_CATALOG.length).toBeGreaterThanOrEqual(8);
    expect(getTemplateById("n8n")).toBeDefined();
    expect(getTemplateById("wordpress")).toBeDefined();
  });

  it("shares named random passwords consistently across linked services", () => {
    const n8n = getTemplateById("n8n")!;
    const services = instantiateTemplate(n8n, "my-proj", {
      domain: "flow.example.com",
      timezone: "Asia/Jakarta",
    });

    expect(services).toHaveLength(2);
    const dbSvc = services[0];
    const appSvc = services[1];

    expect(dbSvc.env.POSTGRES_PASSWORD).toHaveLength(24);
    expect(appSvc.env.DB_POSTGRESDB_PASSWORD).toBe(dbSvc.env.POSTGRES_PASSWORD);
    expect(appSvc.env.N8N_ENCRYPTION_KEY).toHaveLength(32);
    expect(appSvc.domainHost).toBe("flow.example.com");
    expect(dbSvc.mounts[0].source).toBe("my-proj-n8n-pg");
  });

  it("throws when required domain field is missing", () => {
    const wp = getTemplateById("wordpress")!;
    expect(() => instantiateTemplate(wp, "blog", {})).toThrow(/Missing required/);
  });
});
