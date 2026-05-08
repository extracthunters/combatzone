// Builds presigned PUT URLs for R2 using AWS SigV4 (R2 is S3-compatible).
// We sign in the Worker with credentials from `wrangler secret put`.
// For Phase 1 we only need PUT presigning; GET can use the direct R2 binding via Worker proxy.

import type { Env } from "../env.js";

interface PresignArgs {
  env: Env;
  method: "PUT" | "GET";
  key: string;
  expiresInSeconds: number;
  contentType?: string;
}

const enc = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", k, enc.encode(msg));
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return bufToHex(buf);
}

function bufToHex(buf: ArrayBuffer): string {
  const v = new Uint8Array(buf);
  let s = "";
  for (const b of v) s += b.toString(16).padStart(2, "0");
  return s;
}

function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

export async function presignR2Url(args: PresignArgs): Promise<{
  url: string;
  headers: Record<string, string>;
  expiresAt: number;
}> {
  const {
    env,
    method,
    key,
    expiresInSeconds,
    contentType = "application/octet-stream",
  } = args;

  const accountId = env.R2_ACCOUNT_ID;
  const accessKey = env.R2_ACCESS_KEY_ID;
  const secretKey = env.R2_SECRET_ACCESS_KEY;
  const bucket = env.R2_PUBLIC_BUCKET;

  const host = `${accountId}.r2.cloudflarestorage.com`;
  const region = "auto";
  const service = "s3";

  const now = new Date();
  const amzDate =
    now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const canonicalUri = `/${rfc3986(bucket)}/${key
    .split("/")
    .map(rfc3986)
    .join("/")}`;

  const params: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${accessKey}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresInSeconds),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(params)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(params[k]!)}`)
    .join("&");

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = "host";
  const payloadHash = "UNSIGNED-PAYLOAD";

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = await hmac(enc.encode("AWS4" + secretKey), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  const sigBuf = await hmac(kSigning, stringToSign);
  const signature = bufToHex(sigBuf);

  const url = `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  const headers: Record<string, string> = {
    "Content-Type": contentType,
  };

  return {
    url,
    headers,
    expiresAt: Math.floor(now.getTime() / 1000) + expiresInSeconds,
  };
}

export function r2KeyForObject(repoId: string, sha256: string): string {
  return `${repoId}/objects/${sha256.slice(0, 2)}/${sha256.slice(2)}`;
}

export function r2KeyForManifest(repoId: string, commitId: string): string {
  return `${repoId}/manifests/${commitId}.json`;
}
