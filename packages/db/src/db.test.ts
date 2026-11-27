import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  generatePassword,
  hashPassword,
  verifyPassword,
} from "./crypto.js";
import { createPanelDb } from "./migrate.js";
import { projects, services, users } from "./schema.js";

describe("crypto helpers", () => {
  const secret = "super-secret-panel-key-32-chars!!";

  it("encrypts and decrypts payloads accurately", () => {
    const plain = JSON.stringify({ DATABASE_URL: "postgres://user:pass@db:5432/app" });
    const encrypted = encryptSecret(plain, secret);
    expect(encrypted).not.toContain("postgres://");
    expect(decryptSecret(encrypted, secret)).toBe(plain);
  });

  it("fails decryption with wrong secret", () => {
    const encrypted = encryptSecret("hello", secret);
    expect(() => decryptSecret(encrypted, "wrong-secret-key-at-least-16")).toThrow();
  });

  it("hashes and verifies passwords", () => {
    const hash = hashPassword("MyS3curePass!");
    expect(verifyPassword("MyS3curePass!", hash)).toBe(true);
    expect(verifyPassword("wrong", hash)).toBe(false);
  });

  it("generates passwords of requested length", () => {
    expect(generatePassword(32)).toHaveLength(32);
  });
});

describe("sqlite bootstrap and CRUD", () => {
  it("initializes schema in memory and supports cascading inserts", async () => {
    const { db, client } = createPanelDb(":memory:");
    const now = Date.now();
    await db.insert(users).values({
      id: "u1",
      email: "admin@example.com",
      name: "Admin",
      passwordHash: hashPassword("secret"),
      role: "owner",
      createdAt: now,
    });
    await db.insert(projects).values({
      id: "p1",
      name: "Demo",
      slug: "demo",
      networkName: "proj-demo",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(services).values({
      id: "s1",
      projectId: "p1",
      name: "Web",
      slug: "web",
      kind: "app",
      sourceType: "image",
      webhookToken: "tok",
      createdAt: now,
      updatedAt: now,
    });

    const allServices = db.select().from(services).all();
    expect(allServices).toHaveLength(1);
    expect(allServices[0].slug).toBe("web");
    client.close();
  });
});
