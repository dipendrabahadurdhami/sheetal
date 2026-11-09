# Folders and the move plan

Status: design for Phase 1 (task P1-ARCH-1). Nothing here is built yet.
Goal: move to `platform/` + `apps/` + `surfaces/` + `packages/` **without one broken build on the way**. Every step below ends
with a green `npm run check`. All commands are for PowerShell, from the repo root `C:\Users\USER\Desktop\sheetal`.

---

## 1. Where we are

```
backend-core/   Prisma schema + migrations, domain/ (permissions, billing, plans, addons, branches, expenses, money…),
                lib/ (db, errors, vault, secrets, payments, notify, files, photos, ai…), modules/ (auth, accounts, notifications), app.ts, config.ts
business/       backend/ (src/modules/<area>/routes.ts, src/modules/access.ts, src/app.ts)   frontend/ (pages/Live*.jsx, api.js, live.js)
admin/          backend/ (src/modules/*)   frontend/ (pages/*)
website/        backend/   frontend/
shared/         src/core (ui, rbac, theme, palette, contrast, store, router…), src/components (Crud), src/data, src/demo, src/layout, src/styles
mail-server/
```

npm workspaces today (root `package.json`): `shared`, `website/frontend`, `admin/frontend`, `business/frontend`,
`backend-core`, `website/backend`, `business/backend`, `admin/backend`, `mail-server`. Package names include
`@sheetal/backend-core`, `@sheetal/shared`, `@sheetal/website-api`, `@sheetal/business-api`, `@sheetal/admin-api`,
`@sheetal/website`, `@sheetal/business`, `@sheetal/admin`, `@sheetal/mail-server`. Servers import from each other by package
subpath, for example `@sheetal/backend-core/lib/db`.

---

## 2. Where we are going

```
sheetal/
├─ platform/                          npm package  @sheetal/platform  (server code every app uses)
│  ├─ package.json                    "exports": same subpath pattern as backend-core/package.json (copy it)
│  └─ src/
│     ├─ core/            errors.ts  money.ts  context.ts  repository.ts  service.ts  controller.ts  events.ts  validation.ts
│     │                   manifest.ts (the AppManifest type)  apps.ts (registry)  config.ts  reports.ts  testing/
│     ├─ db/              client.ts (createDb, dbOf, pingDb)
│     ├─ auth/            sessions.ts  secrets.ts (hash, tokens)  vault.ts  passwords.ts
│     ├─ tenancy/         context.ts (build BusinessContext/StaffContext)  branches.ts  workspace.ts (createWorkspace, roles)
│     │                   permissions.generated.ts  platform.manifest.ts  impersonation.ts  approvals.ts  seats.ts
│     ├─ billing/         plans.ts  billing.ts  addons.ts  entitlements.ts (NEW: builds Entitlements)  revenue.ts (Phase 3)
│     ├─ payments/        esewa.ts  khalti.ts  fonepay.ts  (the code of lib/payments.ts, split by provider)
│     ├─ integrations/    integration.ts (the interface)  registry.ts  connection.ts  providers/<id>.ts  guides.ts
│     ├─ settings/        store.ts (typed settings)  fields.ts (field builder)  platform-settings.ts
│     ├─ notifications/   notify.ts  routes.ts
│     ├─ files/           private.ts  photos.ts  storage.ts
│     ├─ audit/           audit.ts
│     ├─ search/          (empty in Phase 1)
│     ├─ ai/              client.ts (lib/ai.ts)  credits.ts
│     └─ jobs/            registry.ts  dispatcher.ts  (timers today, BullMQ later)
├─ apps/
│  ├─ expenses/           @sheetal/app-expenses     app.manifest.ts  backend/  frontend/
│  ├─ reviews/            @sheetal/app-reviews
│  ├─ workspace/          manifest only in Phase 1
│  └─ hotel/ pos/ projects/ collections/ listings/ crm/ rentals/ investments/ agreements/ people/ invoicing/   manifest only in Phase 1
├─ surfaces/                          (renamed last, see §8)
│  ├─ website/            Next.js (separate decision, not Phase 1)
│  ├─ business/           the one shell that loads the apps a business has
│  └─ admin/
├─ packages/
│  ├─ ui/                 @sheetal/ui      CrudPage, DataTable, FormBuilder, Drawer, primitives (Button, Field…), theme
│  ├─ sdk/                @sheetal/sdk     the API client (bizApi/adminApi), hooks, error type
│  └─ config/             @sheetal/config  generated permissions, colour maths, i18n keys of the kernel, constants both sides read
├─ backend-core/          shrinks to: prisma/ (schema, migrations, seed), scripts, shims   (Phase 1 end: see §7 step 14)
├─ shared/                shrinks to shims and the sample-data folder until the demo business replaces it (FRONTEND-KIT.md §7)
├─ mail-server/
├─ scripts/               + gen-permissions.mjs  check-manifests.mjs  check-boundaries.mjs  check-schema-ownership.mjs
└─ docs/architecture/     these seven files
```

Inside one app, the same shape everywhere:

```
apps/expenses/
  app.manifest.ts
  package.json                         @sheetal/app-expenses   exports: "./backend", "./frontend", "./manifest"
  backend/
    index.ts                           export { expenseRoutes } ; export { registerEvents } ; export { registerJobs }
    <name>.repository.ts  <name>.service.ts  <name>.controller.ts  <name>.presenter.ts
    routes.ts  jobs.ts  events.ts
    test/
  frontend/
    index.js                           export { routes, menu }  (what the shell loads)
    pages/  components/  hooks/  api.js  fields.js
```

---

## 3. Rules about who may import whom

Enforced by `scripts/check-boundaries.mjs` (plain Node, reads import lines, no new package) and run in `npm run check`.

| From → To | Allowed? |
|---|---|
| `apps/*` → `platform`, `packages` | yes |
| `apps/a` → `apps/b` | **no** (use events, or `dependencies.reads` with a `ProfitSource`-style interface) |
| `platform` → `apps` | **no** (it learns about apps only through the generated registry) |
| `surfaces/*` → `apps/*/frontend`, `packages`, `@sheetal/sdk` | yes, **only** through the generated `apps.generated.js` registry |
| `packages/*` → `platform` | **no** (packages are browser-safe) |
| anything → `backend-core/*` or `shared/*` | allowed **only** while a step below says so; after the step it is a lint error |

The shims (§5) are the only code allowed to bridge the old and new paths.

---

## 4. Import names and aliases

No `tsconfig` `paths` and no Vite alias (they would have to be kept in step in two places, and the repo already works with
workspace subpaths). The new packages use the **same `exports` pattern** as `backend-core/package.json` (I was not given that
file: copy its `exports` block exactly, changing only the folder). So:

```ts
import { AppError } from "@sheetal/platform/core/errors";
import { BusinessContext } from "@sheetal/platform/core/context";
import expensesManifest from "@sheetal/app-expenses/manifest";
import { expenseRoutes } from "@sheetal/app-expenses/backend";
```
```js
import { Button, CrudPage } from "@sheetal/ui";
import { bizApi } from "@sheetal/sdk";
import { can, filterNav } from "@sheetal/config/permissions";
```

Package names: `@sheetal/platform`, `@sheetal/ui`, `@sheetal/sdk`, `@sheetal/config`, `@sheetal/app-<id>`.
**Existing package names never change** (`@sheetal/business-api` etc.), so every `-w @sheetal/…` in the root scripts keeps working even
after folders are renamed in §8.

---

## 5. Shims: how old imports keep working

A shim is a file left at the **old path** that only re-exports the new one. The code that moved is not copied. Example, after
step 2:

```ts
// backend-core/src/lib/errors.ts
// Moved to platform/src/core/errors.ts (Phase 1). This file only re-exports it so old imports keep working.
// Rules: no new code imports this path (lint rule); it is deleted at the end of Phase 2.
export * from "@sheetal/platform/core/errors";
```

Why re-export and not copy: `AppError` must be **one class**, or `error instanceof AppError` in the error handler would fail for
errors made through the other copy.

An ESLint `no-restricted-imports` rule (a built-in ESLint rule, no new package) is added per shim when its step finishes, with the
message "Moved: use @sheetal/platform/core/errors". The rule applies to all code except the shim file itself.

The Prisma schema stays in `backend-core/prisma/` until step 14, so `npm run db:migrate`, `db:seed`, `prisma generate` and the
test database setup (`backend-core/test/setup-db.ts`) do not move during Phase 1. Models are tagged with
`/// @app expenses` (one line above each model) and the manifest lists its `models`; `scripts/check-schema-ownership.mjs`
compares the two. One `schema.prisma` file stays (TEAM-RULES rule 2). The alternative, Prisma's multi-file schema with one file per
app, is cleaner but breaks "edit the newest whole file" for the DB specialist; revisit it in Phase 2.

---

## 6. Where every file I was given goes

"stays" = not moved in Phase 1 (it is edited in place when a step needs it).

### 6.1 Server

| Today | Goes to | Step | Leaves a shim? |
|---|---|---|---|
| `backend-core/src/lib/errors.ts` | `platform/src/core/errors.ts` | 2 | yes |
| `backend-core/src/lib/db.ts` | `platform/src/db/client.ts` | 2 | yes |
| `backend-core/src/config.ts` | `platform/src/core/config.ts` | 2 | yes |
| `backend-core/src/lib/vault.ts` | `platform/src/auth/vault.ts` | 2 | yes |
| `backend-core/src/lib/secrets.ts` | `platform/src/auth/secrets.ts` | 2 | yes |
| `backend-core/src/app.ts` (`buildBaseApp`) | stays (it imports auth, mailer, storage, which move in Phase 2) | – | – |
| `backend-core/src/domain/permissions.ts` | replaced by `platform/src/tenancy/permissions.generated.ts`; old file becomes a shim exporting the same names (`BUSINESS_TYPES`, `BusinessType`, `BUSINESS_PERMS`, `PLATFORM_PERMS`, `roleTemplatesFor`, `PLATFORM_ROLES`, `hasPerm`, `businessPermsFor`) | 3 | yes |
| `backend-core/src/domain/branches.ts` | `platform/src/tenancy/branches.ts` (ids, not names) | 5 | yes |
| `backend-core/src/modules/accounts/workspace.ts` | `platform/src/tenancy/workspace.ts` | 5 | yes |
| `business/backend/src/modules/access.ts` | new implementation in `platform/src/tenancy/context.ts`; the old file becomes an adapter that keeps the names `workspaceOf`, `branchView`, `inView`, `branchFor`, `branchesOf`, `Workspace`, `BranchView` | 5 | adapter |
| `backend-core/src/domain/plans.ts`, `billing.ts`, `addons.ts` | stay; `platform/src/billing/entitlements.ts` is new and wraps them (moved in Phase 3 with per-app pricing) | 5 | – |
| `backend-core/src/lib/payments.ts` | `platform/src/payments/{esewa,khalti,fonepay}.ts` and the Integration wrappers in `platform/src/integrations/providers/` | 12 | yes |
| `backend-core/src/domain/platform.ts` | `platform/src/settings/platform-settings.ts` (settings part) and `platform/src/integrations/legacy.ts` (the `integration.*` rows, until migrated) | 12 | yes |
| `backend-core/src/lib/ai.ts` *(not given)* | `platform/src/ai/client.ts` | 12 | yes |
| `backend-core/src/lib/notify.ts`, `modules/notifications` *(not given)* | `platform/src/notifications/` | 6 | yes |
| `backend-core/src/lib/files.ts`, `photos.ts`, `storage.ts` *(not given)* | `platform/src/files/` | 6 | yes |
| `backend-core/src/modules/auth/sessions.ts` *(not given)* | `platform/src/auth/sessions.ts` | 6 | yes |
| `backend-core/src/domain/expenses.ts` | `apps/expenses/backend/{profit,categories}.ts`; the constants and helpers other files import (`SHEETAL_METHOD`, `EXPENSE_*`, `profitRows`, …) stay re-exported from a shim | 7 | yes |
| `business/backend/src/modules/expenses/routes.ts` | split into `apps/expenses/backend/{repository,service,controller,presenter,routes,jobs}` | 7 | yes (`routes.ts` re-exports `expenseRoutes`, `startExpenseJob`) |
| `business/backend/src/modules/reviews/routes.ts` | `apps/reviews/backend/…` | 8 | yes |
| `business/backend/src/modules/reviews/checkups.ts` *(not given)* | stays (it is the listing check-up feature, not the Reviews app; the Lead confirms) | – | – |
| `business/backend/src/modules/team/routes.ts`, `branches/routes.ts` | stay in Phase 1 (edited for branch ids and new permission names); become `apps/workspace/backend` in Phase 2 | 4–5 | – |
| `admin/backend/src/modules/platform.ts` | stays; permission names and the integration part change in step 12 | 12 | – |
| `business/backend/src/app.ts` | stays; registers the app packages instead of importing their routes | 7–8 | – |
| `package.json` (root) | edited (§7 step 1 and step 3) | 1, 3 | – |

### 6.2 Screens

| Today | Goes to | Step | Shim |
|---|---|---|---|
| `shared/src/core/ui.jsx` | `packages/ui/src/primitives.jsx` | 9 | `shared/src/core/ui.jsx` = `export * from "@sheetal/ui"` |
| `shared/src/components/Crud.jsx` (`ViewDrawer`, `DeleteConfirm`, `useUndo`, `restoreAt`) | `packages/ui/src/crud/` | 9 | yes |
| `shared/src/core/rbac.js` | `packages/config/src/permissions.generated.js` (generated) | 3 | yes |
| `shared/src/core/contrast.js`, colour maths in `shared/src/core/palette.js` (`luminance`, `contrast`, `mix`, `shade`, `darkEnough`, `textOn`) | `packages/config/src/color.js` (pure, no DOM, also used by the server to validate brand colours); `palette.js` keeps `extractPalette`, `cleanLogo`, `brandTheme` and imports the maths | 9 | yes |
| `shared/src/core/theme.js` (light / dark / red / bars) | `packages/ui/src/theme/mode.js` | 9 | yes |
| `business/frontend/src/api.js` | `packages/sdk/src/client.js` (exports `bizApi`, `ApiError`, `setActiveTenant`, `setActiveBranch`, `fileToBase64`, `formatBytes`) | 9 | yes |
| `business/frontend/src/live.js` | stays (workspace loading); the Expenses/Reviews parts do not live here | – | – |
| `business/frontend/src/pages/LiveExpenses.jsx` | `apps/expenses/frontend/pages/ExpensesPage.jsx`, **rewritten** with `CrudPage` | 10 | none; file deleted |
| `business/frontend/src/pages/LiveReviews.jsx` | `apps/reviews/frontend/pages/ReviewsPage.jsx`, rewritten | 10 | none; file deleted |
| sample `Expenses` in `Sector.jsx` and the sample Reviews screen *(not given)* | deleted (FRONTEND-KIT.md §7) | 10 | – |
| `shared/src/data/integrations.js` | the catalog (`INTEGRATIONS`, `AI_PROVIDERS`, `emailDnsRecords`) moves to the server (`platform/src/integrations/registry.ts`) and is sent by `GET /integrations/catalog`; `seedIntegrations`/`stepsOf` (sample state) are deleted | 12 | – |
| `admin/frontend/src/pages/AdminIntegrations.jsx` | replaced by the Integration Center page (INTEGRATIONS.md §10) | 12 | – |

---

## 7. The steps, in order

Each step lists what changes, the exact check, and how to go back. **Do not start a step before the previous one is green.**
Work on a branch: `git checkout -b phase1-kernel`.

The checks use only commands that exist today:

```powershell
npm run check                                  # help --check, lint, typecheck and every test (the full gate)
npm run typecheck                              # TypeScript only, fast
npm run test -w @sheetal/business-api          # one package's tests (swap the name: @sheetal/backend-core, @sheetal/admin-api, @sheetal/website-api)
npx vitest run                                 # the root (front-end) tests
```

New check commands arrive with steps 1 and 3 and are then part of `npm run check`.

| # | Step | What changes | Specialist task | Tests after the step | Go back |
|---|---|---|---|---|---|
| 0 | **Baseline** | Nothing. `git checkout -b phase1-kernel`; `npm run check`; write down the number of passing tests; `git tag pre-phase1`. | Lead / OPS | all green | – |
| 1 | **Empty workspaces** | Create `platform/`, `packages/ui`, `packages/sdk`, `packages/config`, `apps/expenses`, `apps/reviews` with only `package.json` (+ `src/index` placeholder). Root `package.json` `workspaces` gets `"platform"`, `"packages/*"`, `"apps/*"`. Add scripts `gen:permissions`, `check:manifests`, `check:boundaries`, `check:schema` (they pass on empty input). `npm install`. Add the new script names to `scripts/help.mjs` (the `help --check` fails otherwise; file not given). | P1-OPS-1 | `npm run check` (same test count as step 0) | `git revert` the commit |
| 2 | **Core primitives** | Move `errors`, `db`, `config`, `vault`, `secrets` to `platform/src/…`; leave shims. Add new `money.ts`, `validation.ts`, `context.ts` (types), `repository.ts`, `service.ts`, `controller.ts`, `events.ts`, `testing/isolation.ts`. Add `no-restricted-imports` rules for the five shims. | P1-BE-1 | `npm run typecheck`; `npm run test -w @sheetal/backend-core` (the error handler and config tests must pass unchanged); new unit tests for `Money` (rounding, split, VAT) and a `BaseRepository` test on the temporary test database | revert |
| 3 | **Manifests and generated permissions** | Write the manifests (`workspace`, `platform`, `expenses`, `reviews`, and the declaration-only ones, APP-MANIFEST.md §8). Write `gen-permissions.mjs` and `check-manifests.mjs`. Generate `permissions.generated.ts/.js`. Replace the bodies of `domain/permissions.ts` and `shared/src/core/rbac.js` with shims over the generated files, keeping every exported name and **the old permission names** (the alias map of ACCESS.md §6.3 point 1 is added: `can`/`hasPerm` accept old or new names). `npm run check` now also runs `gen:permissions -- --check` and `check:manifests`. | P1-BE-2 | the old parity test `test/domain.test.ts` passes (both sides now come from the same file); new "role equivalence" test: for every business type, `roleTemplatesFor(type)` gives the same abilities as the old `TEMPLATES` (the old table is kept in the test as the oracle); `npm run check` | revert |
| 4 | **Database, additive** | One migration per DB task, **additive only**: kernel columns (`version`, `updatedBy`, `deletedAt`, `deletedBy`) and `amountPaisa` on `Expense`/`RecurringExpense`, `version` on `Review`; `EventOutbox`, `EventDelivery`; `allBranches` + `MembershipBranch` + `InviteBranch`; `Role.permsV1`; `ApprovalRule`, `ApprovalRequest`, `ImpersonationSession`; then the backfills (branch names → ids, `amountPaisa = amount × 100`, role rewrite with `permsV1` backup). `/// @app` tags on the models. | P1-DB-1 … P1-DB-3 | migration tests on a fixture database (the SQL checks in ACCESS.md §3.4 and §6.3); `npm run test -w @sheetal/backend-core`; then `npm run check` | do not run the next migration; the old columns are all still there, so the old code still works |
| 5 | **Tenancy context** | `platform/src/tenancy/context.ts` builds `BusinessContext` (session, `x-tenant-id`, `x-branch`, branch ids, permissions with scopes, entitlements built from today's plan). `access.ts` becomes an adapter returning the old `Workspace` shape from the new context, so **every module that is not moved yet keeps working**. Team, invite and branch routes write both names and ids (dual write) and read ids (ACCESS.md §3.4 step 3). Seats: re-activation check. | P1-BE-3 | `npm run test -w @sheetal/business-api` (all existing tests unchanged and green); new tests: four checks (ACCESS.md §13), branch rename without the `swap` loop, delete a branch keeps access consistent | revert (dual write keeps `scopes` correct) |
| 6 | **Jobs, events, notifications, files** | `platform/jobs` registry (the same timers, one place; `JOBS=off` still works); event dispatcher; move `notify`, files, sessions with shims. | P1-BE-4 | `npm run test -w @sheetal/business-api -w @sheetal/admin-api -w @sheetal/website-api`; dispatcher test (retry, once per handler) | revert |
| 7 | **Expenses on the kernel** | Create the app package (§2) and move/rewrite the code per KERNEL.md §10. **Order inside the step:** (a) move files unchanged and re-point imports, run the existing expenses tests; (b) introduce the repository/service/controller one class at a time, running the same tests after each; (c) switch the permission names to `expenses.*`; (d) turn on soft delete and paisa. `business/backend/src/app.ts` imports `expenseRoutes`/`startExpenseJob` from `@sheetal/app-expenses/backend`. Old route file becomes a shim. | P1-BE-5 | the **existing** expenses tests, untouched, must pass after (a), (b), (c) and (d): this is the "no change in behaviour" proof. Plus new: isolation, version conflict, soft delete hides rows, profit totals equal to before on a fixture, event written in the same transaction | revert the last sub-step |
| 8 | **Reviews on the kernel** | Same, KERNEL.md §10.7. | P1-BE-6 | existing reviews tests unchanged + isolation | revert |
| 9 | **Front-end packages** | `packages/ui` (move `ui.jsx`, `Crud.jsx`, `theme.js` with shims), `packages/sdk` (move `api.js`), `packages/config` (colour maths; generated permissions). Add `CrudPage`, `DataTable`, `FormBuilder` (FRONTEND-KIT.md). | P1-FE-1 | `npx vitest run`; `npm run lint`; open `/business`, `/admin`, `/` by hand: nothing looks different | revert |
| 10 | **Front-end Expenses and Reviews** | Rebuild both pages on `CrudPage`; delete `LiveExpenses.jsx`, `LiveReviews.jsx` and the sample copies; remove their paths from the `PREVIEW` list in `BusinessApp.jsx` (not given); demo business replaces the sample workspace (FRONTEND-KIT.md §7). | P1-FE-2 / P1-FE-3 | hand test script in CHANGES (add, edit, confirm draft, skip, recurring pause, profit CSV, receipt; reply to a review; each as owner, accountant, front desk; all branches vs one) | revert the page; the API did not change |
| 11 | **Menu from manifests** | The business shell builds its sidebar from `apps.generated.js` + `filterNav` for the apps that are on the kernel; the rest stays hard-coded until Phase 2. | P1-FE-4 | hand test: same menu as before for each business type | revert |
| 12 | **Integration Center and settings** | Implement INTEGRATIONS.md and SETTINGS.md in the order given there; move `payments.ts`, `platform.ts`, `ai.ts` with shims. Replace `AdminIntegrations.jsx`. | P1-DB-4, P1-BE-8, P1-BE-9, P1-FE-5, P1-FE-6 | one test per provider (fake fetch as `platform.ts` tests do), vault round trip, state machine table test | revert |
| 13 | **Switch the call sites** | `ws.can("old.name")` → `permissions.require("app.resource.action")` everywhere; then delete the alias layer; the grep test "no old permission name in `src/`" goes green. | P1-BE-10 | `npm run check` | revert (alias layer back) |
| 14 | **Close the phase** | Delete shims that nothing imports any more (lint shows none); optional: rename `backend-core` → keeps its name until the Phase 2 clean-up. **Folders `business/`, `admin/`, `website/` are NOT renamed in Phase 1** (§8). | P1-OPS-2 | `npm run check`; full hand test | – |

### Why this order

- Steps 1–3 only **add**. The first change to behaviour is step 7, and by then the context (step 5) and the permission
  layer (step 3) are already proven by the old tests.
- Database changes (step 4) are all additive and come before the code that needs them; the code reads the new columns only
  after the backfill.
- The old tests are the safety net. Where I say "unchanged", the specialist must not edit an existing assertion to make it pass.
  If one must change, stop and tell the Lead.

---

## 8. Renaming the surfaces (not in Phase 1)

`business/` → `surfaces/business/`, `admin/` → `surfaces/admin/`, `website/` → `surfaces/website/`. Not needed to meet the
Phase 1 goal (Expenses and Reviews on the kernel), and it touches Vite proxies, the `scripts/assemble.mjs` build helper,
`doctor.mjs`, and every document that mentions the paths. The website is also moving to Next.js (separate decision), which is a
rewrite rather than a move. So: **do the rename as its own task (P1-OPS-3) after Phase 1 is accepted**. The commands, ready:

```powershell
git mv business surfaces\business
git mv admin surfaces\admin
git mv website surfaces\website      # skip if the Next.js work has already replaced it
# then: root package.json "workspaces": replace "business/frontend" with "surfaces/business/frontend", and the same for admin, website, and the three */backend entries
npm install
npm run check
```

Package names do not change, so `-w @sheetal/business-api` and all scripts keep working. Update these by search-and-replace:
`scripts/assemble.mjs`, `scripts/doctor.mjs`, `scripts/backup.mjs`/`restore.mjs` if they hard-code the paths, `.env` locations in
`docs/local-testing.md`, and the root `tsconfig.json`/`eslint` globs (`qc` runs `eslint admin business website shared`).

---

## 9. The root `package.json` changes, exactly

Step 1:

```json
"workspaces": [
  "packages/*",
  "platform",
  "apps/*",
  "shared",
  "website/frontend",
  "admin/frontend",
  "business/frontend",
  "backend-core",
  "website/backend",
  "business/backend",
  "admin/backend",
  "mail-server"
]
```

Order matters a little: `packages/*` and `platform` first, so they are installed before the things that import them.

Steps 1 and 3, new scripts:

```json
"gen:permissions": "node scripts/gen-permissions.mjs",
"check:manifests": "node scripts/check-manifests.mjs",
"check:boundaries": "node scripts/check-boundaries.mjs",
"check:schema": "node scripts/check-schema-ownership.mjs",
"check": "node scripts/help.mjs --check && npm run gen:permissions -- --check && npm run check:manifests && npm run check:boundaries && npm run check:schema && npm run lint && npm run typecheck && npm run test"
```

`npm run test` gains `-w @sheetal/platform` and the app packages' test scripts; `npm run typecheck` gains the same. (The
`"test"` and `"typecheck"` lines list packages one by one today, so each new package is added by name.)

I am not delivering `package.json` as a changed file: I only see it in this zip and the OPS task (P1-OPS-1) must apply the
lines above to the real file. If the Lead prefers, the OPS chat gets the current `package.json` and returns the whole file.

---

## 10. Things I could not see (the Lead to confirm before the matching step)

| Missing file | Needed for |
|---|---|
| `backend-core/package.json` | the exact `exports` block to copy (steps 1–2) |
| `backend-core/prisma/schema.prisma` and its migrations folder | all of step 4; model and column names in my SQL are taken from how the code uses them |
| root `tsconfig.json`, ESLint config, `vitest` config | globs for the new folders (step 1) |
| `scripts/help.mjs` | the new scripts must be listed or `help --check` fails (step 1) |
| `modules/auth/sessions.ts`, `lib/notify.ts`, `lib/files.ts`, `lib/ai.ts`, `lib/mailer.ts` | steps 5–6, 12 |
| `business/frontend/src/BusinessApp.jsx` and `Shell.jsx` | the `PREVIEW` list and the menu (steps 10–11) |
| `business/backend/test/*` and `backend-core/test/setup-db.ts` | to confirm test helper names (`createWorkspace`, `createSession`, `call`) |
