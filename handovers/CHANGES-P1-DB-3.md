# CHANGES — P1-DB-3 (Database): access tables, role-permission rewrite script

Branch: `phase-1/P1-DB-3-access-tables`. Everything here is a FULL file at its repo path. Nothing was dropped or renamed, no rows are inserted by the migration.

## 1. What changed

| File | New / changed | What |
|---|---|---|
| `backend-core/prisma/schema.prisma` | changed | `Role.permsV1`; models `ApprovalRule`, `ApprovalRequest`, `ImpersonationSession`; back-relations on `Tenant` and `User` (96 models now) |
| `backend-core/prisma/migrations/20261112090000_access_tables/migration.sql` | new | additive: 1 column, 3 tables, indexes, FKs, 1 CHECK |
| `backend-core/scripts/rewrite-role-perms.mjs` | new | the rewrite of `Role.perms` (NOT a migration): `--dry-run` (default), `--apply`, `--restore` |
| `backend-core/scripts/check-branch-links.mjs` | changed | new report section (d): owners that still carry a branch list; exit code unchanged |
| `backend-core/test/access-tables.test.ts` | new | 22 tests (migration, rule agreement, rewrite on a database, owners report) |

## 2. Decisions

**Status as a text CHECK, not a Postgres enum** (`approval_requests.status`). The seven values (`pending, approved, executed, failed, rejected, cancelled, expired`) are the state machine of ACCESS.md 9.3 and BE-7 may well add one (e.g. `escalated`). Adding a value to a Postgres enum is a migration that cannot run inside a transaction on older versions and can never be undone cleanly; changing a CHECK is one `DROP/ADD CONSTRAINT`. The column is `String @default("pending")` in Prisma, the constraint is in the SQL (Prisma cannot see it, so `migrate diff` stays empty). A test inserts a bad value and expects the error.

**Foreign keys**
- `approval_rules.tenant_id`, `approval_requests.tenant_id` -> `tenants` **ON DELETE CASCADE** (workspace data goes with the business, like the other workspace tables).
- `impersonation_sessions.staff_id` -> `users` **ON DELETE RESTRICT**: the trail must survive, so a staff user who has sessions cannot be deleted (suspend them instead).
- `impersonation_sessions.tenant_id` (nullable) -> `tenants` **ON DELETE SET NULL**: when a business is deleted the session row stays, only the link is cleared. **Open question for the Lead:** if you prefer the business NAME to stay on the trail after deletion, BE-10 should copy it into the `AuditLog` entry it writes at start; I did not add a name column because ACCESS.md 12 does not list one.
- **No FK** on `approval_requests.branch_id` (label only, stated in the model comment and the migration, same rule as `EventOutbox`), nor on `maker_id` / `checker_id` (they must survive removal of a person, the same way audit rows do).

**Money** is paisa as `BigInt` (`threshold_paisa`, `amount_paisa`), as everywhere.

**Indexes:** unique `(tenant_id, action)` on rules; inbox `(tenant_id, status, created_at)` and expiry sweep `(status, expires_at)` on requests; `(tenant_id, ended_at)` and `(staff_id, ended_at)` on sessions (active sessions of a business / of a staff member). Not added on purpose, BE-7 can add them when it has real queries: "my requests" by maker, pending-by-resource.

## 3. The rewrite script

`node backend-core/scripts/rewrite-role-perms.mjs [--dry-run | --apply | --restore [--force]] [--verbose] [--business=ID[,ID]]`

- Plain Node plus the installed `@prisma/client`; `DATABASE_URL` from the shell, else `backend-core/.env`. Each mode is one transaction (all or nothing). `--business=` limits it to some businesses (try one first).
- Rewrites every `Role.perms` (system and custom) with `LEGACY_ALIASES` **read from `platform/src/tenancy/permissions.generated.ts`** (never copied; a test compares it with the TypeScript import). `"*"` stays `"*"`. Already-new names are kept as written. Unknown names are kept and listed. The scope suffix is the manifest default, except the Lead rule: `leads.view`+`leads.assign` -> `crm.lead.read:branch` + `crm.lead.assign:branch`; `leads.view` alone -> `crm.lead.read:own`.
- `perms_v1` is written only when empty, so a second `--apply` never overwrites the first backup. `--restore` copies it back.
- **Proof** for every changed role: for every old name and every new business name, `hasPerm(before)` vs `hasPerm(after)`, for BOTH the server rule (the same rule as `platform/src/tenancy/aliases.ts`) and the screens' rule (`shared/src/core/rbac.js`, loaded from the file). Every difference is printed with business, role and name. A **loss**, a **gain not on the allow-list** or a **server/screens disagreement** makes `--apply` (and the dry run) exit 1 and write nothing.
- After writing, the script re-reads in the same transaction and fails (rolls back) if a saved list differs or a second rewrite would change it. Ends with `Summary:` and `PASS`/`FAIL`.
- `--restore` refuses a role edited after the rewrite (its list is neither the backup nor the rewrite of it) unless `--force`. Its proof output is information only (restoring naturally "loses" the gain below).

### The allow-list (for your review)
```
ALLOWED_WIDENING = team.view, invoices.view, people.view, rentals.view, expenses.view
```
These are the only five names that can ever gain, found by computing every pair (old view-name X, held old name Y) where X's new names are a subset of Y's. The old app has `team.manage` WITHOUT `team.view`; the new names split `team.manage` into read/invite/update/remove, and `team.view` is the same `workspace.team.read` as one of them, so a role that holds `team.manage` can now also answer "yes" to the old name `team.view`. That is the case you asked me to explain: it is harmless in practice (to manage a team you must already read it, and the old screens showed the Team page to a manage-only role anyway) and cannot be removed without taking `workspace.team.read` from the role. The four other pairs are the same shape: `rentals.view`<`rentals.manage`, `people.view`<`people.manage`, `invoices.view`<`invoices.create`, `expenses.view`<`expenses.manage`. Anything else gaining is blocked. **Narrowing is never allowed.**

The proof compares NAMES, not data: `leads.view` alone becoming `crm.lead.read:own` narrows which leads that person sees (by your decision), the name check still passes.

### What the real script printed (scratch PostgreSQL, 4 roles, copy of the real files)
```
staff [system]  4 names -> 7 (branch 7) ; lv [custom] 1 -> 1 (own 1) ; tm [custom] 2 -> 6
GAINS tm: team.view false -> true (allowed: the role already holds the matching 'manage' permission)
Summary: 4 role(s), 3 rewritten, 1 unchanged; 0 lost, 1 gained (1 allowed), 0 server/screens disagreements
PASS: done
```
Second `--apply`: `0 rewritten, 4 unchanged`, PASS. `--restore`: exact old lists back (compared byte for byte). Unknown flag: usage text, exit 1.

## 4. Owners report
`check-branch-links.mjs` section (d) lists owners (role holds `*`) whose membership still has a name list, the limited flag, or link rows. Report only; the code already treats owners as all branches. Invite rows for owners are not covered (a pending invite for an owner is rare; say if you want it).

## 5. Tests and evidence
22 new tests in `backend-core/test/access-tables.test.ts`, all inside a rolled-back transaction:
- migration: column, 3 tables, PKs/unique/indexes, FK targets and ON DELETE rules, CHECK rejects a bad status, no rows inserted, the trail survives a tenant delete and a staff delete is refused;
- the script's rule equals `aliases.ts` and `rbac.js` on every template role of the 5 business types, every old name, every new name (with scopes) and 200 seeded random mixes; maps equal the TypeScript imports; rewrite is idempotent;
- fixture: one business per type with its template roles + custom roles (team.manage without team.view; `leads.view` only; view+assign; half-moved; unknown name): after `--apply` only the allowed gain appears, `perms_v1` holds the old list, second apply changes nothing, `--restore` returns exact lists, restore refuses an edited role, `--business=` is respected, a lost name / a non-allowed gain / a server-screens disagreement each exit 1 and write nothing;
- owners report finds a planted owner with a list, with link rows, with the limited flag, and skips a clean owner and a limited non-owner.

**Sabotage (done once, then undone):** in `rewritePerms` I changed `scope = hasAssign ? "branch" : "own"` to `... : "branch"`. Result: **2 failed | 20 passed** (`applies the Lead's leads rule` and the `--apply` test: `expected ['crm.lead.read:branch'] to deeply equal ['crm.lead.read:own']`). Second try: `put(n, scope)` -> `put(n, null)` (scopes dropped): **2 failed | 20 passed**. File restored (byte-identical to the delivered one); suite green again: **41 passed** (22 new + 19 from DB-2).

## 6. What I could NOT run (be honest)
- `npx prisma validate`, `prisma generate`, `prisma migrate diff` and `prisma migrate deploy`: the Prisma engines cannot be downloaded in my workspace (blocked). The migration SQL is written in Prisma's own output style by hand. **CI is the first real run of `migrate diff --exit-code`**; if it shows a difference, the fix is in the SQL, send it back.
- `npm run check` and the repo's own `setup-db.ts`: not run. I ran the tests on a real PostgreSQL (embedded, version 17) with the old tables created by hand, both migrations applied, a stand-in for `@sheetal/config/permissions` built from the generated file, and a small pg-backed stand-in for `@prisma/client`. The SQL, the script and the tests are real; the Prisma client layer is the stand-in.
- `scripts/check-manifests.mjs`: cannot run here (`scripts/lib/generate.mjs` is not in the zip). `check-schema-ownership.mjs` ran: `96 models, each has exactly one valid @app tag.`

## 7. Lines for the Lead (not mine to edit)
1. `apps/workspace/app.manifest.ts`, in `models: [...]` after `"InviteBranch",` (or at the end): add `"ApprovalRule",` and `"ApprovalRequest",`.
2. `platform/src/tenancy/platform.manifest.ts`, in `models: [...]` after `"EventDelivery",`: add `"ImpersonationSession",`.
3. `scripts/check-manifests.mjs` line 19: `const BRANCH_LABEL_ONLY = new Set(["EventOutbox", "MembershipBranch", "InviteBranch", "ApprovalRequest"]);` (ApprovalRequest has `branchId` as a label only; do NOT add it to `branchOwned`).
4. `docs/architecture/MODEL-OWNERS.md`: platform row add `ImpersonationSession`; workspace row add `ApprovalRule, ApprovalRequest`; add to the notes column "ApprovalRequest (`branchId` is only a label: leave it out of `branchOwned`)"; `Total: 96 models, each in exactly one row (... ApprovalRule, ApprovalRequest, ImpersonationSession added by P1-DB-3).`

## 8. PowerShell (from the repo root)
```powershell
git checkout -b phase-1/P1-DB-3-access-tables
# copy the files of this zip over the repo, keeping the folders, then:
npm install
npx prisma validate --schema backend-core/prisma/schema.prisma
npx prisma migrate diff --from-migrations backend-core/prisma/migrations --to-schema-datamodel backend-core/prisma/schema.prisma --shadow-database-url "postgresql://USER:PASSWORD@127.0.0.1:5432/shadow_empty" --exit-code
npm run db:deploy -w @sheetal/backend-core
npm run db:generate -w @sheetal/backend-core
npm run check
node backend-core/scripts/rewrite-role-perms.mjs
node backend-core/scripts/check-branch-links.mjs
```
`migrate diff` must print `No difference detected` / exit 0. The last two are safe (the first is a dry run, nothing is written). The rewrite script needs `npm install` first (it loads `shared/src/core/rbac.js`); without it, it stops with a clear message and writes nothing.

## 9. Real data
Do NOT run `--apply` on the real database until QA and the Lead approve. Then: take a backup first (`pg_dump -Fc`), run the dry run, read the GAINS lines, try `--apply --business=<one id>`, then all. `--restore` undoes it while no role was edited in between.

## Lead, after QA (11 Nov)
- Section 7 lines applied: workspace manifest (`ApprovalRule`, `ApprovalRequest`), platform manifest (`ImpersonationSession`), `BRANCH_LABEL_ONLY` + `ApprovalRequest`, MODEL-OWNERS.md (96 models).
- QA fix 2: `--restore` now empties `perms_v1` for the roles it restores; the restore test checks it.
- QA fix 3, call-site audit (`git grep -nE "perms\.(includes|some|has|every|indexOf)|\.perms\b|ANY\(.*perms"`, tests and docs left out). Every hit that tests a NAME:
  | Where | Verdict |
  |---|---|
  | `platform/src/tenancy/{aliases,context,works-at,branch-links}.ts`, `platform/src/notify`, `shared/src/core/rbac.js`, `business/backend/src/modules/access.ts`, `listings/routes.ts`, `reviews/checkups.ts:111`, `website/backend/.../board`, `.../posting` | alias-aware (`hasPerm` / `can`) |
  | `business/backend/src/modules/forms/routes.ts:77` (who may get form leads) | **fixed**: now `hasPerm` |
  | `business/backend/src/modules/reviews/checkups.ts:59` (default check-up level) | **fixed**: now `hasPerm` |
  | every `perms.includes("*")` (owner tests: billing, people, support, team, BusinessApp, Structure, TeamPanel, RoleEditor, check-branch-links) | safe: `"*"` is never rewritten |
  | `admin/frontend/src/live.js:61` | not affected: staff permissions come from code, not from the `roles` table |
  | `backend-core/scripts/{agreements,expenses,people,rentals}-roles.ts` | old one-off scripts that add OLD names; must not be run after `--apply` (they would add old names next to new ones). Retire them in the close-out. |
  | **`shared/src/components/RoleEditor.jsx` (+ `permCount` in rbac.js) and `team/routes.ts` `checkPerms` (`businessPermsFor` = old names)** | **BLOCKER for `--apply`**: after the rewrite the role screen would show no ticks, and saving a role would be refused ("Unknown permissions") or drop the new names. The real `--apply` waits for the role screen and `checkPerms` on the new names (P1-FE-4 + its backend part). |
- QA fix 4 (guarded runner) is written with the real apply, after FE-4.
