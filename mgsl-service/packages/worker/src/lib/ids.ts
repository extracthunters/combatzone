// Short URL-safe IDs for users/repos/commits/etc.
// Not cryptographic — just collision-resistant within the app.
const ALPHA = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function newId(prefix: string, length = 16): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let s = "";
  for (const b of bytes) s += ALPHA[b % ALPHA.length];
  return `${prefix}_${s}`;
}

export const ids = {
  user: () => newId("usr"),
  repo: () => newId("rep"),
  commit: () => newId("cmt", 24),
  branch: () => newId("brc"),
  asset: () => newId("ast"),
  pr: () => newId("pr", 12),
};
