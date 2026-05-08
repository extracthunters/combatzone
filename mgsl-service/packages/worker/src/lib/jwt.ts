import jwt from "@tsndr/cloudflare-worker-jwt";
import type { AuthenticatedUser } from "@mgsl/shared";

interface MgslJwtPayload {
  sub: string;
  email: string;
  name: string | null;
  iat: number;
  exp: number;
}

export async function signUserToken(
  secret: string,
  user: AuthenticatedUser,
  ttlSeconds: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: MgslJwtPayload = {
    sub: user.id,
    email: user.email,
    name: user.displayName,
    iat: now,
    exp: now + ttlSeconds,
  };
  return jwt.sign(payload, secret);
}

export async function verifyUserToken(
  secret: string,
  token: string,
): Promise<AuthenticatedUser | null> {
  try {
    const ok = await jwt.verify(token, secret);
    if (!ok) return null;
    const decoded = jwt.decode<MgslJwtPayload>(token);
    const p = decoded?.payload;
    if (!p?.sub || !p.email) return null;
    return { id: p.sub, email: p.email, displayName: p.name ?? null };
  } catch {
    return null;
  }
}
