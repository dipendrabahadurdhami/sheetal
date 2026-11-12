# CONTINUE Phase 1 (rest): where it stands (12 Nov 2026, Nepal time)

Phase 1 (rest) is not finished. This note is the stop at a merged, green stage boundary. The next "next" continues the SAME phase with stage 1.5.

## Done (merged, CI green on main)
| Stage | PR | State |
|---|---|---|
| 1.2 Screens | #20 | merged. Notes: `CHANGES-P1-S2-screens.md`. |
| 1.3 Integration Center | #22 (`1a607c4`) | merged. 5 new tables (additive migration `20261112110000_integration_center`), bound vault (v2), framework, 6 adapters + 17 shells, two-way sync with the old settings rows, `npm run integrations:migrate`, admin screens. Notes: `CHANGES-P1-S3-integration-center.md`. |
| 1.4 Settings | #23 (`7c8e0f9`) | merged. Typed settings store (no schema change), revenue share + report, field builder, theme tokens, admin screens. Notes: `CHANGES-P1-S4-settings.md`. |

Tests on main: 1125 (was 1013 at the start of Phase 1 rest).

## Not done: stage 1.5 (new permission names everywhere) and stage 1.6 (close-out)

### Why 1.5 was not started in the same sitting
Measured on main: **60 old permission names, about 700 uses in 85 files** (besides `platform/src/tenancy/legacy-v1.ts`, which is the alias table itself).
Biggest: `business/frontend/src/pages/BusinessApp.jsx` 162, `admin/frontend/src/pages/AdminApp.jsx` 56, `business/backend/src/modules/hotel/routes.ts` 33,
`overview/routes.ts` 25, `pos/routes.ts` 25, `admin/backend/src/modules/content.ts` 22, `projects/routes.ts` 21.
By area: business/backend 220, business/frontend 231, admin/backend 138, admin/frontend 73, backend-core 22, website/backend 9, shared 6.
Every one of these decides who may do what. A wrong mapping is a silent access bug, so it must not be done in a hurry.

### What 1.5 has to respect
1. **An old name can stand for several new names.** `can("old")` is true when the role holds the old name or ALL of its new names (`platform/src/tenancy/aliases.ts`).
   So `can("old")` becomes `can(new)` only when the old name maps to exactly one new name; otherwise it becomes "all of [new…]". Do it with a table-driven
   codemod, not by hand, and commit the table.
2. **Safety net first:** write a truth-table test before touching call sites: for every role template of every business type (and every platform staff role),
   record the answer of every old-name check; after the switch the new-name checks must give the same answers. `packages/config/src/menu.test.js` shows the shape.
3. **Role templates** (`shared/src/core/rbac.js`, `backend-core/src/domain/permissions.ts`) still create roles in OLD names. They must create new names with scopes
   before the alias layer goes, or every new business gets roles that no longer work.
4. **Old tests assert old names** (role `perms` arrays, `ws.can("…")` in tests). The team rule says old tests pass unchanged; 1.5 necessarily changes what a role
   stores, so those assertions change. List every changed test in the CHANGES file with the reason; never change what a test proves.
5. **Order on the owner's computer.** Once the alias layer is removed, roles stored in old names stop working. The real role rewrite
   (`npm run roles:new-names -- --apply`, with `Role.permsV1` as the backup) must run in the same update, before the servers start. It changes real data:
   **ask the owner first**, and take `npm run db:backup` before it. This is why 1.5 and the runner of 1.6 ship together.
6. Suggested split: 1.5a truth-table test + templates in new names (alias layer still on, nothing breaks) → 1.5b server call sites (business, admin, website)
   → 1.5c front-end call sites → 1.5d remove the alias layer (server + `shared/src/core/rbac.js`) + the grep test. Each one green before the next.
   `menu.test.js` compares old and new names through the alias layer: in 1.5d keep its "new names" half.

### Stage 1.6 (after 1.5)
Delete the `backend-core/src/lib/*`, `domain/*` and `modules/*` shims; retire the old role scripts; move `backend-core/test/setup-db.ts` to `platform/test`;
write `scripts/ops/RUN-P1-ROLES.cmd` (backup → preview → apply → `integrations:migrate` → `accounts:test`); fix `update.ps1` for squash-merged branches
(`git merge-base --is-ancestor` and `git branch -d` report a squash-merged branch as not merged: use `gh pr list --state merged --head <branch>`); close-out note.
The owner's helper scripts are still not in the repository: ask the owner to add `scripts/ops/`.

## Owner step that is safe now
After `RUN-UPDATE` (which applies the new migration), run `npm run integrations:migrate` once. It copies today's connection settings into the Integration
Center, opens no key, deletes nothing, and can be run again. Without it the Setup center shows "Not set up" for services that are in fact working.

## Decisions made in 1.3 and 1.4 (keep)
- Old settings rows stay the source for old readers; `platform/src/integrations/legacy.ts` syncs both ways for one release. A disconnected gateway is REMOVED from
  the old `payments` row (so eSewa's public test merchant still works locally), a paused one is written as `enabled: false`.
- A two-mode provider (eSewa, Khalti, Fonepay) is tested with its test details; live details are saved beside them only after a passing test and are swapped in by
  "Go live" after a read-only live probe. A change to a live connection is staged, tested, then applied.
- `adminJobs()` is unchanged (a test pins it); the health job is in `adminPlatformJobs()`.
- Typed settings: only NEW keys live in the store so far (`platform.revenueShare`, `platform.theme`, `platform.fieldDefs.*`, `business.profile`, `business.theme`).
  Business values are `AppSetting["t:<businessId>:<key>"]`. `workspace.settings.read` does not exist as a permission; business settings use `workspace.settings.update`.
- Revenue report sources: `invoices` (status paid, by `paid_at` in Nepal time) and `payout_items` (`gross`, `fee`, `collected_on`), whole rupees × 100.

## Open follow-ups (not blocking)
From 1.2: robot-check widget on "Try the demo"; support session shows owner buttons (server refuses); demo businesses in Admin → Businesses for up to 24 hours.
From 1.3: business-side integration routes and screens, document review queue, provider webhooks, guide editor (all Phase 2 by the design).
From 1.4: old settings rows into the typed store; verification flow on the field builder; theme tokens applied to the panels (Phase 4); partner share stored
per payment (two columns); font library and logo upload.

## How this sandbox works (for the builder)
- The Prisma engine cannot be downloaded here: no `prisma generate`, no database tests, local `tsc` shows hundreds of unrelated errors. **CI is the first real run**
  (about 6 minutes). Front-end tests, lint, `gen:permissions`, `check:manifests`, `check:boundaries`, `check:schema` and `npm run build` run locally.
- A migration is written by hand to match `schema.prisma` (the 1.3 migration passed CI's `migrate diff` first time: copy its style).
- A pure platform test runs locally with a throw-away vitest config inside the repo that lists only that file.
- This repository uses zod 4: a schema with `superRefine` is still a `ZodObject` (`.shape`, no `.innerType()`).
