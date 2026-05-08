-- Mgsl initial schema.
-- Wrangler applies this once per environment via `db:migrate:local|remote`.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE repos (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  default_branch TEXT NOT NULL DEFAULT 'main',
  created_at INTEGER NOT NULL
);

CREATE TABLE branches (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  name TEXT NOT NULL,
  head_commit_id TEXT,
  UNIQUE(repo_id, name)
);

CREATE TABLE commits (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  parent_id TEXT,
  author_id TEXT NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  manifest_r2_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  path TEXT NOT NULL,
  hash TEXT NOT NULL,
  size INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  UNIQUE(repo_id, hash)
);

CREATE TABLE locks (
  asset_path TEXT NOT NULL,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  acquired_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (repo_id, asset_path)
);

CREATE TABLE pull_requests (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  source_branch TEXT NOT NULL,
  target_branch TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  status TEXT NOT NULL CHECK (status IN ('open','merged','closed')),
  author_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_commits_repo ON commits(repo_id, created_at DESC);
CREATE INDEX idx_locks_repo ON locks(repo_id);
CREATE INDEX idx_assets_repo_path ON assets(repo_id, path);
CREATE INDEX idx_branches_repo ON branches(repo_id);
CREATE INDEX idx_prs_repo_status ON pull_requests(repo_id, status);
