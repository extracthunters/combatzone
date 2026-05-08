import { Hono } from "hono";
import { CreateCommitRequest } from "@mgsl/shared";
import type { AppContext } from "../env.js";
import { requireAuth } from "../middleware/auth.js";
import { ids } from "../lib/ids.js";
import { r2KeyForManifest } from "../lib/r2.js";

export const commitRoutes = new Hono<AppContext>();

commitRoutes.use("*", requireAuth);

commitRoutes.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CreateCommitRequest.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid body", code: "BAD_REQUEST", details: parsed.error.flatten() },
      400,
    );
  }
  const { repoId, branch, parentCommitId, message, entries } = parsed.data;
  const user = c.get("user");

  const repo = await c.env.DB.prepare("SELECT id FROM repos WHERE id = ?")
    .bind(repoId)
    .first();
  if (!repo) {
    return c.json({ error: "Repo not found", code: "NOT_FOUND" }, 404);
  }

  // Branch lookup / creation handled lazily — create row if missing.
  const branchRow = await c.env.DB.prepare(
    "SELECT id, head_commit_id FROM branches WHERE repo_id = ? AND name = ?",
  )
    .bind(repoId, branch)
    .first<{ id: string; head_commit_id: string | null }>();

  if (branchRow && parentCommitId !== branchRow.head_commit_id) {
    return c.json(
      {
        error: "Branch moved (non-fast-forward). Pull and retry.",
        code: "STALE_PARENT",
        details: { expectedParent: branchRow.head_commit_id },
      },
      409,
    );
  }

  // Verify all blobs already exist in R2 (client uploaded via presigned URLs).
  const missing: string[] = [];
  for (const e of entries) {
    if (e.op === "delete") continue;
    const obj = await c.env.ASSETS.head(
      `${repoId}/objects/${e.hash.slice(0, 2)}/${e.hash.slice(2)}`,
    );
    if (!obj) missing.push(e.path);
  }
  if (missing.length > 0) {
    return c.json(
      { error: "Some blobs not uploaded", code: "MISSING_BLOBS", details: { paths: missing } },
      400,
    );
  }

  const commitId = ids.commit();
  const now = Date.now();
  const manifestKey = r2KeyForManifest(repoId, commitId);

  // Build manifest as full directory state at this commit.
  // For Phase 1 we store only the entries from this commit; a future task computes
  // full tree by walking parents. (TODO: snapshot full tree.)
  const manifestPayload = JSON.stringify({
    commitId,
    repoId,
    parentId: parentCommitId,
    entries: entries.filter((e) => e.op !== "delete"),
    deletes: entries.filter((e) => e.op === "delete").map((e) => e.path),
  });
  await c.env.ASSETS.put(manifestKey, manifestPayload, {
    httpMetadata: { contentType: "application/json" },
  });

  const stmts: D1PreparedStatement[] = [];
  stmts.push(
    c.env.DB.prepare(
      `INSERT INTO commits (id, repo_id, parent_id, author_id, message, manifest_r2_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(commitId, repoId, parentCommitId, user.id, message, manifestKey, now),
  );
  for (const e of entries) {
    if (e.op === "delete") continue;
    stmts.push(
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO assets (id, repo_id, path, hash, size, r2_key)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        ids.asset(),
        repoId,
        e.path,
        e.hash,
        e.size,
        `${repoId}/objects/${e.hash.slice(0, 2)}/${e.hash.slice(2)}`,
      ),
    );
  }
  if (branchRow) {
    stmts.push(
      c.env.DB.prepare(
        "UPDATE branches SET head_commit_id = ? WHERE id = ?",
      ).bind(commitId, branchRow.id),
    );
  } else {
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO branches (id, repo_id, name, head_commit_id) VALUES (?, ?, ?, ?)",
      ).bind(ids.branch(), repoId, branch, commitId),
    );
  }
  await c.env.DB.batch(stmts);

  return c.json({
    commit: {
      id: commitId,
      repoId,
      parentId: parentCommitId,
      authorId: user.id,
      message,
      manifestR2Key: manifestKey,
      createdAt: now,
    },
  });
});

commitRoutes.get("/", async (c) => {
  const repoId = c.req.query("repoId");
  if (!repoId) {
    return c.json({ error: "repoId required", code: "BAD_REQUEST" }, 400);
  }
  const limit = Math.min(Number(c.req.query("limit") ?? "50") || 50, 200);
  const rows = await c.env.DB.prepare(
    `SELECT id, repo_id, parent_id, author_id, message, manifest_r2_key, created_at
     FROM commits WHERE repo_id = ? ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(repoId, limit)
    .all<{
      id: string;
      repo_id: string;
      parent_id: string | null;
      author_id: string;
      message: string;
      manifest_r2_key: string;
      created_at: number;
    }>();

  return c.json({
    commits: rows.results.map((r) => ({
      id: r.id,
      repoId: r.repo_id,
      parentId: r.parent_id,
      authorId: r.author_id,
      message: r.message,
      manifestR2Key: r.manifest_r2_key,
      createdAt: r.created_at,
    })),
  });
});
