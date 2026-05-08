export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string | null;
}

export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}

export type LockConflictResponse = ApiError & {
  code: "LOCK_CONFLICT";
  details: {
    owner: { id: string; displayName: string | null };
    acquiredAt: number;
    expiresAt: number;
  };
};
