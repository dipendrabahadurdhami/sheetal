# CHANGES P1-BE-6: Reviews on the kernel

Branch `phase-1/P1-BE-6-reviews`. Behaviour is unchanged: same routes (`GET /v1/reviews`, `POST /v1/reviews/:id/reply`), answers, messages, audit strings (`review.replied` / `review.reply_removed`, target = review id) and reviewer notification. New: `version` on each review in the list, an optional `version` in the reply body, and one event.

## Files (full files at repo paths)
New in `apps/reviews/backend/`: `types.ts`, `schemas.ts`, `presenter.ts`, `events.ts`, `review.repository.ts`, `review.service.ts`, `review.controller.ts`, `scope.ts`, `host.ts`, `routes.ts`, `index.ts`, `test/pure.test.ts`.
New test: `business/backend/test/reviews-kernel.test.ts`.
Changed: `apps/reviews/package.json`, `apps/reviews/tsconfig.json`, `apps/reviews/app.manifest.ts` (header comment only), `business/backend/src/modules/reviews/routes.ts` (shim), `business/backend/src/app.ts`, `website/backend/src/modules/engage/routes.ts`.
Docs: `HANDOVER-P1-BE-6.md`, `CHANGES-P1-BE-6.md`.

## Sub-steps
- (a) Routes moved into `apps/reviews/backend`; old file is a one-line shim; `app.ts` imports from `@sheetal/app-reviews/backend`.
- (b) `ReviewRepository` (visibility rule in `extraScope`), `ReviewService` (list + `reply`), `ReviewController`.
- (c) New permission names checked through `ctx.permissions`; old roles still work through the alias layer ("reviews.reply OR customers.view can read" is tested).
- (d) `version` and soft delete are used by the repository (a `deletedAt` row is hidden; nothing deletes yet). No migration.

## IMPORTANT: registration
`reviewRoutes` is registered in `business/backend/src/app.ts` with `{ prefix: "/v1", contextOf: businessContextOf }`. Without that option the routes cannot build a context.

## For the Lead
Add `"@sheetal/app-reviews": "*"` to `business/backend/package.json` dependencies and update `package-lock.json` (I did not touch either).

## PowerShell
```powershell
git checkout main
git pull
git checkout -b phase-1/P1-BE-6-reviews
Expand-Archive -Path "$HOME\Downloads\OUT-P1-BE-6.zip" -DestinationPath .\_out -Force
Copy-Item -Path .\_out\* -Destination . -Recurse -Force
Remove-Item .\_out -Recurse -Force
Remove-Item .\apps\reviews\src -Recurse -Force
npm install
npm run check
```
(`npm install` is needed so `@sheetal/app-reviews` is linked; add the dependency line above first.)

## What was and was not run
Run in my sandbox: ESLint on the new files (clean); `scripts/check-boundaries.mjs` (ok); `apps/reviews` pure tests (9 pass); a type-check of the app against stubbed platform files.
NOT run (no PostgreSQL or Prisma engine here): `reviews-kernel.test.ts`, the unchanged review test in `branches.test.ts`, `website/backend/test/write.test.ts`, and a type-check against the real Prisma client. CI is the first full run.

## New tests (`reviews-kernel.test.ts`)
Isolation (other business's review not found; a Pokhara-only person does not see Head office listings' reviews); hidden and soft-deleted reviews hidden; reply / change / remove: audit strings, event (payload checked, filtered by own ids), notification only on a first reply; stale `version` → 409; old-name roles (`customers.view`, `reviews.reply`) and new-name roles; a role with no review permission refused with the old messages; read-only support session refused; the event failing rolls the reply back. Counts on shared tables are filtered by this test's own ids.

## Deviations
1. Scope cap at `branch` (as in Expenses) so today's picked-branch behaviour is exact.
2. `ReviewRow.tenantId` typed `string` for the kernel; it is NULL in the table for listing reviews and never used as the filter.
3. Small edit in the website writer: `createdBy` on create, `updatedBy` + `version +1` on update (behaviour unchanged).
4. Reviewer notification is sent after the transaction commits.
5. The `Review` model comment in `schema.prisma` says "hidden stays visible to the business"; the code (as before) lists only `published`. Left as is.
