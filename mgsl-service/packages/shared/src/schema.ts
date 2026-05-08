import { z } from "zod";

export const LoginRequest = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(256),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const LoginResponse = z.object({
  token: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string(),
    displayName: z.string().nullable(),
  }),
});
export type LoginResponse = z.infer<typeof LoginResponse>;

const AssetPath = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^[A-Za-z0-9_./-]+$/, "asset path: alnum, _, ., /, - only");

const Sha256Hex = z
  .string()
  .length(64)
  .regex(/^[a-f0-9]+$/, "sha256 must be lowercase hex");

export const UploadUrlRequest = z.object({
  repoId: z.string().min(1),
  path: AssetPath,
  hash: Sha256Hex,
  size: z.number().int().positive().max(1024 * 1024 * 1024), // 1 GiB hard cap
});
export type UploadUrlRequest = z.infer<typeof UploadUrlRequest>;

export const UploadUrlResponse = z.object({
  uploadUrl: z.string().url(),
  r2Key: z.string(),
  // Headers the client MUST send when PUTting the blob to R2.
  headers: z.record(z.string()),
  expiresAt: z.number().int(),
});
export type UploadUrlResponse = z.infer<typeof UploadUrlResponse>;

export const CommitEntry = z.object({
  path: AssetPath,
  hash: Sha256Hex,
  size: z.number().int().nonnegative(),
  op: z.enum(["add", "modify", "delete"]),
});
export type CommitEntry = z.infer<typeof CommitEntry>;

export const CreateCommitRequest = z.object({
  repoId: z.string().min(1),
  branch: z.string().min(1).max(128),
  parentCommitId: z.string().nullable(),
  message: z.string().min(1).max(2048),
  entries: z.array(CommitEntry).min(1).max(10_000),
});
export type CreateCommitRequest = z.infer<typeof CreateCommitRequest>;

export const Commit = z.object({
  id: z.string(),
  repoId: z.string(),
  parentId: z.string().nullable(),
  authorId: z.string(),
  message: z.string(),
  manifestR2Key: z.string(),
  createdAt: z.number().int(),
});
export type Commit = z.infer<typeof Commit>;

export const Lock = z.object({
  repoId: z.string(),
  assetPath: z.string(),
  ownerId: z.string(),
  ownerName: z.string().nullable(),
  acquiredAt: z.number().int(),
  expiresAt: z.number().int(),
});
export type Lock = z.infer<typeof Lock>;

export const AcquireLockRequest = z.object({
  repoId: z.string().min(1),
  assetPath: AssetPath,
  // Default TTL of 30min, configurable per-call.
  ttlSeconds: z.number().int().positive().max(60 * 60 * 4).optional(),
});
export type AcquireLockRequest = z.infer<typeof AcquireLockRequest>;

export const ReleaseLockRequest = z.object({
  repoId: z.string().min(1),
  assetPath: AssetPath,
});
export type ReleaseLockRequest = z.infer<typeof ReleaseLockRequest>;

export const CreatePullRequestRequest = z.object({
  repoId: z.string().min(1),
  sourceBranch: z.string().min(1).max(128),
  targetBranch: z.string().min(1).max(128),
  title: z.string().min(1).max(256),
  body: z.string().max(8192).optional(),
});
export type CreatePullRequestRequest = z.infer<typeof CreatePullRequestRequest>;

export const PullRequest = z.object({
  id: z.string(),
  repoId: z.string(),
  sourceBranch: z.string(),
  targetBranch: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  status: z.enum(["open", "merged", "closed"]),
  authorId: z.string(),
  createdAt: z.number().int(),
});
export type PullRequest = z.infer<typeof PullRequest>;

export const Manifest = z.object({
  commitId: z.string(),
  repoId: z.string(),
  entries: z.array(
    z.object({
      path: AssetPath,
      hash: Sha256Hex,
      size: z.number().int().nonnegative(),
    }),
  ),
});
export type Manifest = z.infer<typeof Manifest>;
