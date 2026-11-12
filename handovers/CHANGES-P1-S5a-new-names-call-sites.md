# CHANGES P1-S5a (roadmap stage 1.5, part 1: the call sites use the new permission names)

One builder. Branch `phase-1/P1-S5a-new-names-admin`. No schema change. **No stored data is changed. The alias layer is still on**, so roles stored in old names
keep working exactly as before, and no old test was changed.

## What changed and why
| Part | Files | What |
|---|---|---|
| "All of these" in one check | `platform/src/tenancy/aliases.ts`, `platform/src/tenancy/context.ts`, `shared/src/core/rbac.js` | A check may join names with `+` (`"platform.plan.read+platform.plan.update"`): all are needed. This is how a check that used one old bundle name is written in new names without changing who passes. |
| Safety net | `packages/config/src/new-names.test.js`, `platform/test/perm-combos.test.ts` | For every role template of every business type and every staff role, and every old name: the old check and the new check give the same answer, with the role stored in old names (today) and in new names (after the role rewrite). |
| The tool | `scripts/perm-names.mjs` | `--report` lists every use of an old name that is left; `--apply <area>` rewrites the uses that sit in a known permission-check shape. It never touches tests, role templates, audit actions or translation keys. |
| Call sites | 49 files under `admin/`, `business/`, `apps/rentals`, `backend-core/src/domain`, `website/backend`, `platform/src/notify` | About 660 checks now name the new permissions: 414 by the tool, the rest line by line with the same table. |

## What still uses old names, on purpose
- Role templates (`platform/src/tenancy/legacy-v1.ts`, read by `shared/src/core/rbac.js` and `backend-core/src/domain/permissions.ts`) and the role scripts: they create and rewrite STORED roles. They change together with the alias layer (part 2).
- `admin/frontend/src/live.js` `has("tenants.view" …)`: a raw look at the staff member's stored permissions, which are still old names. It changes in part 2.
- Tests (345 uses): they keep proving that old names still work while the alias layer is on.
- Text that only looks like a permission: audit actions (`"settings.platform"`, `"pos.void"`), translation keys (`t("pos.restaurant")`, `t("content.publish")`), comments.

## Part 2 (needs the owner's yes, because it rewrites stored roles)
Templates in new names with scopes → the real role rewrite on every database (`db:backup` first; `Role.permsV1` keeps the old values) → remove the alias layer
(server and `rbac.js`) → the grep test that no old name is left → the tests that assert stored old names are updated and listed.
