import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { AppContext } from "./env.js";
import { authRoutes } from "./routes/auth.js";
import { assetRoutes } from "./routes/assets.js";
import { commitRoutes } from "./routes/commits.js";
import { lockRoutes } from "./routes/locks.js";
import { prRoutes } from "./routes/prs.js";
import { repoRoutes } from "./routes/repos.js";

const app = new Hono<AppContext>();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => origin,
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: false,
  }),
);

app.get("/health", (c) =>
  c.json({ ok: true, env: c.env.ENVIRONMENT, ts: Date.now() }),
);

app.route("/v1/auth", authRoutes);
app.route("/v1/repos", repoRoutes);
app.route("/v1/assets", assetRoutes);
app.route("/v1/commits", commitRoutes);
app.route("/v1/locks", lockRoutes);
app.route("/v1/prs", prRoutes);

app.onError((err, c) => {
  console.error("[worker] unhandled error", err);
  return c.json({ error: "internal error", code: "INTERNAL" }, 500);
});

app.notFound((c) =>
  c.json({ error: "not found", code: "NOT_FOUND" }, 404),
);

export default app;
