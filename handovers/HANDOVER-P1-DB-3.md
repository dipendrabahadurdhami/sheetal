# HANDOVER — P1-DB-3

**Specialist:** Database
**Phase-step:** Phase 1 / P1-DB-3 (access tables + role-permission rewrite script)
**Status:** Done, waiting for QA then Lead. Prisma validate/generate/migrate-diff and `npm run check` NOT run in my workspace (engines blocked); CI is the first run. Tests ran on a real PostgreSQL with stand-ins (see CHANGES 6).

## What I did
- Migration `20261112090000_access_tables` (additive): `roles.perms_v1`, tables `approval_rules`, `approval_requests` (`/// @app workspace`), `impersonation_sessions` (`/// @app platform`); status as text + CHECK; RESTRICT on staff, SET NULL on tenant for the trail; no FK on branch/maker/checker.
- `scripts/rewrite-role-perms.mjs`: dry-run / apply / restore, one transaction each, proof for server and screens rules, allow-list of 5 widening names, backup in `perms_v1`, `--business=` filter.
- `check-branch-links.mjs`: section (d) owners with a branch list (report only).
- 22 tests; sabotage shown and undone (CHANGES 5).

## Files delivered (all full files)
- `backend-core/prisma/schema.prisma`
- `backend-core/prisma/migrations/20261112090000_access_tables/migration.sql`
- `backend-core/scripts/rewrite-role-perms.mjs`
- `backend-core/scripts/check-branch-links.mjs`
- `backend-core/test/access-tables.test.ts`
- `CHANGES-P1-DB-3.md`, `HANDOVER-P1-DB-3.md`

## Commands (PowerShell)
See CHANGES-P1-DB-3.md section 8 (validate, `migrate diff --exit-code`, deploy, generate, `npm run check`, dry run, branch-link check).

## How to check
1. `migrate diff` is empty; `npm run check` passes; the new test file passes.
2. `node backend-core/scripts/rewrite-role-perms.mjs` prints PASS and the only GAINS lines are on the allow-list.
3. Lead adds the 4 lines in CHANGES section 7 (manifests, BRANCH_LABEL_ONLY, MODEL-OWNERS.md), then `check-manifests` and `check-schema-ownership` pass.

## Not done / open
- `--apply` on real data: only after QA + Lead approval, backup first.
- Lead to review: the 5-name allow-list; tenant FK choice (SET NULL) for the impersonation trail; whether owner invites need a report line.
- Indexes for "my requests" and pending-by-resource are left for BE-7 when real queries exist.
- Not in scope and not touched: approval hook in `BaseService.action`, inbox, impersonation routes, call-site switch.

## Next task
P1-BE-7 (approval hook + inbox) and P1-BE-10 (impersonation routes) use these tables; P1-FE-4 switches call sites to the new names after the rewrite has run.
