# HANDOVER P2-W1-S1
Specialist: Backend
Phase / step: Phase 2, wave 1, stage 1 (Rentals)
Status: done (DB tests unrun here; CI is their first run)

## What I did
- Moved Rentals' server code into `apps/rentals/backend` on the kernel; old route and domain files are shims.
- Rules kept: payment ≤ owed; bill amount changes only before payment; rent is the owner's money, deposit held and returned; statement = collected − fee − repairs and the fee counts in profit; online payments count once confirmed.
- Monthly bill job is `rentals.bills` in the jobs registry (`JOBS=off` path unchanged); 22 `rentals.<resource>.<verb>` events written in the same transaction; old audit action strings.
- New tests: `apps/rentals/backend/test/pure.test.ts` (19, passing) and `business/backend/test/rentals-kernel.test.ts` (needs PostgreSQL, unrun).

## Files delivered (repo paths)
See CHANGES-P2-W1-S1.md (list, shims, `app.ts` register line). Not in the zip: schema.prisma, generated files, `business/backend/package.json`, root `package.json` (Lead lines).

## Commands the owner must run (PowerShell, in order)
1. Send OUT-P2-W1-S1.zip to QA, then to the Lead. The Lead applies the "Lines for the Lead" in CHANGES (schema, migration, package lines, `npm run gen:permissions`) on a branch.
2. `npm install`, then `npm run check` and the two `npm run test -w ...` lines in CHANGES.

## How to check it worked
- `rentals.test.ts` passes unchanged; `rentals-kernel.test.ts` passes; `prisma migrate diff` is empty; the Rentals page opens as before.

## Not done / open questions
- Real deletes for owner/unit/payment/statement (see Deviations). Paisa columns are proposed only.
- Stage 2 (People) and Stage 3 (Agreements) not started.

## Next task (for which specialist)
- P2-W1 stage 2: People on the kernel (HR, attendance, leave; leave approval `approvable: true`, rule OFF), for Backend. Files that chat needs: this zip, apps/people/**, business/backend/src/modules/people/routes.ts, business/backend/test/people.test.ts.
