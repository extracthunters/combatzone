import type { MiddlewareHandler } from "hono";
import type { AppContext } from "../env.js";
import { verifyUserToken } from "../lib/jwt.js";

export const requireAuth: MiddlewareHandler<AppContext> = async (c, next) => {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json(
      { error: "Missing bearer token", code: "UNAUTHENTICATED" },
      401,
    );
  }
  const token = header.slice("Bearer ".length).trim();
  const user = await verifyUserToken(c.env.JWT_SECRET, token);
  if (!user) {
    return c.json(
      { error: "Invalid or expired token", code: "UNAUTHENTICATED" },
      401,
    );
  }
  c.set("user", user);
  await next();
};
