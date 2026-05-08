import { Hono } from "hono";
import { AcquireLockRequest, ReleaseLockRequest } from "@mgsl/shared";
import type { AppContext } from "../env.js";
import { requireAuth } from "../middleware/auth.js";

export const lockRoutes = new Hono<AppContext>();

lockRoutes.use("*", requireAuth);

// Phase 1: D1-backed locks. Phase 3 will move arbitration to a Durable Object
// for race-free behavior; D1 still persists for durability across DO recycles.
lockRoutes.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = AcquireLockRequest.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid body", code: "BAD_REQUEST", details: parsed.error.flatten() },
      400,
    );
  }
  const { repoId, assetPath, ttlSeconds } = parsed.data;
  const ttl = ttlSeconds ?? Number(c.env.DEFAULT_LOCK_TTL_SECONDS) ?? 1800;
  const user = c.get("user");
  const now = Date.now();
  const expiresAt = now + ttl * 1000;

  const existing = await c.env.DB.prepare(
    `SELECT l.owner_id, l.acquired_at, l.expires_at, u.display_name
     FROM locks l JOIN users u ON u.id = l.owner_id
     WHERE l.repo_id = ? AND l.asset_path = ?`,
  )
    .bind(repoId, assetPath)
    .first<{
      owner_id: string;
      acquired_at: number;
      expires_at: number;
      display_name: string | null;
    }>();

  if (existing && existing.expires_at > now && existing.owner_id !== user.id) {
    return c.json(
      {
        error: "Asset is locked",
        code: "LOCK_CONFLICT",
        details: {
          owner: { id: existing.owner_id, displayName: existing.display_name },
          acquiredAt: existing.acquired_at,
          expiresAt: existing.expires_at,
        },
      },
      409,
    );
  }

  await c.env.DB.prepare(
    `INSERT INTO locks (repo_id, asset_path, owner_id, acquired_at, expires_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(repo_id, asset_path) DO UPDATE SET
       owner_id = excluded.owner_id,
       acquired_at = excluded.acquired_at,
       expires_at = excluded.expires_at`,
  )
    .bind(repoId, assetPath, user.id, now, expiresAt)
    .run();

  return c.json({
    lock: {
      repoId,
      assetPath,
      ownerId: user.id,
      ownerName: user.displayName,
      acquiredAt: now,
      expiresAt,
    },
  });
});

lockRoutes.delete("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = ReleaseLockRequest.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid body", code: "BAD_REQUEST", details: parsed.error.flatten() },
      400,
    );
  }
  const user = c.get("user");
  const { repoId, assetPath } = parsed.data;

  const result = await c.env.DB.prepare(
    "DELETE FROM locks WHERE repo_id = ? AND asset_path = ? AND owner_id = ?",
  )
    .bind(repoId, assetPath, user.id)
    .run();

  if (!result.meta.changes) {
    return c.json(
      { error: "No lock to release (or not owner)", code: "NOT_FOUND" },
      404,
    );
  }
  return c.json({ ok: true });
});

lockRoutes.get("/", async (c) => {
  const repoId = c.req.query("repoId");
  if (!repoId) {
    return c.json({ error: "repoId required", code: "BAD_REQUEST" }, 400);
  }
  const now = Date.now();
  const rows = await c.env.DB.prepare(
    `SELECT l.repo_id, l.asset_path, l.owner_id, l.acquired_at, l.expires_at,
            u.display_name as owner_name
     FROM locks l JOIN users u ON u.id = l.owner_id
     WHERE l.repo_id = ? AND l.expires_at > ?
     ORDER BY l.acquired_at DESC`,
  )
    .bind(repoId, now)
    .all<{
      repo_id: string;
      asset_path: string;
      owner_id: string;
      acquired_at: number;
      expires_at: number;
      owner_name: string | null;
    }>();

  return c.json({
    locks: rows.results.map((r) => ({
      repoId: r.repo_id,
      assetPath: r.asset_path,
      ownerId: r.owner_id,
      ownerName: r.owner_name,
      acquiredAt: r.acquired_at,
      expiresAt: r.expires_at,
    })),
  });
});
