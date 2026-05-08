import { Hono } from "hono";
import { CreatePullRequestRequest } from "@mgsl/shared";
import type { AppContext } from "../env.js";
import { requireAuth } from "../middleware/auth.js";
import { ids } from "../lib/ids.js";

export const prRoutes = new Hono<AppContext>();

prRoutes.use("*", requireAuth);

prRoutes.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CreatePullRequestRequest.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid body", code: "BAD_REQUEST", details: parsed.error.flatten() },
      400,
    );
  }
  const { repoId, sourceBranch, targetBranch, title, body: prBody } = parsed.data;
  if (sourceBranch === targetBranch) {
    return c.json(
      { error: "source and target branches must differ", code: "BAD_REQUEST" },
      400,
    );
  }
  const user = c.get("user");
  const id = ids.pr();
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO pull_requests
       (id, repo_id, source_branch, target_branch, title, body, status, author_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
  )
    .bind(id, repoId, sourceBranch, targetBranch, title, prBody ?? null, user.id, now)
    .run();
  return c.json({
    pullRequest: {
      id,
      repoId,
      sourceBranch,
      targetBranch,
      title,
      body: prBody ?? null,
      status: "open",
      authorId: user.id,
      createdAt: now,
    },
  });
});

prRoutes.get("/", async (c) => {
  const repoId = c.req.query("repoId");
  if (!repoId) {
    return c.json({ error: "repoId required", code: "BAD_REQUEST" }, 400);
  }
  const status = c.req.query("status") ?? "open";
  const rows = await c.env.DB.prepare(
    `SELECT id, repo_id, source_branch, target_branch, title, body, status, author_id, created_at
     FROM pull_requests WHERE repo_id = ? AND status = ? ORDER BY created_at DESC LIMIT 200`,
  )
    .bind(repoId, status)
    .all<{
      id: string;
      repo_id: string;
      source_branch: string;
      target_branch: string;
      title: string;
      body: string | null;
      status: "open" | "merged" | "closed";
      author_id: string;
      created_at: number;
    }>();
  return c.json({
    pullRequests: rows.results.map((r) => ({
      id: r.id,
      repoId: r.repo_id,
      sourceBranch: r.source_branch,
      targetBranch: r.target_branch,
      title: r.title,
      body: r.body,
      status: r.status,
      authorId: r.author_id,
      createdAt: r.created_at,
    })),
  });
});

// Merge: only fast-forward — set target.head = source.head if target is ancestor.
prRoutes.post("/:id/merge", async (c) => {
  const id = c.req.param("id");
  const pr = await c.env.DB.prepare(
    `SELECT id, repo_id, source_branch, target_branch, status FROM pull_requests WHERE id = ?`,
  )
    .bind(id)
    .first<{
      id: string;
      repo_id: string;
      source_branch: string;
      target_branch: string;
      status: string;
    }>();
  if (!pr) return c.json({ error: "PR not found", code: "NOT_FOUND" }, 404);
  if (pr.status !== "open") {
    return c.json({ error: "PR not open", code: "BAD_STATE" }, 409);
  }

  const source = await c.env.DB.prepare(
    "SELECT head_commit_id FROM branches WHERE repo_id = ? AND name = ?",
  )
    .bind(pr.repo_id, pr.source_branch)
    .first<{ head_commit_id: string | null }>();
  const target = await c.env.DB.prepare(
    "SELECT id, head_commit_id FROM branches WHERE repo_id = ? AND name = ?",
  )
    .bind(pr.repo_id, pr.target_branch)
    .first<{ id: string; head_commit_id: string | null }>();

  if (!source?.head_commit_id) {
    return c.json({ error: "Source branch empty", code: "BAD_STATE" }, 409);
  }
  if (!target) {
    return c.json({ error: "Target branch missing", code: "NOT_FOUND" }, 404);
  }

  // Fast-forward check: target.head_commit_id must be an ancestor of source.head_commit_id.
  if (target.head_commit_id) {
    const isAncestor = await commitIsAncestor(
      c.env.DB,
      target.head_commit_id,
      source.head_commit_id,
    );
    if (!isAncestor) {
      return c.json(
        {
          error: "Non-fast-forward merge not supported",
          code: "NON_FAST_FORWARD",
        },
        409,
      );
    }
  }

  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE branches SET head_commit_id = ? WHERE id = ?").bind(
      source.head_commit_id,
      target.id,
    ),
    c.env.DB.prepare("UPDATE pull_requests SET status = 'merged' WHERE id = ?").bind(id),
  ]);

  return c.json({ ok: true, mergedHead: source.head_commit_id });
});

async function commitIsAncestor(
  db: D1Database,
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  // Walk parents from descendant; bounded to 1000 hops to avoid runaway cost.
  let cur: string | null = descendant;
  for (let i = 0; i < 1000 && cur; i++) {
    if (cur === ancestor) return true;
    const row = await db
      .prepare("SELECT parent_id FROM commits WHERE id = ?")
      .bind(cur)
      .first<{ parent_id: string | null }>();
    cur = row?.parent_id ?? null;
  }
  return false;
}
