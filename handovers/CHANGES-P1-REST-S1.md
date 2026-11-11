# CHANGES P1-REST Stage 1 (BE-7 + backend half of FE-4)

## What changed
- **One copy of `busOf` and the scope cap** now live in `platform` (`core/host.ts`, `core/scope-cap.ts`). Expenses and Reviews import them; **`apps/reviews/backend/host.ts` is deleted** (a zip cannot carry a deletion: delete it by hand, nothing imports it any more).
- **Approvals (ACCESS.md 9.4), rules OFF.** `platform/src/approvals/{service,routes,jobs}.ts`, `core/approval.ts`. `BaseService.action()` asks the gate when an action declares `approval`; a held action is stored and answers **202** `{ message, code: "approval_requested", data: { approvalId } }`. The maker can't decide their own request, a second request for the same record is refused while one waits, decisions are compare-and-set, the approved action runs **as the maker**, and an expiry job closes old ones. With no rule (or a rule that is off) nothing changes for anyone.
- **Impersonation (ACCESS.md 12)** on the admin API: `POST /admin/businesses/:id/impersonate` (password again, reason, minutes 1-30, read-only unless super admin + second reason), `GET /admin/support-sessions`, `POST /admin/support-sessions/:id/end`. Token is `sup1.<id>.<signature>` signed from `SECRETS_KEY` (no schema change). Business API: a hook turns the token into a support user; read-only refuses writes (`impersonation_read_only`); the deny list applies; owners are told in-app and by email; audit rows (start, end, every write, opened files) carry the **business name**; `requestCount` is counted. `GET /v1/support/session`, `POST /v1/support/end` feed the FE banner.
- **Role catalog**: `tenancy/catalog.ts` + `modules/access.ts` + `team/routes.ts` accept new `app.resource.action[:scope]` names next to the old names. Old names are stored as sent (existing team tests need that); `GET /team` also returns the new-name view (`grants`). The Phase 1 cap refuses Expenses/Reviews wider than `branch`.
- **`meta.can` flags** on Expenses and Reviews lists. Expenses: only with a page request or `?flags=1` (the plain list shape is pinned by `expenses-kernel.test.ts`).

## Design choices you may want to change
- The expiry job is in a new `platformJobs()` started next to `businessJobs()` because `jobs.test.ts` pins the `businessJobs()` list. Moving it in is a one-line change plus one test row (Lead's call).
- `workspace.settings.update` is reused for editing rules; `/business/approvals` is a guessed link for FE-4.
- "Not another staff member" = refuse a business whose owners are all staff.
- Route path is `/admin/businesses/:id/impersonate` as the spec says (the rest of the admin API says `/admin/tenants`).
- `opened_file` auditing is by URL pattern.

## Lines for the Lead
None needed: no new models, permissions, manifest lines, MODEL-OWNERS or BRANCH_LABEL_ONLY entries. (Registration lines are inside the two `app.ts` files in this zip.)

## Run (PowerShell, in order)
```powershell
Remove-Item apps\reviews\backend\host.ts
npm install
npx prisma validate
npm run check
npm run build
```
Hand test: sign in to admin as a support-role staff member; POST impersonate with your password and a reason; use the token against `/v1/expenses` (works), POST (403 `impersonation_read_only`); owner gets a bell note and email; `GET /v1/support/session` shows the banner data; end it and the token stops working. Then in the business panel save an approval rule for `expenses.expense.confirm` (PUT `/v1/approvals/rules`) and confirm a draft as the accountant: 202; approve as the owner.

## What I could not run here
No database, Prisma engine or browser (engine download is blocked), so **CI is the first full run** of: `npm run check` type checks (Prisma types are missing locally, so tsc shows only Prisma noise), and the two database test files (`business/backend/test/approvals-support.test.ts` and the existing suites). What did run: 22 new pure tests (pass), eslint on every changed file (0 errors), `check-boundaries` and `check-schema-ownership` (ok).
`check-manifests` / `gen:permissions --check` report `platform/src/tenancy/apps.generated.ts` out of date. **This is the same on the untouched upload**, so it is not from this stage; run `npm run gen:permissions` and commit if CI complains (I never hand-edit generated files).

## Open questions / not built
- Two-step sign-in is not built (only the password check). Staff sign-out does not end a session; sessions last at most 30 minutes and a removed staff member is closed on the next request.
- A request could stay "approved" if the process dies before it runs; it is visible in the inbox but there is no retry yet.
- Phase 2 apps must pass `approval` in their actions to use the gate.
- No old test assertion was changed.
