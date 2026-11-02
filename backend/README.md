# Sheetal Property API

Node.js 22+ · TypeScript (strict) · Fastify 5 · PostgreSQL (Prisma 6) · Redis (cache) · Zod.
One API serves the website, business workspace and admin panel. Plan: `../docs/backend-plan.md`; old-site rules to keep: `../docs/old-backend-audit.md`.

## Run locally (no Docker or system PostgreSQL needed)
```bash
cp backend/.env.example backend/.env       # once
npm run db:local                            # terminal 1: private PostgreSQL on port 5433 (keep open)
npx -w @sheetal/api prisma migrate dev      # once, and after schema changes
npm run dev:api                             # terminal 2: API on http://localhost:4000
```
Check: `http://localhost:4000/health/ready` → `{"status":"ready", …}`.

To send website requests to the API, copy `website/frontend/.env.example` to `.env.local` and list the built paths in `VITE_API_LIVE` (or `*`). Everything else keeps using demo data.

## Layout
```
src/
  server.ts        start + graceful shutdown
  app.ts           builds the app: logging, request ids, security headers, CORS, rate limits, error handler, routes
  config.ts        every environment setting, validated at start-up
  lib/errors.ts    one error format: { message, code, errors?, requestId }
  lib/cache.ts     Redis in production, in-memory locally; cached(key, ttl, fn)
  lib/db.ts        Prisma client
  lib/bots.ts      bot detection (from the old BotDetector)
  lib/status.ts    health of database and cache (System status page)
  routes/          /health, /health/ready; feature modules go under /v1
prisma/            schema and migrations
scripts/local-db.mjs  local PostgreSQL
test/              Vitest tests (run without a database)
```

## Rules for every module
- Validate input with Zod; throw `AppError` helpers (`notFound`, `conflict`…) for expected problems. Never send stack traces.
- Business data is always filtered by business (tenant) id; permission ids come from `shared/src/core/rbac.js`.
- Cache reads that are hit often (`cached()`), and clear by prefix when the data changes.
- Secrets for outside services are stored encrypted in the database (Setup center), never in code or logs.

## Production
`npm run build -w @sheetal/api` → `node backend/dist/server.js` with `NODE_ENV=production`, `DATABASE_URL`, `REDIS_URL`, `TRUST_PROXY=true` (behind nginx), and `npx prisma migrate deploy` on each release.
