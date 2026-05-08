import { Hono } from "hono";
import { z } from "zod";
import { LoginRequest } from "@mgsl/shared";
import type { AppContext } from "../env.js";
import { signUserToken } from "../lib/jwt.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { ids } from "../lib/ids.js";

export const authRoutes = new Hono<AppContext>();

const RegisterRequest = LoginRequest.extend({
  displayName: z.string().min(1).max(64).optional(),
  // Bootstrap token: when no users exist yet, anyone can register.
  // Once users exist, registration is closed (admin invites added later).
});

authRoutes.post("/register", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = RegisterRequest.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid body", code: "BAD_REQUEST", details: parsed.error.flatten() },
      400,
    );
  }

  const userCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as n FROM users",
  ).first<{ n: number }>();
  if ((userCount?.n ?? 0) > 0) {
    return c.json(
      { error: "Registration closed", code: "REGISTRATION_CLOSED" },
      403,
    );
  }

  const { email, password, displayName } = parsed.data;
  const id = ids.user();
  const now = Date.now();
  const hash = await hashPassword(password);

  try {
    await c.env.DB.prepare(
      "INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(id, email.toLowerCase(), hash, displayName ?? null, now)
      .run();
  } catch (e) {
    return c.json(
      { error: "Email already taken", code: "CONFLICT" },
      409,
    );
  }

  const ttl = Number(c.env.TOKEN_TTL_SECONDS) || 86400;
  const token = await signUserToken(
    c.env.JWT_SECRET,
    { id, email, displayName: displayName ?? null },
    ttl,
  );
  return c.json({
    token,
    user: { id, email, displayName: displayName ?? null },
  });
});

authRoutes.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = LoginRequest.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid body", code: "BAD_REQUEST", details: parsed.error.flatten() },
      400,
    );
  }
  const { email, password } = parsed.data;
  const row = await c.env.DB.prepare(
    "SELECT id, email, password_hash, display_name FROM users WHERE email = ?",
  )
    .bind(email.toLowerCase())
    .first<{
      id: string;
      email: string;
      password_hash: string;
      display_name: string | null;
    }>();

  if (!row) {
    // Same response shape on missing user vs. bad password to avoid enumeration.
    return c.json({ error: "Invalid credentials", code: "UNAUTHENTICATED" }, 401);
  }
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) {
    return c.json({ error: "Invalid credentials", code: "UNAUTHENTICATED" }, 401);
  }

  const ttl = Number(c.env.TOKEN_TTL_SECONDS) || 86400;
  const token = await signUserToken(
    c.env.JWT_SECRET,
    { id: row.id, email: row.email, displayName: row.display_name },
    ttl,
  );
  return c.json({
    token,
    user: { id: row.id, email: row.email, displayName: row.display_name },
  });
});
