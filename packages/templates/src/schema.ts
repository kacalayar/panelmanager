import { randomBytes } from "node:crypto";
import { generatePassword } from "@panelmanager/db";

export interface TemplateField {
  key: string;
  label: string;
  type: "text" | "domain" | "password" | "email";
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
}

export interface TemplateServiceDef {
  slug: string;
  name: string;
  kind: "app" | "postgres" | "mysql" | "mariadb" | "mongo" | "redis";
  image: string;
  internalPort?: number;
  exposeDomainFromField?: string;
  env: Record<string, string>;
  mounts: Array<{
    type: "volume";
    source: string;
    target: string;
  }>;
  cmd?: string[];
}

export interface AppTemplate {
  id: string;
  name: string;
  category: "Automation" | "CMS" | "Backend" | "Monitoring" | "Storage" | "Analytics" | "Tools";
  description: string;
  logoText: string;
  fields: TemplateField[];
  services: TemplateServiceDef[];
}

export interface InstantiatedService {
  slug: string;
  name: string;
  kind: TemplateServiceDef["kind"];
  image: string;
  internalPort: number;
  domainHost?: string;
  env: Record<string, string>;
  mounts: Array<{ type: "volume"; source: string; target: string }>;
  cmd?: string[];
}

export function resolveTemplateString(
  raw: string,
  vars: Record<string, string>,
  secretsCache: Map<string, string>
): string {
  return raw.replace(/\{\{([^}]+)\}\}/g, (_match, expr: string) => {
    const trimmed = expr.trim();

    if (trimmed === "randomPassword") {
      return generatePassword(24);
    }

    if (trimmed.startsWith("randomPassword:")) {
      const cacheKey = trimmed;
      if (!secretsCache.has(cacheKey)) {
        secretsCache.set(cacheKey, generatePassword(24));
      }
      return secretsCache.get(cacheKey)!;
    }

    if (trimmed.startsWith("randomHex:")) {
      const parts = trimmed.split(":");
      const len = Math.max(8, Math.min(128, Number(parts[1] || 32)));
      return randomBytes(Math.ceil(len / 2))
        .toString("hex")
        .slice(0, len);
    }

    return vars[trimmed] ?? "";
  });
}

export function instantiateTemplate(
  template: AppTemplate,
  projectSlug: string,
  inputs: Record<string, string>
): InstantiatedService[] {
  const vars: Record<string, string> = {
    projectSlug,
    ...inputs,
  };
  for (const field of template.fields) {
    if (!(field.key in vars) && field.defaultValue !== undefined) {
      vars[field.key] = field.defaultValue;
    }
    if (field.required && !vars[field.key]) {
      throw new Error(`Missing required template field: ${field.label}`);
    }
  }

  const secretsCache = new Map<string, string>();

  return template.services.map((svc) => {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(svc.env)) {
      env[k] = resolveTemplateString(v, vars, secretsCache);
    }

    const mounts = svc.mounts.map((m) => ({
      type: m.type,
      source: resolveTemplateString(m.source, vars, secretsCache),
      target: m.target,
    }));

    const domainHost = svc.exposeDomainFromField
      ? vars[svc.exposeDomainFromField]?.trim() || undefined
      : undefined;

    return {
      slug: svc.slug,
      name: svc.name,
      kind: svc.kind,
      image: svc.image,
      internalPort: svc.internalPort || 80,
      domainHost,
      env,
      mounts,
      cmd: svc.cmd,
    };
  });
}
