# CHANGES P1-S3 (roadmap stage 1.3: Integration Center)

One builder. Branch `phase-1/P1-S3-integration-center`. One additive migration (`20261112110000_integration_center`, five new tables, no row inserted). No new npm package.

## What changed and why

| Part | Files | What |
|---|---|---|
| Tables | `schema.prisma`, the migration, `apps/workspace/app.manifest.ts`, `platform.manifest.ts`, `MODEL-OWNERS.md` (101 models) | `IntegrationConnection`, `IntegrationSecretSet`, `IntegrationDocument`, `IntegrationTestLog` (`@app workspace`), `HelpGuide` (`@app platform`). |
| Vault | `platform/src/auth/vault.ts` | `seal(value, aad)` writes "v2" bound to `<connectionId>:<mode>:<field>`; `open()` still reads every old "v1" value. A live key copied into a test row does not open. |
| Framework | `platform/src/integrations/{types,state,fields,registry,service,legacy,health,routes}.ts`, `providers/{base,payments,web}.ts` | One interface; the life-cycle (details, test, live, paused, staged change, apply, disconnect); the test log; the health job (3 failures = down, told once, never pauses). |
| Adapters | `providers/payments.ts`, `providers/web.ts` | eSewa, Khalti, Fonepay, Google, WhatsApp, Cloudflare with read-only tests. 17 more are shells: their details can be saved now, no new screen later. |
| Old settings stay working | `legacy.ts`, `admin/backend/src/modules/{platform,billing}.ts` | Two-way sync for one release: the old settings routes are aliases (they refresh the connection); every change in the Center rewrites the old row, so `gateways()` and the website are untouched. |
| Script | `backend-core/scripts/integrations-migrate.ts`, `npm run integrations:migrate` | Copies today's settings into connections. Sealed values are copied unopened. Idempotent. Deletes nothing. |
| Routes (rule 11) | `admin/backend/src/app.ts` registers `integrationAdminRoutes`; `adminPlatformJobs()` adds `integrations.health` (the pinned `adminJobs()` list is unchanged). | `/v1/admin/integrations…` (list, one, save, test, go-live, pause, resume, apply, disconnect, log, guide). |
| Screens | `admin/frontend/src/pages/IntegrationCenter.jsx`, `integrationWords.js` (+test), `AdminApp.jsx` | Setup center list by group; one connection's page with steps, Test / Live details, buttons by state, last tests, the guide. |
| Tests | `platform/test/integrations-pure.test.ts` (20), `admin/backend/test/integrations.test.ts` (database), `integrationWords.test.js` (6) | Life-cycle, bound vault, adapters with fake fetch, no secret in any row or answer, staged change, health, migrate idempotent. |

## Not in this stage (said plainly)
- The business side (`/v1/integrations`, document upload, Sheetal's review queue, the "Business requests" tab): the tables, states and service support it, the routes and screens come with the Phase 2 business settings (INTEGRATIONS.md section 7.1 says Phase 2).
- Provider webhooks (`/v1/webhooks/:integrationId/:connectionId`): no built adapter needs one yet.
- The guide editor screen: guides are served (built-in text, or a published `HelpGuide` row); editing a row has no screen yet (stage 1.4 content settings).
- `PaymentProvider.checkout/verify` as classes: billing keeps calling `backend-core/src/lib/payments.ts` (unchanged) and reads keys through the old row that the Center keeps in step. The switch to `resolve()` belongs to Phase 3 billing.

## Owner step after update
`npm run integrations:migrate` once (the runner does it in stage 1.6). Then Admin → Setup center.
