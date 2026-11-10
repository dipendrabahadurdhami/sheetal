# HANDOVER P1-BE-4
Specialist: Backend
Phase / step: Phase 1, move plan step 6 (jobs, events, notifications, files, sessions)
Status: done (not run against PostgreSQL; see CHANGES-P1-BE-4.md for what could and could not be run)

## What I did
- Jobs registry `platform/src/jobs/registry.ts`: one place that starts and stops the background timers. The business API lists expenses, rentals, stock, listing check-ups and the event dispatcher (`business/backend/src/jobs.ts`); the admin API lists billing renewal, OTA calendar sync and expiry reminders (`admin/backend/src/jobs.ts`). Same intervals and first-run delays as before. `JOBS=off`, tests and "no database" still turn them off (`jobsOn`). Jobs stop on `app.close()`. The old `start*Job` exports stay as shims.
- Event dispatcher `platform/src/jobs/dispatcher.ts` + `outbox-store.ts`: claims outbox rows with `SELECT ... FOR UPDATE SKIP LOCKED`, one `EventDelivery` row per handler, backoff 30 s doubling (max 1 h), dead letter after 8 tries, platform events (tenantId null) go to platform handlers only.
- `platform/src/jobs/consumers.ts` `registerConsumers(bus, manifests, impls)`: handlers get onto the bus only through manifest `events.consumes`; fails at startup when the manifest and the code disagree.
- `platform/src/tenancy/system-context.ts` `buildSystemContext()`: the context of a business handler (actor system, permissions `*`, branch scope all, only that business).
- Moved with shims: notify → `platform/src/notify/index.ts`; files → `platform/src/files/private.ts`, storage → `platform/src/files/storage.ts`; sessions → `platform/src/auth/sessions.ts`; `worksAt` → `platform/src/tenancy/works-at.ts`. The old backend-core paths re-export every name.
- `platform/src/core/events.ts`: handlers can be registered for platform events (`platform: true`); `bus.attach()` connects a dispatcher; `start()`/`drain()` work when one is attached.

## Files delivered (repo paths)
See the list in CHANGES-P1-BE-4.md.

## Commands the owner must run (PowerShell, in order)
1. `git checkout -b phase-1/P1-BE-4-jobs-events`
2. `Expand-Archive -Path .\OUT-P1-BE-4.zip -DestinationPath . -Force`
3. `npm install`   (refreshes `package-lock.json`: `platform/package.json` gained `@aws-sdk/client-s3`)
4. `npm run check`

## How to check it worked
- `npm run test -w @sheetal/platform` : jobs-registry, dispatcher, dispatcher-db, consumers, notify, sessions tests; the old events test is unchanged.
- `npm run test -w @sheetal/business-api -w @sheetal/admin-api`: the new jobs tests and every old test.
- In development (`npm run dev:business`) the log shows no change; with `JOBS=off` no timer starts.

## Not done / open questions
- Nothing consumes events yet (no manifest has `events.consumes`), so the dispatcher only marks rows dispatched. The first handler comes with P1-BE-5.
- Admin → System status (the dead-letter list) is a screen: not built. Dead letters are rows in `event_outbox` with `dispatched_at` empty and `attempts >= 8`.
- Order: the dispatcher does not promise strict order per business (a retried event can arrive after newer ones). KERNEL.md section 9 says "in order per business"; decide whether to change the sentence or add per-business ordering later.
- `admin/backend/package.json` was not in the zip: it should list `"@sheetal/platform": "*"` (the code already imports it; it works through the workspace link).
- `photos.ts` and `domain/platform.ts` were not in the zip, so `savePrivateFile` and the session length take them as arguments from the old backend-core files. When `photos.ts` moves to `platform/src/files/`, `savePrivateFileWith` loses its first argument.
- Carried over: QA asked that `check-branch-links.mjs` report owners whose row has a branch list (P1-DB-3).

## Next task (for which specialist)
- P1-BE-5: Expenses on the kernel (repository, service, controller, presenter, jobs, events), for Backend. Files that chat needs: `business/backend/src/modules/expenses/routes.ts` (as delivered here), `apps/expenses/**`, `platform/src/core/{repository,service,controller}.ts`, `platform/src/jobs/*` and `platform/src/core/events.ts` from this zip.
