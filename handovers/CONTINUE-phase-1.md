# CONTINUE Phase 1 (rest): where it stands (12 Nov 2026, Nepal time)

Phase 1 (rest) is not finished. This note is the stop at a merged, green stage boundary. The next step is stage 1.5 part 2, after the owner says yes to the role rewrite.

## Done (merged, CI green on main)
| Stage | PR | State |
|---|---|---|
| 1.2 Screens | #20 | merged. Notes: `CHANGES-P1-S2-screens.md`. |
| 1.3 Integration Center | #22 (`1a607c4`) | merged. 5 new tables (additive migration `20261112110000_integration_center`), bound vault (v2), framework, 6 adapters + 17 shells, two-way sync with the old settings rows, `npm run integrations:migrate`, admin screens. Notes: `CHANGES-P1-S3-integration-center.md`. |
| 1.4 Settings | #23 (`7c8e0f9`) | merged. Typed settings store (no schema change), revenue share + report, field builder, theme tokens, admin screens. Notes: `CHANGES-P1-S4-settings.md`. |

Tests on main: 1132 (was 1013 at the start of Phase 1 rest). PR #25 fixed a timing fault in the support-session audit row that made the check on main fail twice.

## Stage 1.5: part 1 is merged, part 2 waits for the owner's yes

**Part 1 (merged, PR #26):** every permission CHECK names the new permissions (about 660 places in 49 files). A check may join names with `+` (all needed), so a
check that used one old bundle name keeps the same meaning. Safety-net tests prove every role template and staff role answers every check the same way, before and
after the role rewrite. Tool and report: `node scripts/perm-names.mjs --report`. The alias layer is still ON; no stored data changed; no old test changed.
Notes: `CHANGES-P1-S5a-new-names-call-sites.md`.

**Part 2 (not started; it rewrites stored roles, so it needs the owner's yes first):**
1. Role templates create new names with scopes (`platform/src/tenancy/legacy-v1.ts` and its readers `shared/src/core/rbac.js`, `backend-core/src/domain/permissions.ts`).
2. The real role rewrite on every database: `npm run db:backup`, then `npm run roles:new-names -- --apply` (`Role.permsV1` keeps the old values).
   It must run in the same update as step 3, before the servers start: this is what `scripts/ops/RUN-P1-ROLES.cmd` (stage 1.6) is for.
3. Remove the alias layer (`platform/src/tenancy/aliases.ts` old-name branches, the copy in `shared/src/core/rbac.js`) and add the grep test that no old name
   is left outside the rewrite script and its backup column.
4. `admin/frontend/src/live.js` `has("tenants.view" …)` reads stored staff permissions raw: switch it with the staff roles.
5. Tests: about 345 uses of old names in tests. Those that assert what a role STORES change with step 1; list each in the CHANGES file with the reason.
   `packages/config/src/menu.test.js` and `new-names.test.js` compare old and new through the alias layer: keep their "new names" halves.
6. Website and business code must never write a `platform.*` permission (`backend-core/test/permissions-worlds.test.ts`): name the staff work with
   `STAFF_FOR` in `platform/src/notify/index.ts`.

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
