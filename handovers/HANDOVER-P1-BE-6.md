# HANDOVER P1-BE-6: Reviews on the kernel

**Branch:** `phase-1/P1-BE-6-reviews` (from `main` df9ffd8, BE-5 merged). **Plan step 8.** Nothing in this task needs a migration or a screen change.

## What now exists
- `apps/reviews/backend/` holds the Reviews server code: `review.repository.ts`, `review.service.ts`, `review.controller.ts`, `routes.ts` (`reviewRoutes(app, { contextOf })`), `presenter.ts`, `schemas.ts`, `events.ts`, `scope.ts`, `host.ts`, `types.ts`, `index.ts`, `test/pure.test.ts`.
- `business/backend/src/modules/reviews/routes.ts` is a one-line re-export (shim). `app.ts` imports `reviewRoutes` from `@sheetal/app-reviews/backend` and registers it with `{ prefix: "/v1", contextOf: businessContextOf }`.
- `modules/reviews/checkups.ts` (listing check-ups) stays where it is. The website still WRITES reviews (`website/backend/src/modules/engage/routes.ts`).

## How it works
- **Visibility rule (KERNEL 10.7):** all in `ReviewRepository.extraScope`: `status = "published"` AND (`tenantId` = this business OR `listingId` in this business's listings of the branches in view). `deletedAt` hides a row through the base class. The standard tenant filter is OFF (`tenantField: null`).
- **Permissions:** the code checks `reviews.review.read` / `reviews.review.reply`. Old roles pass through the alias layer (`customers.view` and `reviews.reply` read; `reviews.reply` replies).
- **Scope cap:** like Expenses, `scope.ts` caps every scope at `branch` (owner `*` would otherwise be "all" and ignore the picked branch). One constant to change later.
- **Reply:** one `action` = permission → row → `version` check → update → audit (`review.replied` / `review.reply_removed`, target = review id) → event `reviews.review.replied` `{ reviewId, hasReply }`, all in one transaction. The reviewer is notified AFTER the commit, only on a first reply. Empty text removes the reply.
- `version` in the reply body is optional (stale → 409 `version_conflict`). The list now also returns `version` per review.
- `requireApp`: reviews is part of every plan today (`hasApp` is true in Phase 1).

## Decisions / deviations
1. `ReviewRow.tenantId` is typed `string` (kernel `BusinessEntity`); in the table it is NULL for a listing review. The repository never uses it as a filter.
2. `website/.../engage/routes.ts`: the two review upserts now set `createdBy` on create and `updatedBy` + `version +1` on update. The defaults already made new reviews visible; this only keeps the kernel columns honest.
3. `apps/reviews/package.json` now has `exports` (`./backend`, `./backend/*`, `./manifest`) and dependencies (platform, fastify, zod); `tsconfig.json` includes `backend`. The placeholder `apps/reviews/src` must be deleted by hand.
4. The `@sheetal/app-reviews` dependency in `business/backend/package.json` and the lock are for the **Lead**.
5. Website review notifications still call `teamWith(…, ["reviews.reply"])` (old name; the alias layer answers). Not changed here.

## Not run here (no PostgreSQL / Prisma engine in my sandbox)
`business/backend/test/reviews-kernel.test.ts`, the old `branches.test.ts` review test and `website/backend/test/write.test.ts` have NOT been run. CI is the first full run. Run here: ESLint (clean), `check-boundaries` (ok), the pure test (9 pass), and a type-check of the app against stub platform files (only a missing `core/manifest` stub in my scratch tree complains).

## Next
P1-FE-3 (Reviews screen): send `version` with the reply; use `meta.canReply`.
