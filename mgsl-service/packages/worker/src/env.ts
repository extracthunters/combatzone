import type { AuthenticatedUser } from "@mgsl/shared";

export interface Env {
  DB: D1Database;
  ASSETS: R2Bucket;
  // LOCK_ROOMS: DurableObjectNamespace; // enabled in Phase 3

  ENVIRONMENT: string;
  TOKEN_TTL_SECONDS: string;
  DEFAULT_LOCK_TTL_SECONDS: string;

  JWT_SECRET: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_PUBLIC_BUCKET: string;
}

export interface AppVariables {
  user: AuthenticatedUser;
}

export type AppContext = {
  Bindings: Env;
  Variables: AppVariables;
};
