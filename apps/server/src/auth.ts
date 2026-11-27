import { createHash } from "node:crypto";
import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { eq, sessions, users, type PanelDb } from "@panelmanager/db";

export const SESSION_COOKIE_NAME = "panel_session";

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export function resolveSessionUser(db: PanelDb, token: string | undefined): AuthUser | null {
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const session = db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).get();
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    db.delete(sessions).where(eq(sessions.id, session.id)).run();
    return null;
  }
  const user = db.select().from(users).where(eq(users.id, session.userId)).get();
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}

export function extractRequestToken(c: Context): string | undefined {
  const authHeader = c.req.header("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  const cookieToken = getCookie(c, SESSION_COOKIE_NAME);
  if (cookieToken) return cookieToken;
  const queryToken = c.req.query("token");
  return queryToken || undefined;
}

export function createAuthMiddleware(db: PanelDb) {
  return async (c: Context, next: Next) => {
    const token = extractRequestToken(c);
    const user = resolveSessionUser(db, token);
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    c.set("user", user);
    await next();
  };
}
