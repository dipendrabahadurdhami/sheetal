# Sheetal Property backends

Node.js 22+ · TypeScript (strict) · Fastify 5 · PostgreSQL (Prisma 6) · Redis (cache) · Zod.
Each app has its own backend, its own server and its own port. All three use **one database**, so a listing posted
in /business shows on the website right away and admin can review it.

| Folder | Package | Port | Serves |
|---|---|---|---|
| `website/backend` | `@sheetal/website-api` | 4000 | Public site: accounts and login, properties, search, map, agencies |
| `business/backend` | `@sheetal/business-api` | 4001 | Business panel (/business) |
| `admin/backend` | `@sheetal/admin-api` | 4002 | Admin panel (/admin) |
| `backend-core` | `@sheetal/backend-core` | — | Shared by the three: database schema and migrations, errors, cache, login sessions, health, plans and permissions |

Plan: `../docs/backend-plan.md`; old-site rules to keep: `../docs/old-backend-audit.md`.

## Run locally (no Docker or system PostgreSQL needed)
```bash
cp backend-core/.env.example backend-core/.env   # once; shared settings such as DATABASE_URL
npm run db:local                                  # terminal 1: private PostgreSQL on port 5433 (keep open)
npm run db:migrate                                # once, and after schema changes
npm run db:seed                                   # plans, super admin, Sheetal Property (safe to re-run)
npm run dev:api                                   # terminal 2: all three APIs (or dev:api:website / :business / :admin)
```
Check: `http://localhost:4000/health` → `{"status":"ok","service":"website", …}` (4001 business, 4002 admin).
An app can have its own `.env` in its backend folder; it is read first, then `backend-core/.env`.

To send website requests to the API, copy `website/frontend/.env.example` to `.env.local` and list the built paths in `VITE_API_LIVE` (or `*`). Everything else keeps using demo data.

## Layout
```
backend-core/
  src/app.ts         buildBaseApp: logging, request ids, security headers, CORS, rate limits, error handler, sessions, /health
  src/config.ts      every environment setting, validated at start-up; loadEnvFiles()
  src/lib/           errors (one format: { message, code, errors?, requestId }), cache, db, bots, status, secrets, mailer
  src/domain/        plans and permissions (tests keep them equal to the screens' copies)
  src/modules/       auth sessions and accounts used by every app
  prisma/            the one schema, migrations and seed.ts
  test/setup-db.ts   throwaway PostgreSQL for each test run
<app>/backend/
  src/server.ts      start + graceful shutdown
  src/app.ts         buildBaseApp + this app's routes
  src/modules/       this app's features
  test/
```
Apps import the core as `@sheetal/backend-core/<path>` (e.g. `@sheetal/backend-core/lib/errors`).

## Rules for every module
- Validate input with Zod; throw `AppError` helpers (`notFound`, `conflict`…) for expected problems. Never send stack traces.
- Business data is always filtered by business (tenant) id; permission ids come from `shared/src/core/rbac.js`.
- Cache reads that are hit often (`cached()`), and clear by prefix when the data changes.
- Secrets for outside services are stored encrypted in the database (Setup center), never in code or logs.

## Production
`npm run build -w @sheetal/website-api` (same for business and admin) bundles that API with the core into
`<app>/backend/dist/server.js`; run it with `NODE_ENV=production`, `DATABASE_URL`, `REDIS_URL`, `TRUST_PROXY=true` (behind nginx).
Run `npm run db:deploy -w @sheetal/backend-core` once per release, before starting the APIs.
