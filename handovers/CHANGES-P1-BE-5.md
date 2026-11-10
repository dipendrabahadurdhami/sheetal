# CHANGES P1-BE-5 — Expenses on the kernel

Branch: `phase-1/P1-BE-5-expenses` (from `main` 62ac4f6). Migration: `20261111120000_expenses_paisa_resync` (data only).
Route paths, verbs, answers, audit strings and permissions behave as before. The only new things a caller can see are listed in "What is different".

## What was done, in the order asked

| Step | What | Files |
|---|---|---|
| (a) move | `modules/expenses/routes.ts` and `domain/expenses.ts` now live in `apps/expenses/backend/`. The old paths are shims that keep every export. `app.ts` and `jobs.ts` import from `@sheetal/app-expenses/backend`. | `apps/expenses/package.json` (exports `./backend`, `./backend/*`, `./manifest`), `apps/expenses/tsconfig.json`, `backend-core/src/domain/expenses.ts`, `business/backend/src/modules/expenses/routes.ts`, `business/backend/src/app.ts`, `business/backend/src/jobs.ts` |
| (b) classes | `ExpenseRepository` + `RecurringExpenseRepository`, `ExpenseService` + `RecurringExpenseService`, `ExpenseController` + `RecurringController`; plus `presenter`, `profit`, `categories`, `schemas`, `events`, `recurring`, `jobs`, `routes`, `host`. | `apps/expenses/backend/*.ts` |
| (c) names | The code asks for `expenses.expense.read/create/update/delete/confirm`, `expenses.recurring.read/create/update/stop`, `expenses.profit.read` through `ctx.permissions`. Stored roles keep `expenses.view` / `expenses.manage`; the alias layer answers. | services, `scope.ts` |
| (d) soft delete + paisa | Delete sets `deletedAt/deletedBy` (a recurring draft is still "skipped"). Every write sets `amount` AND `amount_paisa`. Profit ignores deleted rows. | repositories, `money.ts`, `profit.ts` |
| migration | Re-runs the two P1-DB-1 backfill UPDATEs (only `amount_paisa IS NULL`; safe twice). | `backend-core/prisma/migrations/20261111120000_expenses_paisa_resync/migration.sql` |
| kernel | A small additive change to `platform/src/core/service.ts` (see "Kernel change"). | `platform/src/core/service.ts` |

### How far I could run the existing tests (please read)
My sandbox has no PostgreSQL and no Prisma engine (downloads are blocked), so **`expenses.test.ts` (13 tests, untouched) and the new database tests were NOT run, after any sub-step.** CI is the first run.
What I did instead:
- Read each of the 13 tests against the new code path by path (status codes, messages, order of checks, response fields). Notes are in HANDOVER.
- Type-checked every new/changed file (with a stand-in for the Prisma client, so row types are loose) and ran ESLint on them: clean.
- Ran the 15 database-free tests in `apps/expenses/backend/test/pure.test.ts`: pass.
- Ran `check-boundaries`: ok. `gen:permissions --check`, `check:manifests`, `check:schema`: not run (their helper files were not in the zip); I changed no manifest, no schema and no generated file.
The zip holds the final state of all four sub-steps, not four snapshots. If you want four commits, the table above says which files belong to which step; (a) alone is the two shims + `app.ts` + `jobs.ts` + the moved code.

## What is different (everything a person or a developer could notice)
1. **Deleted expenses are kept** (`deleted_at` set), as KERNEL 10.5 says. Lists, profit, receipts and PUT/DELETE treat them as not found.
2. **New JSON field `version`** on every expense and recurring row (list, add, change, confirm). Nothing reads it yet.
3. **Optional `version`** on change/confirm/pause/resume/stop bodies and `?version=` on DELETE: a stale one answers `409 version_conflict`; a missing one saves as today (last write wins).
4. **Events** (new, in addition to audit): `expenses.expense.confirmed` (add, confirm), `.updated`, `.deleted`, `.skipped`, `expenses.recurring.draft_created`. Written in the same transaction as the change. Recurring-template changes publish nothing (the manifest lists only `draft_created`).
5. `GET /expenses?page=&per=` pages and also returns top-level `meta` (`total`, `current_page`, `last_page`, `per_page`). Without `page`/`per` the answer is the old one (up to 2000 rows, no `meta`). This makes the manifest's menu badge (`/expenses?status=draft&per=1`, field `meta.total`) work.
6. Rows added by the job or the page get `amount_paisa`, `version` 1.
7. A custom role that holds only the NEW names now works (tested); one that holds only `expenses.view` can read expenses, recurring and profit but not write, as before.

Unchanged on purpose: paths and verbs (PUT for change, POST for create/confirm/receipt/actions, DELETE), create answers 200, messages (`EX-0001 saved.`, …), 403 texts, 404 text `Expense not found.`, audit actions and targets (`expense.added` `EX-0001 Rs. 1200`; `expense.changed` `EX-0001 Rs. 1200 → 1500`; `expense.confirmed`; `expense.deleted`; `expense.skipped`; `expense.recurring_added` `rent Rs. 40000 on day 1`; `expense.recurring_changed` `rent Rs. 40000 → 41000`; `expense.recurring_paused|active|stopped`), the job id/timing (`expenses.recurring`, 45 s / 6 h), the order of checks (permission, input 422, row found 404, category rule 400), money in whole rupees under `amount`, notification text.

## How P1-FE-2 turns `version` on
1. Read `version` from each row the API returns (list rows, and the `data` of add/change/confirm).
2. Send it back: in the body of `PUT /expenses/:id`, `POST /expenses/:id/confirm`, `PUT /expenses/recurring/:id`, `POST /expenses/recurring/:id/(pause|resume|stop)`, and as `?version=` on `DELETE /expenses/:id`.
3. Treat `409` with `code: "version_conflict"` as "someone else changed this: Reload", not a red error.
4. When the page sends it everywhere, a later backend task flips `requireVersion: false` → `true` in `ExpenseService` and `RecurringExpenseService` (one line each, in `expense.service.ts`). That makes a missing `version` on change a 400. Confirm/pause/delete read the version themselves (`versionIn`, `versionQuery`); make them required in the same task.

## Decisions and deviations (each one is small and easy to undo)
1. **Kernel change, additive:** `platform/src/core/service.ts` gets optional `events` (event name per standard write; `null` = none), `audit.updateLabel` (target text from before/after row) and passes the "before" row to `wrote()` / `eventPayload()`; `wrote()` is now `protected`. A service that uses none of them behaves as before. Needed so the audit target `Rs. 1200 → 1500` and the manifest's event names (`…confirmed` for an add) come out exactly.
2. **Scope capped at "branch" for Expenses (`scope.ts`).** The owner's `*` resolves to scope "all", which would ignore the branch picked in the top bar; the page filters by it today. So the controllers wrap the context and cap every Expenses scope at "branch" (identical rows to today). It also puts the old 403 texts back. One constant (`CAP`) to change when "all branches" is switched on for Expenses.
3. **The app gets its request context from the API.** An app does not import an API, so `expenseRoutes(app, { contextOf })` takes the builder; `app.ts` passes `businessContextOf`. The old shim `expenseRoutes(app)` still works (it binds it).
4. **Events bus is looked up when used.** `app.events` is created at the END of `buildApp`, after routes are registered, so `host.ts` reads it per call. If it is missing, an event write fails loudly (never silently skipped).
5. **The job and `generateDueExpenses`** keep their signature; a new optional `events: { bus, contextFor }` makes each draft + its event one transaction of that business (a system context). Without `events` (old callers, the old test) the draft is added with no event. `createDraftIfMissing(db|tx, template, month)` takes a database handle, not a request context (KERNEL 10.2 sketched `ctx`), because the job has no request. `dueTemplates` reads every business (job only; commented).
6. **Profit stayed inside the app** (KERNEL 10.6 "faster path"): `profit.ts` is the old code; it now skips `deletedAt` rows and reads the expense amount from paisa (rupees if paisa is NULL). The manifest `reads` already lists `BizReceipt, BizInvoice, Payout, PayoutItem, OwnerStatement`: unchanged. Totals on the existing fixture are the same by construction (whole rupees x 100 / 100).
7. `canManage` in the list answer = may create. `GET /expenses/recurring` returns up to 5000 rows (it had no limit; templates are few).
8. `app.manifest.ts` is untouched (its header still says "code lives in business/backend until P1-BE-5"; the Lead may refresh that comment).
9. **Dependencies:** I did not edit any `package.json` dependency list (`business/backend`, `backend-core`) because `package-lock.json` is not in the zip and an out-of-step lock would break `npm ci`. Workspaces are hoisted, so `@sheetal/app-expenses` resolves. The Lead may add `"@sheetal/app-expenses": "*"` to `business/backend` and `backend-core` with `npm install` (updates the lock).
10. The app still imports `dayOf/ymd` (`domain/money`), `nepalDay` (`domain/payouts`), `savePrivateFile/readPrivateFile` (`lib/files`) and `effectiveLimits` from backend-core: they have no platform home yet. The ESLint rule that bans the moved paths is respected (`Db`, `notify` come from platform).

## New tests
- `apps/expenses/backend/test/pure.test.ts` (15, no database): money columns, input rules and messages, the answer shape, event payloads, profit helpers, the scope cap.
- `business/backend/test/expenses-kernel.test.ts` (database): the kernel isolation helper on `ExpenseRepository`; another business's expense is 404 for PUT/confirm/DELETE/receipt and absent from the list; another branch's expense is 404 for a limited person; the owner's picked branch narrows the list; new-name-only role and old-name-only role; audit strings; events; 409 on a stale version (change, delete, confirm, pause), saving without a version, version counting up; soft delete (row kept, hidden from list/profit/receipt); paisa on create/change/confirm/recurring/draft and a NULL-paisa row; the event is in the same transaction and gone on rollback; the recurring job adds one draft per month with paisa and its event; the old bus-less call still works.
- `business/backend/test/expenses.test.ts` (13) and `jobs.test.ts`: **unchanged**.

## Commands (PowerShell, from the repo root)
```powershell
git checkout main
git pull
git checkout -b phase-1/P1-BE-5-expenses
Expand-Archive -Path "$HOME\Downloads\OUT-P1-BE-5.zip" -DestinationPath .\_out -Force
Copy-Item -Path .\_out\apps, .\_out\backend-core, .\_out\business, .\_out\platform -Destination . -Recurse -Force
Remove-Item -Path .\apps\expenses\src -Recurse -Force        # the empty placeholder from P1-OPS-1; the package now exports ./backend
Remove-Item -Path .\_out -Recurse -Force
npm install
npm run check
```
Notes: `_out` also holds `CHANGES-P1-BE-5.md` and `HANDOVER-P1-BE-5.md` (copy them to `handovers/` if you keep them there). `npm install` is only needed to refresh the workspace links and lock. The new migration is applied by `npm run db:migrate` and by the test database automatically.

## Registering routes matters
`expenseRoutes` is registered in `business/backend/src/app.ts` with `{ prefix: "/v1", contextOf: businessContextOf }`. The controllers register nothing by themselves.

## How to check by hand
1. Open Business → Expenses: list, add, change, delete, confirm a draft, add a receipt, open Recurring and Profit. Everything looks and reads as before.
2. Pick a branch in the top bar as the owner: the list narrows to it.
3. In psql: `select id, amount, amount_paisa, version, deleted_at from expenses order by created_at desc limit 5;` (paisa = amount x 100; after a delete, `deleted_at` is set and the row is still there) and `select name, payload from event_outbox where name like 'expenses.%' order by created_at desc limit 5;`.
4. `select action, target from audit_logs where action like 'expense.%' order by created_at desc limit 8;` — same words as before.

## Not done / for the Lead
- Nothing run against PostgreSQL (see above). If CI shows a failure in `expenses.test.ts`, send me the log: the first suspects are listed in HANDOVER.
- `expense.presenter` KERNEL name is `presenter.ts`; `ExpenseRepository.confirmedBetween` (KERNEL 10.2) is not built: profit stayed in `profit.ts`, so nothing calls it.
- Recurring and expense CSV: the page builds its CSV from the list/profit answers, so it follows automatically.
