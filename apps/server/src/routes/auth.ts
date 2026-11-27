import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import {
  eq,
  generateId,
  generateToken,
  hashPassword,
  sessions,
  users,
  verifyPassword,
} from "@panelmanager/db";
import {
  extractRequestToken,
  hashSessionToken,
  resolveSessionUser,
  SESSION_COOKIE_NAME,
} from "../auth.js";
import type { AppContext } from "../context.js";

const setupSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export function createAuthRoutes(ctx: AppContext) {
  const router = new Hono();

  router.get("/status", (c) => {
    const existing = ctx.db.select({ id: users.id }).from(users).limit(1).all();
    const token = extractRequestToken(c);
    const currentUser = resolveSessionUser(ctx.db, token);
    return c.json({
      initialized: existing.length > 0,
      user: currentUser,
    });
  });

  router.post("/setup", async (c) => {
    const body = await c.req.json();
    const parsed = setupSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    // Check and insert synchronously with no awaits in between to avoid setup races.
    const existing = ctx.db.select({ id: users.id }).from(users).limit(1).all();
    if (existing.length > 0) {
      return c.json({ error: "Panel already initialized" }, 400);
    }

    const now = Date.now();
    const userId = generateId();
    ctx.db
      .insert(users)
      .values({
        id: userId,
        email: parsed.data.email.toLowerCase(),
        name: parsed.data.name,
        passwordHash: hashPassword(parsed.data.password),
        role: "owner",
        createdAt: now,
      })
      .run();

    const rawToken = generateToken(32);
    const expiresAt = now + 1000 * 60 * 60 * 24 * 7;
    ctx.db
      .insert(sessions)
      .values({
        id: generateId(),
        userId,
        tokenHash: hashSessionToken(rawToken),
        expiresAt,
        createdAt: now,
      })
      .run();

    setCookie(c, SESSION_COOKIE_NAME, rawToken, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return c.json({
      token: rawToken,
      user: {
        id: userId,
        email: parsed.data.email.toLowerCase(),
        name: parsed.data.name,
        role: "owner",
      },
    });
  });

  router.post("/login", async (c) => {
    const body = await c.req.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid credentials" }, 400);
    }

    const user = ctx.db
      .select()
      .from(users)
      .where(eq(users.email, parsed.data.email.toLowerCase()))
      .get();

    if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
      return c.json({ error: "Invalid email or password" }, 401);
    }

    const now = Date.now();
    const rawToken = generateToken(32);
    const expiresAt = now + 1000 * 60 * 60 * 24 * 7;
    ctx.db
      .insert(sessions)
      .values({
        id: generateId(),
        userId: user.id,
        tokenHash: hashSessionToken(rawToken),
        expiresAt,
        createdAt: now,
      })
      .run();

    setCookie(c, SESSION_COOKIE_NAME, rawToken, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return c.json({
      token: rawToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  });

  router.post("/logout", (c) => {
    const token = extractRequestToken(c);
    if (token) {
      ctx.db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token))).run();
    }
    deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
    return c.json({ ok: true });
  });

  return router;
}
