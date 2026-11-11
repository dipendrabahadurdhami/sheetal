# HANDOVER P1-REST-S1
Specialist: Backend
Phase / step: Phase 1, P1-REST Stage 1 (BE-7 + backend half of FE-4)
Status: done (not yet run against a database; CI is the first full run)

## What I did
- Moved `busOf` and the scope cap into `platform`; deleted `apps/reviews/backend/host.ts`.
- Approvals gate, service, routes, expiry job (rules OFF); 202 answer for a held action.
- Staff support sessions (admin API start/list/end; business API token hook, read-only, deny list, owner notice, audit with business name, requestCount, banner routes).
- Role catalog with new names beside old names (old kept as sent; `grants` view in GET /team).
- `meta.can` on Expenses (page or `?flags=1`) and Reviews lists.
- Tests: platform/test/approvals-pure.test.ts, platform/test/support-and-catalog.test.ts (22 pass locally), business/backend/test/approvals-support.test.ts (CI).

## Files delivered (repo paths)
See `CHANGES-P1-REST-S1.md` and the zip tree (all full files). Deleted by hand: apps/reviews/backend/host.ts.

## Commands the owner must run (PowerShell, in order)
1. Remove-Item apps\reviews\backend\host.ts
2. npm install
3. npx prisma validate
4. npm run check
5. npm run build

## How to check it worked
- CI green; the three new test files pass. Hand test script is in CHANGES.

## Not done / open questions
- Two-step sign-in; end session on staff sign-out; retry for a request stuck in "approved"; expiry job lives in `platformJobs()` (Lead may move it into `businessJobs()` + a jobs.test row); apps.generated.ts out of date before this stage.

## Next task (for which specialist)
- P1-REST Stage 2: say NEXT in the P1-REST chat, for Backend. Files that chat needs: this zip's tree and 00-START-HERE-YOUR-TASK.md.
