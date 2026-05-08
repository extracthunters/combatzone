# mgsl-service

Backend (Cloudflare Worker + D1 + R2) and web dashboard for the **Mgsl** Unreal plugin.

> ⚠️ Phase 1 only. Web dashboard and Durable Object lock arbiter come in later phases — see `C:\Users\User\.claude\plans\vamos-criar-um-novo-purring-grove.md`.

## Layout

```
packages/
  shared/   TS types + zod schemas (used by worker and web)
  worker/   Cloudflare Worker — Hono REST API, D1, R2
  web/      Vite + React dashboard (Phase 4 — not yet implemented)
```

## Prerequisites

- Node.js 20+
- pnpm 9+
- A Cloudflare account with Workers + D1 + R2 enabled
- `wrangler` CLI authenticated (`wrangler login`)

## First-time setup

```bash
cd mgsl-service
pnpm install

# Create the D1 database (records ID in dashboard output)
cd packages/worker
wrangler d1 create mgsl
# → paste the database_id into wrangler.toml

# Create the R2 bucket
wrangler r2 bucket create mgsl-assets

# Local dev secrets — copy and edit
cp .dev.vars.example .dev.vars
# fill JWT_SECRET, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
# Generate JWT_SECRET with: openssl rand -base64 48

# Apply migrations to LOCAL D1
pnpm db:migrate:local
```

## Run

```bash
# from mgsl-service/
pnpm dev:worker       # http://localhost:8787

# Health check
curl http://localhost:8787/health
```

## Deploy to Cloudflare

```bash
cd packages/worker
wrangler secret put JWT_SECRET
wrangler secret put R2_ACCOUNT_ID
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
pnpm db:migrate:remote
wrangler deploy
```

## API smoke test (Phase 1)

```bash
# Bootstrap first user (only works while users table is empty)
curl -X POST http://localhost:8787/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"correct horse battery staple","displayName":"You"}'

# Save the token from the response, then:
TOKEN="..."

# Create a repo
curl -X POST http://localhost:8787/v1/repos \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"combatzone"}'

# Acquire a lock
curl -X POST http://localhost:8787/v1/locks \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"repoId":"rep_...","assetPath":"Content/BP_Player.uasset"}'

# List active locks
curl "http://localhost:8787/v1/locks?repoId=rep_..." -H "authorization: Bearer $TOKEN"
```

## Security notes

- **Never commit `.dev.vars`** (it's gitignored). Production secrets go via `wrangler secret put`, never in `wrangler.toml`.
- The Cloudflare API token shared in chat must be **revoked and regenerated**.
- `JWT_SECRET` must be ≥ 32 random bytes. Rotate it periodically (forces re-login).
- Phase 1 lock arbitration uses D1 only — there's a TOCTOU window between SELECT and INSERT under high concurrency. Phase 3 fixes this with a Durable Object `LockRoom`.

## Endpoint summary

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | — | liveness |
| POST | `/v1/auth/register` | — | bootstrap first user |
| POST | `/v1/auth/login` | — | get JWT |
| GET | `/v1/repos` | yes | list user's repos |
| POST | `/v1/repos` | yes | create repo |
| GET | `/v1/repos/:id/manifest` | yes | tree at branch HEAD |
| POST | `/v1/assets/upload-url` | yes | presigned R2 PUT |
| GET | `/v1/assets/blob/:repoId/:hash` | yes | proxy GET blob |
| POST | `/v1/commits` | yes | create commit (FF only) |
| GET | `/v1/commits?repoId=` | yes | list commits |
| POST | `/v1/locks` | yes | acquire lock |
| DELETE | `/v1/locks` | yes | release own lock |
| GET | `/v1/locks?repoId=` | yes | list active locks |
| POST | `/v1/prs` | yes | open PR |
| GET | `/v1/prs?repoId=` | yes | list PRs |
| POST | `/v1/prs/:id/merge` | yes | merge PR (FF only) |

## Roadmap

- **Phase 2**: Unreal C++ plugin (`Plugins/Mgsl/`) talks to this worker.
- **Phase 3**: Add Durable Object `LockRoom` for race-free locks + WebSocket presence.
- **Phase 4**: `packages/web/` Vite dashboard for PR review.
- **Phase 5**: GitHub OAuth, takeover with approval, full-tree manifest snapshot.
