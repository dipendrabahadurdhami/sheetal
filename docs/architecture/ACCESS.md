# Access model: who may do what, and where

Status: design for Phase 1 (task P1-ARCH-1). Nothing here is built yet.
Read [KERNEL.md](KERNEL.md) first for `BusinessContext`, `PermissionSet` and `BranchScope`, which this file feeds.

What I read to write this: `domain/permissions.ts`, `shared/src/core/rbac.js`, `modules/access.ts`, `domain/branches.ts`,
the team and branches routes, `modules/accounts/workspace.ts`, `domain/addons.ts`, `domain/plans.ts`, and the admin
platform routes. **Not given to me** (so I mark every guess): `schema.prisma`, `modules/auth/sessions.ts`, the leads routes,
`admin/.../routes.ts` (`staffOf`) and `lib/notify.ts`.

---

## 1. The model in one picture

```
Platform (Sheetal)
 └─ Staff                       platform role (super_admin, operations, finance, content_editor, support)

Business  (Prisma model Tenant; has a type, a plan/apps, seats)
 ├─ Branches                    "Head office", "Thamel outlet"…   (ids)
 ├─ Roles                       a list of permissions, each with a data scope
 └─ Members (Membership)        one person ↔ one business:  ONE role  +  a branch scope (all, or a list of branch IDs)
```

A person can be a member of many businesses (each with its own role). Inside one business they have exactly **one role**
and one **branch scope**. What they can do is the role. Where they can do it is the branch scope. How far a permission
reaches (own records, branch records, all records) is the **data scope** on that permission. Whether the business even has
the app is the **entitlement**.

Four checks, always in this order (the kernel does them, an app never writes them by hand):

```
1  Is the person an active member of this business?                 (membership.status = active)
2  Does the business have this app?                                  (entitlements.hasApp)
3  Does the person's role grant this permission, and at what scope? (permissions.scopeOf)
4  Is this record inside the data scope AND inside the person's branch scope?  (repository filters)
```

---

## 2. Today's data (what the code uses)

| Thing | Fields used by the code today |
|---|---|
| `Membership` | `userId`, `tenantId`, `roleId`, `status` (`active` / `paused`), `scopes` (Json: `"all"`, or a list of **branch names**, or `null`), `createdAt` |
| `Invite` | `tenantId`, `email`, `roleId`, `scopes` (same as above), `tokenHash`, `status` (`pending`/`accepted`/`revoked`), `invitedBy`, `sentAt`, `expiresAt` |
| `Role` | `tenantId`, `key`, `name`, `perms` (list of permission ids; `"*"` = all), `system` (true for the built-in ones) |
| `Branch` | `tenantId`, `name` (unique per business, case-insensitive), `address`, `phone`, `manager`, `receipt`, `status` (`open`/`closed`), `sort` |

Work tables (listings, leads, rooms, bookings, expenses, …) already point at the branch by **`branchId`**. Only the
people-to-branch link uses names. That is the one thing this file changes in the data model.

---

## 3. Branch scope by branch ID (and how to migrate from names)

### 3.1 Why

A branch name is editable. Today a rename has to rewrite every member and invite in a transaction (`branches/routes.ts`
`swap()`), and a name that went out of step (an older rename, a typo in an import) silently gives or removes access.
An id never changes and can have a foreign key.

### 3.2 New shape

Recommendation: two small join tables (the database then refuses a branch id that does not exist, and deleting a branch
cleans up).

```
Membership   + allBranches Boolean  @default(true)
MembershipBranch (membershipId, branchId)   primary key (membershipId, branchId); both foreign keys ON DELETE CASCADE

Invite       + allBranches Boolean  @default(true)
InviteBranch (inviteId, branchId)           same shape
```

Meaning: `allBranches = true` → every branch of the business, now and in the future. `allBranches = false` → only the rows
in `MembershipBranch`. A business owner (role with `"*"`) is treated as `allBranches = true` whatever is stored (as
`branchesOf` does today).
Alternative: a `branchIds Json` column. Fewer tables, but no foreign key, so a deleted branch leaves dead ids behind.

`BranchScope.allowed` (KERNEL.md §5.1) is built from these: `"all"` or the list of ids.

### 3.3 API shape during the move

| Where | Today | New | Transition |
|---|---|---|---|
| `GET /team` member `scopes` | `"all"` or names | `branchIds: "all" \| string[]` | `scopes` (names, computed from the ids) is still sent for one release |
| `POST /team/invites`, `PATCH /team/members/:id` body `scopes` | `"all"` or names | `branchIds: "all" \| string[]` | the server accepts either; names are resolved to ids (400 if a name is not an open branch, same message) |
| `GET /workspaces` `scopes` | names | `branchIds` + `scopes` (names) | same |
| `x-branch` header | branch id or `all` | unchanged | none |

### 3.4 Data migration plan

Do it in five steps so there is always a way back. Database specialist: task P1-DB-2 (steps 1, 2 and 4).
Table and column names below follow the Prisma model names; check them against `schema.prisma`, which I was not given.

**Step 1: add (additive).** New columns and tables above. Nothing is dropped, `scopes` stays.

**Step 2: backfill (in the same migration SQL file).**

```sql
-- 1. People limited to some branches: allBranches = false.  "all", null and anything else stay true.
UPDATE "Membership" SET "allBranches" = false WHERE jsonb_typeof("scopes") = 'array';
UPDATE "Invite"     SET "allBranches" = false WHERE jsonb_typeof("scopes") = 'array';

-- 2. Owners are always everywhere.
UPDATE "Membership" m SET "allBranches" = true
  FROM "Role" r WHERE r.id = m."roleId" AND r.perms @> ARRAY['*'];   -- adapt if Role.perms is Json: r.perms ? '*'

-- 3. Names → ids. Branch names are unique per business ignoring case, so this join cannot match two branches.
INSERT INTO "MembershipBranch" ("membershipId", "branchId")
SELECT m.id, b.id
FROM "Membership" m
CROSS JOIN LATERAL jsonb_array_elements_text(m."scopes") AS s(name)
JOIN "Branch" b ON b."tenantId" = m."tenantId" AND lower(b.name) = lower(s.name)
WHERE jsonb_typeof(m."scopes") = 'array' AND m."allBranches" = false
ON CONFLICT DO NOTHING;
-- same for "Invite" → "InviteBranch" (only status = 'pending' rows matter).
```

Edge cases, decided here so nobody guesses:

| Case | Decision |
|---|---|
| A name in `scopes` matches no branch (stale) | Dropped. Reported in the migration output (`RAISE NOTICE` or a script log). |
| The person ends with **zero** branches (all names stale, or an empty list) | Stay `allBranches = false` with no rows. They see "You aren't given any open branch. Ask the owner…" (the message `branchFor` has today). **Do not widen to "all"**: widening access in a migration is a security risk; the owner fixes it on the Team page. The report lists these people. |
| A closed branch is in the list | Kept (history). |
| Owner with a list in `scopes` | `allBranches = true` (step 2). |
| `scopes` is a JSON string `"all"`, `null`, or missing | `allBranches = true`. |

**Step 3: dual write (code, task P1-BE-3).** For one release the team, invite and branch routes write **both** the old
`scopes` (names) and the new rows; every read uses the new rows. A branch rename no longer needs the `swap()` loop (but
while dual-writing it still updates the old names so a rollback works). Deleting a branch removes the join rows through the
foreign key; the "someone's only branch" check becomes a count on `MembershipBranch`.

**Step 4: prove it.** The DB specialist runs and keeps in the CHANGES file:

```sql
-- must return 0 rows: every limited member's old names equal the names resolved from the new rows
SELECT m.id FROM "Membership" m
WHERE jsonb_typeof(m."scopes") = 'array' AND m."allBranches" = false
  AND (SELECT coalesce(array_agg(lower(x) ORDER BY lower(x)), '{}') FROM jsonb_array_elements_text(m."scopes") x)
   <> (SELECT coalesce(array_agg(lower(b.name) ORDER BY lower(b.name)), '{}')
         FROM "MembershipBranch" mb JOIN "Branch" b ON b.id = mb."branchId" WHERE mb."membershipId" = m.id);
-- (members with stale names will appear here on purpose; they are exactly the report from step 2)
```

**Step 5: freeze.** After QA passes, stop writing `scopes`. Leave the columns in place. A later task, which must say so
explicitly, drops them (TEAM-RULES: never drop unless the task says).

Rollback: until step 5, redeploy the old code; `scopes` is still correct.

### 3.5 Code that changes

| Today | New |
|---|---|
| `branchesOf(member)` → `"all"` or names | `BranchScope.allowed` → `"all"` or ids |
| `ws.inBranch(name)` | `ctx.branches.canSee(branchId)` |
| `worksAt(scopes, perms, branchName)` in `domain/branches.ts` (used by notifications) | `worksAt(member, branchId)` using ids |
| `checkScopes(app, tenantId, names)` | `resolveBranchIds(ctx, "all" \| ids)` (must be open branches of this business, same messages) |
| The 16-table `Promise.all` that checks "does this branch have work" in `DELETE /branches/:id` | Each app lists its branch-owned tables in its manifest (`branchOwned`, APP-MANIFEST.md §4); the check loops over all manifests. A new app can no longer forget it. |

---

## 4. Permissions: `app.resource.action`, declared once

### 4.1 Format

`<app>.<resource>.<action>`, all lower-case, three parts, for example `expenses.expense.create`, `reviews.review.reply`,
`workspace.team.invite`. The app is the manifest id. Staff permissions use the app id `platform`
(`platform.business.suspend`).

Actions: `read`, `create`, `update`, `delete` for plain data, and a named verb for anything else (`confirm`, `cancel`,
`refund`, `reply`, `assign`, `approve`, `export`).

### 4.2 Declared in each app manifest

APP-MANIFEST.md §3 has the full format. The relevant part:

```ts
permissions: [
  { id: "expenses.expense.read",    label: "See expenses",        scopes: ["own", "branch", "all"], default: "branch" },
  { id: "expenses.expense.create",  label: "Add expenses",        scopes: ["branch", "all"],        default: "branch" },
  { id: "expenses.expense.confirm", label: "Confirm drafts",      scopes: ["branch", "all"],        default: "branch", approvable: true },
  ...
]
```

The manifest is the **only** place a permission is written. Nothing else is hand-typed.

### 4.3 Generated copies (replacing the hand-synced pair)

Today `backend-core/src/domain/permissions.ts` and `shared/src/core/rbac.js` hold the same lists, and
`test/domain.test.ts` fails if they differ. In the new design nobody edits either list:

```
apps/*/app.manifest.ts  +  platform/tenancy/platform.manifest.ts
        │   npm run gen:permissions        (scripts/gen-permissions.mjs)
        ├─► platform/tenancy/permissions.generated.ts      catalog, role templates, helpers for the servers
        └─► packages/config/src/permissions.generated.js   the same data for the screens (what rbac.js exports today)
```

- Both generated files start with `// GENERATED by scripts/gen-permissions.mjs. Do not edit.` and are committed.
- `npm run gen:permissions -- --check` regenerates in memory and fails if a committed file differs. It is added to
  `npm run check` (so the parity test is no longer needed; it is deleted when the generator lands).
- The generator reads the manifests as data. So a manifest file is a plain object with `satisfies AppManifest` and only
  `import type` lines (APP-MANIFEST.md §2). Run it with the TypeScript runner the APIs already use in development
  (I did not see which one; Node 22.18+ can also run `.ts` directly). If neither works, the fallback is `app.manifest.mjs`
  with a JSDoc type.
- `packages/config` keeps the exports the screens already import from `rbac.js`: `can(role, perm)`, `canAny`, `filterNav`,
  `roleTemplatesFor`, `permsForTypes`, `roleName`, `roleDesc`, `permCount`, `BUSINESS_TYPES`. `shared/src/core/rbac.js` becomes a
  one-line re-export so no screen import changes.

Labels: the screens translate `perm.<id>`, `role.<key>`, `roledesc.<key>` through i18n. The manifest `label` is the English
fallback; the translation key is the permission id. I did not see the i18n files, so the Frontend specialist adds the new
keys next to the old ones (old keys stay until the end of Phase 1).

---

## 5. Data scope per permission

### 5.1 The three scopes

| Scope | Means | Example |
|---|---|---|
| `own` | records the person created or is assigned to (the app says which field: `ownerField`) | an agent sees the leads assigned to them |
| `branch` | records of the branches the person works in (their branch scope, narrowed by the branch picked in the top bar) | a branch manager sees the expenses of their branches |
| `all` | every record of the business, **whatever the person's branch scope** | an accountant at head office sees every branch's money |

`own ⊂ branch ⊂ all`. A role that has a permission at a wider scope has it at the narrower ones too.
Every permission **today** behaves as `branch` (data tables) or business-wide (team, roles, settings, billing). So the
migration writes `:branch` or `:all` for each existing permission, and **nobody gains or loses anything**.

### 5.2 How it is stored

No new column. `Role.perms` stays a list of strings. A grant is `"<permission>"` or `"<permission>:<scope>"`:

```
["expenses.expense.read:branch", "expenses.expense.create:branch", "workspace.team.read:all", "crm.lead.read:own"]
```

- No suffix means the manifest's `default` for that permission.
- `"*"` still means everything, at scope `all`.
- A role template or a custom role can only use scopes the manifest lists for that permission (`scopes`). Anything else is
  refused when saving the role (the same check as today's `checkPerms`, which says "Unknown permissions").
- The migration always writes the scope explicitly, so a later change of a manifest `default` never changes an old role.

### 5.3 How it is enforced

`PermissionSet.scopeOf(perm)` returns the scope (or `null`). The service passes it to the repository; `scopeWhere` turns it
into SQL (KERNEL.md §6.4). One rule for custom actions that touch one record: after loading it with `repo.get(ctx, id, scope)`,
a record outside the scope is "not found", not "forbidden" (today's behaviour for another branch's expense). Do not reveal
that it exists.

### 5.4 Where `own` is used in Phase 1

Only where the code already limits by person: leads for roles that cannot assign them (the backend plan says "agents see
their own and unassigned ones; only people who assign leads hand them to others"). I did **not** see the leads routes, so
the Lead must confirm that rule before P1-DB-3 writes it. If it is as described:

| Old role holds | New grant |
|---|---|
| `leads.view` and `leads.assign` | `crm.lead.read:branch`, `crm.lead.assign:branch` |
| `leads.view` only | `crm.lead.read:own` (assigned to them, or unassigned) |

All other grants keep `branch` or `all`.

---

## 6. Every current permission → its new name

Rule for reading the table: a person who held the old permission gets **all** the new ones in the right-hand column.
Where an old "manage" permission also let people see the data (it always did in the code), `read` is included.
Default scope in brackets: `[b]` = branch, `[a]` = all.
App ids marked * are proposals for the owner to confirm; `expenses` and `reviews` are fixed by the task.

### 6.1 Business permissions

| Old | New | Notes |
|---|---|---|
| `overview.view` | `workspace.overview.read` [b] | |
| `bookings.view` | `hotel.booking.read` [b] | * app `hotel` = Hotel PMS (also used by hosts) |
| `bookings.create` | `hotel.booking.create` [b] | |
| `bookings.edit` | `hotel.booking.update` [b] | |
| `bookings.cancel` | `hotel.booking.cancel` [b] | |
| `calendar.view` | `hotel.calendar.read` [b] | |
| `calendar.edit` | `hotel.calendar.update` [b] | |
| `pos.frontdesk` | `pos.frontdesk.use` [b] | * |
| `pos.restaurant` | `pos.restaurant.use` [b] | |
| `pos.extras` | `pos.extra.create` [b] | |
| `pos.discount` | `pos.bill.discount` [b] | |
| `pos.void` | `pos.bill.void` [b] | `approvable` |
| `shift.close` | `pos.shift.close` [b] | |
| `projects.manage` | `projects.project.read`, `.create`, `.update`, `.delete` [b] | * app `projects` = developer projects and units |
| `progress.post` | `projects.progress.create` [b] | |
| `visits.manage` | `projects.visit.read`, `.create`, `.update`, `.delete` [b] | |
| `reservations.manage` | `projects.reservation.read`, `.create`, `.update`, `.delete` [b] | |
| `collect.payments` | `collections.payment.read`, `.create` [b] | * app `collections` = collecting payments from buyers/tenants |
| `collect.refund` | `collections.payment.refund` [b] | `approvable` (money) |
| `listings.manage` | `listings.listing.read`, `.create`, `.update`, `.delete`, `.publish` [b] | * |
| `leads.view` | `crm.lead.read` [b] or `:own` (see §5.4) | * app `crm` = leads, customers, inbox messages |
| `leads.assign` | `crm.lead.assign` [b] | the Lead confirms whether this also needs `crm.lead.update` (leads routes not seen) |
| `viewings.manage` | `listings.viewing.read`, `.create`, `.update`, `.delete` [b] | |
| `rentals.view` | `rentals.rental.read` [b] | * |
| `rentals.manage` | `rentals.rental.read`, `.create`, `.update`, `.delete` [b] | |
| `investments.manage` | `investments.offering.read`, `.create`, `.update`, `.delete` [b] | * |
| `investors.view` | `investments.investor.read` [b] | |
| `updates.post` | `investments.update.create` [b] | |
| `agreements.manage` | `agreements.agreement.read`, `.create`, `.update`, `.delete` [b] | * |
| `people.view` | `people.person.read` [b] | * app `people` = people/HR (attendance, leave); assumed from the branch-delete check, Lead to confirm |
| `people.manage` | `people.person.read`, `.create`, `.update`, `.delete` [b] | |
| `invoices.view` | `invoicing.invoice.read` [b] | * |
| `invoices.create` | `invoicing.invoice.read`, `.create` [b] | |
| `payouts.view` | `invoicing.payout.read` [b] | |
| `expenses.view` | `expenses.expense.read`, `expenses.recurring.read`, `expenses.profit.read` [b] | |
| `expenses.manage` | everything in `expenses.view` **plus** `expenses.expense.create`, `.update`, `.delete`, `.confirm`, `expenses.recurring.create`, `.update`, `.stop` [b] | today `manage` also passes the "can see" check |
| `customers.view` | `crm.customer.read` [b], `reviews.review.read` [b] | today `reviews.reply` **or** `customers.view` reads reviews |
| `messages.reply` | `crm.message.reply` [b] | |
| `reviews.reply` | `reviews.review.read` [b], `reviews.review.reply` [b] | |
| `team.view` | `workspace.team.read` [a] | |
| `team.manage` | `workspace.team.read`, `.invite`, `.update`, `.remove` [a] | role changes, pause, remove, invitations |
| `roles.manage` | `workspace.role.read`, `.create`, `.update`, `.delete` [a] | |
| `settings.business` | `workspace.settings.update`, `workspace.profile.update`, `workspace.branding.update`, `workspace.branch.create`, `.update`, `.delete` [a] | profile, branding and branches all use it today |
| `billing.manage` | `workspace.billing.manage` [a] | |

The `workspace` app is the always-on part (overview, team, roles, branches, settings, billing). `entitlements.hasApp("workspace")`
is always true.

Not mapped because the code I was given has no dedicated permission: stock (`stockRoutes`), forms, promote/boosts, mail,
listing codes, check-ups, verification. Those routes use other checks (not seen). Each becomes an app later with its own
mapping; until then they keep working with the old names through the alias layer (§6.3).

### 6.2 Staff (platform) permissions

Staff permissions use app id `platform`. The role keys stay the same. Scope is not used (staff see the whole platform).

| Old | New |
|---|---|
| `dashboard.view` | `platform.dashboard.read` |
| `tenants.view` | `platform.business.read` |
| `tenants.manage` | `platform.business.read`, `.create`, `.update` |
| `tenants.suspend` | `platform.business.suspend` |
| `tenants.impersonate` | `platform.business.impersonate` |
| `plans.manage` | `platform.plan.read`, `.create`, `.update`, `.delete` |
| `billing.view` | `platform.billing.read` |
| `billing.refund` | `platform.billing.refund` (`approvable`) |
| `content.edit` | `platform.content.update` |
| `content.publish` | `platform.content.publish` |
| `moderation.listings` | `platform.listing.moderate` |
| `moderation.kyc` | `platform.verification.review` |
| `staff.view` | `platform.staff.read` |
| `staff.manage` | `platform.staff.read`, `.create`, `.update`, `.remove` |
| `roles.manage` | `platform.role.manage` |
| `settings.platform` | `platform.settings.read`, `platform.settings.update` |
| `audit.view` | `platform.audit.read` |

New staff permissions (needed by the Integration Center and revenue reports, SETTINGS.md and INTEGRATIONS.md). Only
`super_admin` (`*`) has them at first, except where stated:

| New | Who | Why |
|---|---|---|
| `platform.settings.security` | `super_admin` | login attempts, session days, maintenance mode (today `SUPER_ONLY`) |
| `platform.integration.read` | `operations`, `support`, `finance` | see status and health, never keys |
| `platform.integration.manage` | `super_admin` | enter/replace keys, go live, pause (today "Only the super admin can change connection keys") |
| `platform.pricing.manage` | `super_admin`, `finance` | app prices, editions, free limits, trials, add-ons (Phase 3 screens) |
| `platform.revenue.read` | `finance`, `super_admin` | sales and revenue reports, partner revenue share |
| `platform.revenue_share.manage` | `super_admin` | the technology partner's revenue share |
| `platform.business.impersonate_write` | `super_admin` | write mode while impersonating (§12) |

### 6.3 How the switch is done without breaking anything (the alias layer)

1. **Alias map first.** The generator also writes `LEGACY_ALIASES` (old name → new names, from the tables above).
   `hasPerm` / `PermissionSet.can` accept an old name: it is true if the role holds the old name **or** all of its new names.
   Code can keep calling `ws.can("expenses.manage")` while roles still hold old names.
2. **Rewrite roles.** One data migration rewrites every `Role.perms` using the map, with the scope suffix, and keeps a backup
   copy in a new column `Role.permsV1` (additive). Custom roles are included. Pending role edits made through the screens after
   that write new names only.
3. **Switch call sites** app by app (`ws.can("expenses.manage")` → `permissions.require("expenses.expense.create")`).
4. **Remove the alias layer** at the end of Phase 1, when no call site uses an old name. A test greps for old names.

Role templates for **new** businesses use the new names from step 2 on (the templates move into the manifests, §8).

---

## 7. App access

`app access = the business has the app (entitlement) AND the role grants at least one permission of that app`.

```ts
canUseApp(ctx, appId) = ctx.entitlements.hasApp(appId) && ctx.permissions.hasAnyIn(appId)   // hasAnyIn: any "appId.*" grant
```

- **Server.** Each app's routes are registered under one `preHandler`, `requireAppAccess(appId)`. Two different refusals:
  "Your business doesn't have {App name}." (403, `app_not_available`, with a link to the marketplace) and
  "Your role can't use {App name}." (403, `forbidden`). The kernel service also calls `requireApp` for non-HTTP callers (jobs).
- **Screens.** The menu is built from the manifests: an item shows when `canUseApp` is true and the item's own `permission`
  is held (`filterNav` today does the permission half, with `types`). The marketplace page lists apps the business does
  not have.
- **Business type.** `businessTypes` in the manifest replaces `types` on the permission groups: an app is offered to a
  business when its type is listed, or the plan has the `all_kinds` feature (today's Pro rule, `typesOf(ws)`).
- **Phase 1** keeps today's answers: `hasApp` is true for every app that was shown to the business type, so no screen vanishes.

---

## 8. Roles and role templates

- **System roles** (`system = true`) are created for each new business from templates, as `createRoles()` does today. The
  owner role is `["*"]` and cannot be edited. The business always keeps one active owner (rules unchanged).
- **Templates move into the manifests** (field `roles`, APP-MANIFEST.md §3). The template of a business = the `workspace`
  app's roles + the roles of every app the business type gets, merged by `key` (grants are added together). The table in
  `domain/permissions.ts` (`TEMPLATES`) is converted mechanically with §6, so the result for an existing business type is
  the same list of people.
- "Manager" today is `null` = every permission of the type except `roles.manage` and `billing.manage`. In a manifest that is
  written with a pattern, and the generator expands it:

  ```ts
  { key: "manager", types: ["hotel"], grants: { all: true, except: ["workspace.role.*", "workspace.billing.*"] } }
  ```

  Patterns (`*` for a whole segment) are allowed **only in templates**; stored roles always hold the expanded list.
- **Custom roles** stay a plan feature (`custom_roles`). The permission list offered on the role screen is the catalog of
  the apps the business has (`businessPermsFor` becomes `catalogFor(ctx)`), each with only the scopes the manifest allows.

---

## 9. Maker-checker approvals

For actions that move money or change people. One person makes the request, a **different** person approves it, and only then
does it happen.

### 9.1 Which actions

The manifest marks them (`approvable: true` on the permission, plus an `approvals` entry with the default rule). Starting
list (an app opts in; nothing is switched on by default in Phase 1):

| Group | Actions |
|---|---|
| Money out | refunds (`collections.payment.refund`, `platform.billing.refund`), payouts marked paid, expenses above a limit (`expenses.expense.confirm`), voiding a POS bill, cancelling an invoice, changing where a business receives money (bank account, QR, gateway keys) |
| People | giving or removing the owner role, changing a role's permissions, removing a member, approving leave or pay changes (People app) |
| Platform | staff refunds, changing a plan price that has paying customers (Phase 3) |

### 9.2 How a business sets it

Business → Settings → Approvals: for each approvable action, **on/off**, an optional **amount limit** (below it the action
runs straight away), and **who approves** (a role that holds the approver permission). Platform actions are set by the super
admin. Defaults come from the manifest; the business can only make the rules stricter than the platform minimum.

### 9.3 Data

```
ApprovalRule     (id, tenantId, action, enabled, thresholdPaisa?, approverPermission, expiresHours)    unique (tenantId, action)
ApprovalRequest  (id, tenantId, branchId?, action, resource, resourceId?, payload Json, amountPaisa?, status,
                  makerId, makerNote, checkerId?, checkerNote?, createdAt, decidedAt?, expiresAt, executedAt?, result Json?)
   status: pending → approved → executed | failed ;  pending → rejected | cancelled | expired
```

### 9.4 Flow

```
1  Maker calls the normal route (POST /expenses/:id/confirm).
2  BaseService.action({ approval }) sees: rule enabled, amount ≥ limit, maker is not exempt.
3  It does NOT run. It stores an ApprovalRequest (payload = the validated input), audits "approval.requested",
   notifies people who hold the approver permission for that branch, and answers 202 { message: "Sent for approval.", data: { approvalId } }.
4  Checker opens Approvals, sees what/who/how much, approves or rejects (with a note). Rules:
      • checker ≠ maker (always, even for owners);  • checker holds the approver permission, at a scope that covers the branch;
      • the request is not expired (default 72 h) and still pending (compare-and-set, so two checkers decide once).
5  On approve, the system runs the original action with the stored payload, as the maker (createdBy = maker, approvedBy = checker),
   re-checking the business rules (the world may have changed). Success → status executed; a rule failure → status failed, both people told.
6  Audit rows: approval.requested, approval.approved|rejected, and the action's own row, which carries meta.approvalId and both ids.
```

**One-person businesses.** A rule only applies when at least two active people hold the approver permission for that branch.
If not, the action runs normally and the audit row says `approval skipped: no second approver`; the screen shows a hint
"Add a second person to switch on approvals." This avoids locking small businesses (many Nepal businesses are one owner).
Recommendation: no "owner bypass". Alternative: let owners bypass; simpler, but then the control means nothing for the people
it is meant for.

Phase 1 builds the table, the `action({ approval })` hook, the inbox screen and the audit rows; rules are all **off**.
So behaviour does not change; Phase 2 apps switch rules on.

---

## 10. Seats

A **seat** is a person who can sign in to the business. Today (`team/routes.ts`): seats used = active members + pending,
unexpired invitations; paused members do not count; the limit is `effectiveLimits().limits.seats` (plan seats plus bought
add-on seats; `-1` = unlimited). The kernel keeps all of that.

- `Entitlements.seats()` returns `{ used, limit }`; `limit = null` is unlimited.
- Checked when: inviting (exists), **and when a paused member is made active again**. I found that the second case is not
  checked today (`PATCH /team/members/:userId` accepts `status: "active"` without a seat check), so a business at its
  limit can free a seat by pausing and use it again. This is a small bug, not a rule. Recommendation: fix it in P1-BE-3 with a
  test. The Lead decides.
- Not seats: Sheetal staff impersonating (§12), the business owner's other businesses (each business counts its own).
- Message stays: "The Starter plan is just you…" is a plan-name message; in Phase 3 it becomes "Your plan has N seats and M are taken."
  (Phase 3 changes plans to per-app pricing; seats stay a per-business number there unless the owner decides on per-app seats.)

---

## 11. Platform staff

- Staff are users with a platform role (`user.platformRole`). They never appear in a business's seat count.
- Roles stay fixed in Phase 1: `super_admin` (`*`), `operations`, `finance`, `content_editor`, `support`. The new permission
  lists are §6.2, with the additions in the second table.
  - `finance` gets `platform.revenue.read`, `platform.pricing.manage`, `platform.integration.read`.
  - `operations` and `support` get `platform.integration.read`.
- The admin API builds a `StaffContext` (KERNEL.md §5) instead of calling `staffOf(request, perm)`; `staffOf` stays as a shim.
- Security-sensitive fields (login attempts, session days, maintenance) are checked by permission
  (`platform.settings.security`) instead of the `SUPER_ONLY` list plus a role-name test.
- Removed staff are signed out at once (today's rule). Staff roles can become editable later through `platform.role.manage`.

---

## 12. Impersonation ("log in as them")

Used by support to see what a business sees. Today the permission `tenants.impersonate` exists on `operations` and
`support`; I did not see the implementation, so this is the standard to build to.

**Start.** `POST /admin/businesses/:id/impersonate` with `{ reason, minutes? }`.

| Rule | Value |
|---|---|
| Needs | `platform.business.impersonate` and a fresh sign-in (password re-entered within 10 minutes; 2FA if on) |
| `reason` | required, 10–300 characters, free text (a ticket number is welcome) |
| Length | default 15 minutes, at most 30; ends early on "End session" or sign-out of the staff member |
| Mode | **read-only** by default. Write mode needs `platform.business.impersonate_write` (super admin) and a second typed reason. |
| Not allowed | impersonating another staff member; acting on a suspended business as a writer |

**What the session can do.** The context is a `BusinessContext` with `actor = { kind: "staff", … }`, the member shown as
"Sheetal support", and permissions = the target business's *owner role* **minus** a fixed deny list that applies even in write mode:

```
workspace.role.*   workspace.team.invite|update|remove   workspace.billing.manage   workspace.settings.update (payment methods, branding)
approvals: cannot decide any ApprovalRequest      integrations: cannot see or change credentials (never visible anyway)
```

In read-only mode every non-GET route is refused with "This is a read-only support session." (`403 impersonation_read_only`).

**Trail.**

1. `ImpersonationSession(id, staffId, tenantId, reason, startedAt, expiresAt, endedAt, endedBy, readOnly, ip, requestCount)` is the record.
2. Audit rows: `impersonation.started` and `impersonation.ended` (platform log and the business's log), and **every write** made
   during the session, with `meta.impersonatedBy` and `meta.reason`. Reads of private files and identity documents are
   audited too (`impersonation.opened_file`). Plain page reads are counted in `requestCount`, not logged one by one.
3. **The business is told.** An in-app notification and an email to the owners when the session starts: "Sheetal support
   opened your account at 14:32 for: <reason>." (Recommendation. Alternative: tell them only when it ends. Starting is safer: no silent access.)
4. **Banner.** Every page shows a bar "You are viewing {Business} as Sheetal support · {reason} · {minutes left} · End session".
5. The session token is separate from the staff login token, carries only `{sessionId}`, and is rejected after `expiresAt`.

---

## 13. Tests the Backend and QA specialists must have

| Test | Proves |
|---|---|
| `permissions.generated` check (`gen:permissions --check`) | the committed generated files match the manifests |
| Alias layer | for every old name in §6, a role with the old name and a role with the new names both pass the same checks |
| Role migration | a fixture role per business type, before and after the rewrite, passes exactly the same set of checks (use the old `TEMPLATES` as the oracle) |
| Branch migration | the SQL in §3.4 on a fixture with renamed, closed, stale and owner cases |
| Four checks (§1) | member of another business → 403/404; business without the app → `app_not_available`; role without the permission → forbidden; record in another branch → not found |
| Data scope | `own` hides colleagues' records, `branch` hides other branches, `all` shows both |
| Repository isolation | KERNEL.md §6.5 for Expenses and Reviews |
| Approvals | maker cannot approve; second request for the same item; expiry; one-person business skips the rule |
| Impersonation | read-only refusal, deny list, owner notified, audit rows present |
| Seats | invite and re-activate both refuse at the limit |

---

## 14. Open choices

| Choice | Recommendation | Alternative |
|---|---|---|
| Branch links | join tables with foreign keys | `branchIds Json`, no foreign key |
| Scope storage | suffix on the permission string (`perm:scope`) | a separate `scopes` column on `Role`; needs a schema change and a second place to keep in step |
| Zero-branch members after migration | leave with no access, report them | widen to all branches (unsafe) |
| Approvals with one person | skip the rule, record why | owner bypass, or block the action |
| Impersonation default | read-only, owner told at start | read-write with logging only |
| Un-pausing a member over the seat limit | refuse (fix the gap) | keep today's behaviour |
