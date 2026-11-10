# CHANGES: P1-BE-4 (jobs, event dispatcher, notifications, files, sessions)

Branch: `phase-1/P1-BE-4-jobs-events`. No migration (the outbox tables exist; no column was needed). No screen changes. No new package: `@aws-sdk/client-s3` was already in the repo; it is now also listed in `platform/package.json` because the moved storage code imports it.

## What changed

**1. Jobs registry** (`platform/src/jobs/registry.ts`). `startJobs(app, specs, { enabled })` starts one timer pair per job and stops them in `onClose`. `jobsOn(NODE_ENV, hasDb)` is the old `NODE_ENV !== "test" && JOBS !== "off" && app.db` check. Each API lists only its own jobs:

| Job id | Where | First run | Every |
|---|---|---|---|
| `expenses.recurring` | business | 45 s | 6 h |
| `rentals.bills` | business | 50 s | 6 h |
| `stock.low` | business | 70 s | 6 h |
| `reviews.checkups` | business | none (after one interval) | 15 min |
| `events.dispatcher` | business | 2 s | 5 s |
| `billing.renewal` | admin | 30 s | 6 h |
| `ota.calendar-sync` | admin | 60 s | 2 h |
| `reminders.expiry` | admin | 120 s | 1 h |

The old `startExpenseJob`, `startRentJob`, `startStockJob`, `startBillingJob`, `startOtaJob`, `startReminderJob` stay as shims (they start their job on their own, as before). The check-ups job used to be a timer inside the route plugin: `decide` and `valueFor` moved out of the plugin to module level (`decideChanges(db, tenantId, before)`), same code; the plugin calls it as before.
Three small differences, all safe: a job never overlaps itself (a tick that finds the previous run going is skipped); the check-ups job's errors are now logged (they were swallowed); timers are `unref()`'d (the check-ups timer already was).

**2. Event dispatcher** (`platform/src/jobs/dispatcher.ts`, `outbox-store.ts`, `consumers.ts`; `core/events.ts` changed).
- Row locking: `SELECT id FROM event_outbox WHERE id IN (...) AND dispatched_at IS NULL FOR UPDATE SKIP LOCKED` inside one interactive transaction. A first cheap read (outside the transaction) finds candidates, so an empty outbox costs one query. After the lock the rows are read again with the "ready" test, so a row another process just finished or pushed back is not taken twice.
- Delivery: for each row, every matching handler runs one after the other; a success writes an `EventDelivery` row (unique per event + handler, `createMany skipDuplicates`); a retry only runs handlers that have no delivery row. All writes of a tick commit together with the lock.
- Failure: `attempts + 1`, `next_try_at = now + 30 s x 2^(n-1)` (30 s, 1 min, 2 min... at most 1 h), `last_error = "handler-id: message"` (300 characters per handler, no stack). After 8 tries (`attempts >= 8`, `dispatched_at` empty) the row is a dead letter and is never claimed again. One failing handler never stops the others. A handler that takes over 30 s counts as failed. A tick stops taking new rows after 60 s (the rows stay locked until the tick ends).
- Who sees what: a business event goes to business handlers with a `SystemContext` of that business (`platform/src/tenancy/system-context.ts`: actor `{kind:"system", job: handlerId}`, permissions `*`, every branch of THAT business only). A platform event (`tenantId` null) goes only to handlers registered with `platform: true` and gets a context with no business. A context that cannot be built (business gone) is a failed delivery, never a handler without a context.
- `registerConsumers(bus, manifests, impls)` registers handlers from manifest `events.consumes`; it throws at startup when a manifest entry has no code, when code has no manifest entry, when a handler id does not start with `<app>.`, or when one id is declared twice (all or nothing). No manifest consumes anything yet.
- `OutboxEventBus.attach()/start()/drain()` now work when a dispatcher is attached; without one they throw the same "P1-BE-4" message the old test expects.
- The business API builds one bus and dispatcher per process (`eventsOf(app)` in `business/backend/src/jobs.ts`) and lists `dispatcher.job()` last. The admin API does not run it (handlers belong to apps, which run in the business API; platform events published by the admin API are delivered there).

**3. Moves with shims** (every export kept, 85 importing files unchanged):
- `backend-core/src/lib/notify.ts` -> `platform/src/notify/index.ts`. Bodies unchanged, including `teamWith()` with `reconcileOldNames`.
- `backend-core/src/lib/files.ts` -> `platform/src/files/private.ts`; `storage.ts` -> `platform/src/files/storage.ts`.
- `backend-core/src/modules/auth/sessions.ts` -> `platform/src/auth/sessions.ts`. `reconcileOldNames` in `loadUser` is exactly as it was.
- `worksAt` and `MemberBranches` -> `platform/src/tenancy/works-at.ts` (notify needs them and platform must not import backend-core); `backend-core/src/domain/branches.ts` re-exports them and keeps `headOffice`.

## Deviations and things to know (please read)

1. **Parameters instead of three files I was not given.** `photos.ts`, `domain/platform.ts` and `domain/permissions.ts` are not in the zip. So: `savePrivateFileWith(photoKind, ...)` takes the picture check as an argument and `backend-core/src/lib/files.ts` passes it (the old `savePrivateFile(mediaDir, kind, data)` call is unchanged); sessions read the `sessionDays` setting through `setSessionDaysReader()`, which the sessions shim registers when it loads. `notifyStaff` now uses `LEGACY_PLATFORM_ROLES` and `hasPerm` from `platform/src/tenancy` directly (the shim `domain/permissions.ts` re-exports the same data, per the P1-BE-2 handover). `notify.test.ts` pins its answers (KYC goes to `operations` and `super_admin`). If `PLATFORM_ROLES` in the shim ever differs from `LEGACY_PLATFORM_ROLES`, that test and the old tests will say so.
2. **Order.** KERNEL.md section 9 says "in order per business". The dispatcher handles a batch in creation order, but with two processes (row locking) and retries, a retried event can arrive after newer ones. Handlers must be safe to repeat anyway. Strict order would need a per-business lock or head-of-line blocking; not built. Please decide whether to change the sentence in KERNEL.md or ask for it later.
3. **A tick holds locks while handlers run** (that is what makes two processes safe without extra tables). It is bounded: 30 s per handler, 60 s per tick, 120 s transaction limit. A crash between a handler's work and the commit runs that handler again (at least once, as KERNEL.md says).
4. `member` in the system context is a stand-in (`userId: "system"`); it must never be written to a table. `createdBy`/`updatedBy` come from `actorIdOf`, which gives null for system.
5. `admin/backend/package.json` was not in the zip. It should list `"@sheetal/platform": "*"`; the code works without it through the workspace link.
6. `platform/package.json` gained `"@aws-sdk/client-s3": "^3.700.0"` (same version spec as backend-core). `npm install` refreshes `package-lock.json`; please commit it.
7. Not built (not asked): Admin → System status (dead-letter list screen); anything that publishes or consumes a real event.

## Commands (PowerShell, from the repo root)

```powershell
git checkout -b phase-1/P1-BE-4-jobs-events
Expand-Archive -Path .\OUT-P1-BE-4.zip -DestinationPath . -Force
Remove-Item .\CHANGES-P1-BE-4.md, .\HANDOVER-P1-BE-4.md -ErrorAction SilentlyContinue   # after reading them; keep a copy of the handover in handovers\
npm install
npm run check
```
Run only the new tests:
```powershell
npm run test -w @sheetal/platform
npm run test -w @sheetal/business-api -w @sheetal/admin-api
```

## How to check it by hand
- Start the business API (`npm run dev:business`): it logs no new lines. With `$env:JOBS="off"` no timer starts. Stop it with Ctrl+C: it exits at once (jobs stop on close).
- Event delivery: in a test (or `node` with the test database) publish with `bus.publish` inside `ctx.transaction`, then `await dispatcher.drain()`; `dispatcher-db.test.ts` shows exactly this.

## What I ran, and what I could not
- RAN here (pure code, fake clock, stand-in database objects): `jobs-registry` (14), `dispatcher` (15), `consumers` (7), `notify` (7), `sessions` (9) = 52 tests, all pass. ESLint with the repo config on every new and changed file: 0 errors (2 old warnings in files I touched: `AI_CREDITS`, `SetupT`). A scratch typecheck of all new platform files, of their tests, and of the five backend-core shims (against a stand-in Prisma client and stand-ins for the files I was not given): no errors except in the stand-ins' `any` types.
- COULD NOT RUN (Prisma's engine download is blocked in my workspace, so there is no generated client and no PostgreSQL): `dispatcher-db.test.ts` (the row locking, the rolled-back publish, the isolation, the business context), `business/backend/test/jobs.test.ts`, `admin/backend/test/jobs.test.ts`, every existing test, the full `npm run check`, and the typecheck of the business and admin routes. CI is the first full run. The most likely first-run problems are in `dispatcher-db.test.ts` (it imports `./expense-fixture.js` and `makeTestContext` as `events.test.ts` does, but I could not execute it) and in the typing of `SessionApp` against the real `Cache` class in `backend-core/src/lib/cache.ts` (which I was not given).
- Existing tests: none was edited. `events.test.ts` still passes by design (an unattached bus still throws a message containing "P1-BE-4").

## Files (all full files at their repo paths)
New: `platform/src/jobs/{registry,dispatcher,outbox-store,consumers}.ts`, `platform/src/tenancy/{system-context,works-at}.ts`, `platform/src/notify/index.ts`, `platform/src/files/{private,storage}.ts`, `platform/src/auth/sessions.ts`, `platform/test/{jobs-registry,dispatcher,dispatcher-db,consumers,notify,sessions}.test.ts`, `business/backend/src/jobs.ts`, `business/backend/test/jobs.test.ts`, `admin/backend/src/jobs.ts`, `admin/backend/test/jobs.test.ts`.
Changed: `platform/src/core/events.ts`, `platform/package.json`, `backend-core/src/lib/{notify,files,storage}.ts`, `backend-core/src/modules/auth/sessions.ts`, `backend-core/src/domain/branches.ts`, `business/backend/src/app.ts`, `business/backend/src/modules/{expenses/routes,rentals/routes,stock/routes}.ts`, `business/backend/src/modules/reviews/checkups.ts`, `admin/backend/src/app.ts`, `admin/backend/src/modules/{billing,insight,reminders}.ts`.

## Registering matters (rule 11)
`business/backend/src/app.ts` and `admin/backend/src/app.ts` call `startJobs(...)`; `src/jobs.ts` in each API is the list. A new job does nothing until it is added to that list.
