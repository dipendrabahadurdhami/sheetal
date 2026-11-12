# CHANGES P1-S5b (roadmap stage 1.5, part 2: only the new permission names are understood)

One builder. Branch `phase-1/P1-S5b-alias-layer-off`. No schema change, no migration, no new npm package. The owner said yes to the role rewrite on 12 Nov 2026.

## The one thing to know
After this update the servers and the screens understand ONLY the new permission names. Roles stored in old names give no access until the rewrite has run:
**after `RUN-UPDATE`, run `.\scripts\ops\RUN-P1-ROLES.cmd` before starting the servers.** Owners (`*`) are never affected.

## What changed and why
| Part | Files | What |
|---|---|---|
| Resolver | `platform/src/tenancy/perms.ts` (new), `aliases.ts` (deleted), `context.ts`, `catalog.ts` | `hasPerm` = `*`, or the exact manifest name (with or without `:scope`), or several names joined with `+`. No old name is resolved in either direction. `toGrants` no longer converts old names. |
| Staff roles | `platform/src/tenancy/staff-roles.ts` (new), `context.ts`, `notify/index.ts`, `backend-core/src/domain/permissions.ts` | Staff permissions come from `PLATFORM_ROLE_TEMPLATES_V2` (the platform manifest) in one place. |
| Built-in roles | `backend-core/src/domain/permissions.ts`, `shared/src/core/rbac.js` | `roleTemplatesFor()` gives the manifests' grants with scopes (`ROLE_TEMPLATES_V2`), so a new business stores new names from its first day. |
| Role saving | `business/backend/src/modules/team/routes.ts` | A role is saved in the manifests' names only; an old name is answered as an unknown permission. `permissions` in `GET /team` lists the new ids. |
| Screens | `shared/src/core/rbac.js`, `shared/src/components/RoleEditor.jsx`, `admin/frontend/src/live.js`, `shared/src/demo/demo.js` (sample data version 19) | No alias code. Permission groups and labels come from the catalog. The old role editor (sample workspace, staff roles) works on the new names and keeps a grant's scope. |
| Rewrite script | `backend-core/scripts/rewrite-role-perms.mjs`, `npm run roles:new-names` | Keeps its own copy of the pre-1.5 rule (it must read old lists to prove nobody gains or loses) and no longer loads the screens' code. |
| Runner | `scripts/ops/RUN-P1-ROLES.cmd`, `scripts/ops/p1-roles.ps1` | Backup → preview → rewrite after typing YES → check nothing is left → `integrations:migrate` → `accounts:test`. Report on the Desktop. |
| Retired | `backend-core/scripts/{agreements,expenses,people,rentals}-roles.ts` and their four npm commands | They patched roles with old names. Built-in roles now come from the manifests. |
| Guard | `packages/config/src/no-old-names.test.js`, `scripts/perm-names.mjs` | No permission check may name an old permission; strings that only look like one are a pinned list; nothing at run time reads the legacy tables. |

## Proof that nobody gained or lost access
- `backend-core/test/permissions-moved.test.ts`: against the FROZEN old code (`permissions-oracle.ts`, untouched): for every built-in role of every business type and
  every staff role, and every old name, the old code's answer equals today's answer for today's role and the new form of the check. Server and screens.
- `packages/config/src/new-names.test.js`: the same from the legacy data tables.
- `backend-core/test/access-tables.test.ts`: the rewrite script on a database (unchanged cases), now fed from the frozen old code.

## Tests that changed, and why (the team rule: old tests pass unchanged, unless the thing they pin ends on purpose)
| Test | Change | Reason |
|---|---|---|
| `backend-core/test/permissions-unchanged.test.ts` | replaced by `permissions-moved.test.ts` | It pinned "the lists are still the old names". They no longer are, by design. The oracle it used is kept and now proves equal access. |
| `backend-core/test/permissions-alias.test.ts` | deleted | It tested the alias layer, which is removed. |
| `platform/test/tenancy-context.test.ts` | 2 alias cases became "old names are not understood"; staff and deny-list cases use new names | Same subjects, new rule. |
| `backend-core/test/access-tables.test.ts` | old-name roles and the old rule come from the oracle and the script itself | The screens no longer provide old-name templates. What each case proves is unchanged. |
| `platform/test/{notify,sessions,support-and-catalog}.test.ts`, `business/backend/test/{tenancy,team,reviews-kernel,expenses-kernel,rentals-kernel}.test.ts`, `backend-core/test/{domain,permissions-worlds}.test.ts` | role lists and checks written in new names (by the same table) | They built roles or checks with old names. |
| `packages/config/src/{menu,new-names}.test.js` | compare old data with the new rule directly | They compared through the alias layer. |

## Old names that remain, on purpose (data, never read at run time)
`platform/src/tenancy/legacy-v1.ts` and the `LEGACY_*` exports of the generated files (the rewrite script, `check-manifests` and the proofs read them),
`backend-core/test/permissions-oracle.ts` (frozen), `roles.perms_v1` (the backup column).
