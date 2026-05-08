import { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../env.js";
import { requireAuth } from "../middleware/auth.js";
import { ids } from "../lib/ids.js";

export const repoRoutes = new Hono<AppContext>();

repoRoutes.use("*", requireAuth);

const CreateRepoRequest = z.object({
  name: z.string().min(1).max(128).regex(/^[A-Za-z0-9_.-]+$/),
  defaultBranch: z.string().min(1).max(128).default("main"),
});

repoRoutes.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CreateRepoRequest.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid body", code: "BAD_REQUEST", details: parsed.error.flatten() },
      400,
    );
  }
  const user = c.get("user");
  const id = ids.repo();
  const now = Date.now();
  await c.env.DB.prepare(
    "INSERT INTO repos (id, name, owner_id, default_branch, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(id, parsed.data.name, user.id, parsed.data.defaultBranch, now)
    .run();
  return c.json({
    repo: {
      id,
      name: parsed.data.name,
      ownerId: user.id,
      defaultBranch: parsed.data.defaultBranch,
      createdAt: now,
    },
  });
});

repoRoutes.get("/", async (c) => {
  const user = c.get("user");
  const rows = await c.env.DB.prepare(
    "SELECT id, name, owner_id, default_branch, created_at FROM repos WHERE owner_id = ? ORDER BY created_at DESC",
  )
    .bind(user.id)
    .all<{
      id: string;
      name: string;
      owner_id: string;
      default_branch: string;
      created_at: number;
    }>();
  return c.json({
    repos: rows.results.map((r) => ({
      id: r.id,
      name: r.name,
      ownerId: r.owner_id,
      defaultBranch: r.default_branch,
      createdAt: r.created_at,
    })),
  });
});

repoRoutes.get("/:id/manifest", async (c) => {
  const repoId = c.req.param("id");
  const branch = c.req.query("branch") ?? "main";
  const row = await c.env.DB.prepare(
    `SELECT b.head_commit_id, c.manifest_r2_key
     FROM branches b LEFT JOIN commits c ON c.id = b.head_commit_id
     WHERE b.repo_id = ? AND b.name = ?`,
  )
    .bind(repoId, branch)
    .first<{ head_commit_id: string | null; manifest_r2_key: string | null }>();
  if (!row?.head_commit_id || !row.manifest_r2_key) {
    return c.json({ commitId: null, repoId, entries: [] });
  }
  const obj = await c.env.ASSETS.get(row.manifest_r2_key);
  if (!obj) {
    return c.json({ error: "Manifest blob missing", code: "NOT_FOUND" }, 404);
  }
  return new Response(obj.body, {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-cache",
    },
  });
});
