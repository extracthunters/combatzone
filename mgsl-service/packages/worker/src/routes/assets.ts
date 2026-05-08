import { Hono } from "hono";
import { UploadUrlRequest } from "@mgsl/shared";
import type { AppContext } from "../env.js";
import { requireAuth } from "../middleware/auth.js";
import { presignR2Url, r2KeyForObject } from "../lib/r2.js";

export const assetRoutes = new Hono<AppContext>();

assetRoutes.use("*", requireAuth);

assetRoutes.post("/upload-url", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = UploadUrlRequest.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid body", code: "BAD_REQUEST", details: parsed.error.flatten() },
      400,
    );
  }
  const { repoId, hash, size } = parsed.data;

  const repo = await c.env.DB.prepare("SELECT id FROM repos WHERE id = ?")
    .bind(repoId)
    .first();
  if (!repo) {
    return c.json({ error: "Repo not found", code: "NOT_FOUND" }, 404);
  }

  const key = r2KeyForObject(repoId, hash);

  // Skip upload if blob already exists (content-addressed dedupe).
  const existing = await c.env.ASSETS.head(key);
  if (existing && existing.size === size) {
    return c.json({
      uploadUrl: null,
      r2Key: key,
      headers: {},
      expiresAt: 0,
      alreadyExists: true,
    });
  }

  const presigned = await presignR2Url({
    env: c.env,
    method: "PUT",
    key,
    expiresInSeconds: 600,
  });
  return c.json({
    uploadUrl: presigned.url,
    r2Key: key,
    headers: presigned.headers,
    expiresAt: presigned.expiresAt,
    alreadyExists: false,
  });
});

// Worker-proxied download (avoids needing R2 GET presigning + handles auth).
assetRoutes.get("/blob/:repoId/:hash", async (c) => {
  const { repoId, hash } = c.req.param();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    return c.json({ error: "Bad hash", code: "BAD_REQUEST" }, 400);
  }
  const obj = await c.env.ASSETS.get(r2KeyForObject(repoId, hash));
  if (!obj) {
    return c.json({ error: "Blob missing", code: "NOT_FOUND" }, 404);
  }
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "content-length": String(obj.size),
      "cache-control": "public, max-age=31536000, immutable",
      etag: obj.httpEtag,
    },
  });
});
