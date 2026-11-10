# HANDOVER P1-BE-5
Specialist: Backend
Phase / step: Phase 1, step 7 (Expenses on the kernel)
Status: done in code; NOT run against PostgreSQL (CI is the first full run)

## What I did
- Moved the Expenses server code into `apps/expenses/backend/` (repository, service, controller per KERNEL 10; presenter, profit, categories, schemas, events, recurring, jobs, routes, host, scope). Old `routes.ts` and `domain/expenses.ts` are shims with every export kept; `app.ts` registers `expenseRoutes` from `@sheetal/app-expenses/backend` with `{ prefix: "/v1", contextOf: businessContextOf }`; `jobs.ts` imports `expenseJob` from the app.
- New permission names checked through `ctx.permissions`; old stored names pass via the alias layer. Scope capped at "branch" (scope.ts) so the top-bar branch still narrows the owner's list.
- Soft delete, `amount` + `amount_paisa` on every write, optional `version` (409 only when sent and stale), events inside the write's transaction (`app.events.bus`), audit strings unchanged.
- Data-only migration `20261111120000_expenses_paisa_resync`.
- Additive change to `platform/src/core/service.ts` (events map, audit.updateLabel, "before" row, protected `wrote`).
- Tests: `apps/expenses/backend/test/pure.test.ts` (15, ran, pass), `business/backend/test/expenses-kernel.test.ts` (database; not run here). Old `expenses.test.ts` and `jobs.test.ts` untouched.

## Files delivered (repo paths)
- `platform/src/core/service.ts`
- `apps/expenses/package.json`, `apps/expenses/tsconfig.json`
- `apps/expenses/backend/`: `categories.ts money.ts profit.ts schemas.ts types.ts events.ts presenter.ts expense.repository.ts expense.service.ts expense.controller.ts recurring.ts jobs.ts host.ts scope.ts routes.ts index.ts test/pure.test.ts`
- `backend-core/src/domain/expenses.ts` (shim)
- `backend-core/prisma/migrations/20261111120000_expenses_paisa_resync/migration.sql`
- `business/backend/src/app.ts`, `business/backend/src/jobs.ts`, `business/backend/src/modules/expenses/routes.ts` (shim)
- `business/backend/test/expenses-kernel.test.ts`
- Delete by hand: `apps/expenses/src/` (placeholder)

## Commands the owner must run (PowerShell, in order)
See CHANGES-P1-BE-5.md ("Commands"): checkout branch, expand the zip over the repo, remove `apps\expenses\src`, `npm install`, `npm run check`.

## How to check it worked
- CI: all 13 old expenses tests + jobs tests + the new files green.
- By hand: CHANGES "How to check by hand".

## Not done / open questions
- Not run against PostgreSQL. If `expenses.test.ts` fails in CI, first suspects: (1) the branch-limited person `pokhara` (`scopes: ["Pokhara"]`) must resolve through `businessContextOf` exactly as through `workspaceOf` (both use `accessOfMember`); (2) `app.events` must exist when the job/page generates drafts with events (set at the end of `buildApp` when `app.db`); (3) `createDb` / `inject` use in `expenses-kernel.test.ts`.
- Lead decisions wanted: add `@sheetal/app-expenses` to the dependency lists with `npm install` (lock not in my zip); refresh the manifest header comment; keep or lift the "branch" scope cap when "all branches" is wanted for Expenses.
- P1-FE-2: send `version` everywhere (CHANGES "How P1-FE-2 turns version on"), then flip `requireVersion`.
- Order of events per business is not strictly promised (BE-4 note); the dead-letter screen is not built.

## Next task (for which specialist)
- P1-BE-6: Reviews on the kernel, for Backend. Files that chat needs: the current `main` after this merge, `docs/architecture/KERNEL.md` (10.7), `ACCESS.md` section 6, `business/backend/src/modules/reviews/routes.ts`, the Review model in `schema.prisma`, `apps/reviews/*`, and the pattern in `apps/expenses/backend/` (service `events: null`, `scope.ts`, `host.ts`, `routes.ts` with `contextOf`).
