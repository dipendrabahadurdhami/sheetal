# App manifest

Status: design for Phase 1 (task P1-ARCH-1). Nothing here is built yet.
Companion files: [KERNEL.md](KERNEL.md) (events, context), [ACCESS.md](ACCESS.md) (permissions, roles),
[SETTINGS.md](SETTINGS.md) (editable prices and limits), [FOLDERS-AND-MOVE-PLAN.md](FOLDERS-AND-MOVE-PLAN.md) (where files go).

---

## 1. What a manifest is

Every app (Expenses, Reviews, later CRM, Rent, Hotel PMS, POS, HRM, Invoicing, Inventory…) has one file,
`apps/<id>/app.manifest.ts`. It is the app's **identity card**. It says, in one place:

- what the app is called, its icon, which business types it is for;
- what the app costs and what is free (as **defaults**: the super admin edits them, see §5);
- which permissions it adds, which role templates get them;
- which menu items it adds;
- which events it sends and listens to;
- which AI features it has and how many minutes each saves;
- which other apps and tables it depends on;
- which tables hold branch work (so deleting a branch can check them).

Everything else is generated from it: the permission lists for the servers and the screens, the menu, the role templates,
the Marketplace card, the branch-delete check, the admin pricing screen. **Nobody types a permission or a menu item twice.**

---

## 2. Rules for the file

1. A manifest is a **plain object**, no functions, no logic. It `satisfies AppManifest` and only has `import type` lines. The
   generator reads it as data (`npm run gen:permissions`).
2. The folder name, the `id`, and every permission and event prefix are the same word. `apps/expenses` → `id: "expenses"` →
   `expenses.expense.create`.
3. Text shown to people has `en` and `ne` (Nepali). Missing `ne` falls back to `en` and is flagged by the checker.
4. **Defaults only.** Prices, free limits, trial days and AI plans in the manifest are the first values. When the platform
   starts, they are written once to the settings store (`apps.<id>.*`); from then on the **admin panel** owns them and the
   manifest value is ignored (TEAM-RULES: "settings, not code"). Changing the manifest later does not change a live price.
5. `npm run check:manifests` (script `scripts/check-manifests.mjs`) fails the build when any rule in §9 is broken.

---

## 3. The format

```ts
import type { BusinessType } from "@sheetal/platform/tenancy/types";

export type Text = { en: string; ne?: string };
export type DataScope = "own" | "branch" | "all";

export interface AppManifest {
  manifestVersion: 1;

  /** Folder name and prefix of every permission/event. Lower-case letters, digits, underscore. */
  id: string;
  /** "app" = sold in the Marketplace. "core" = always on (workspace). "platform" = Sheetal staff only. */
  kind: "app" | "core" | "platform";
  name: Text;
  tagline: Text;                    // one line for the Marketplace card
  description?: Text;               // a short paragraph
  /** Icon name from the shared icon set (lucide names, as in shared/src/core/icons). */
  icon: string;
  category: "money" | "sales" | "property" | "hospitality" | "people" | "growth" | "settings";

  /** Business types that are offered the app. A plan with the `all_kinds` feature (Pro today) is offered all of them. */
  businessTypes: readonly BusinessType[] | "all";

  /** Editions with their free limits. DEFAULTS, see rule 4. One of them is the free-forever tier. */
  editions: readonly Edition[];
  /** Days of free trial of the paid edition. null = none. DEFAULT. */
  trialDays: number | null;
  /** The names of limits this app counts, so the admin screen can show a field for each. */
  limits: readonly LimitDecl[];

  permissions: readonly PermissionDecl[];
  /** Grants this app adds to roles. Merged by role key into the business type's templates (ACCESS.md §8). */
  roles: readonly RoleGrant[];
  /** Actions that can need a second person's approval (ACCESS.md §9). */
  approvals: readonly ApprovalDecl[];

  menu: readonly MenuItem[];

  events: {
    publishes: readonly EventDecl[];
    consumes: readonly EventSub[];
  };

  ai: readonly AiFeature[];

  dependencies: {
    requires: readonly string[];    // app ids that must be installed; the Marketplace installs them together
    optional: readonly string[];    // app ids that add features when present
    reads: readonly string[];       // Prisma models of OTHER apps this app reads (see KERNEL.md §10.6)
  };

  /** Prisma models this app owns. Each carries `/// @app <id>` in schema.prisma; the checker compares both. */
  models: readonly string[];
  /** Models holding branch work, for "this branch has work, close it instead" (ACCESS.md §3.5). */
  branchOwned: readonly { model: string; label: Text }[];

  /** Settings the app adds. The values live in the settings store (SETTINGS.md). */
  settings: readonly SettingDecl[];

  /** Background jobs, registered in platform/jobs. */
  jobs: readonly { id: string; every: string; label: string }[];   // every: "6h", "1d", "10m"
}

export interface Edition {
  id: string;                                        // "free", "full"
  name: Text;
  free: boolean;                                     // true for the free-forever tier
  limits: Record<string, number | null>;             // null = unlimited
  features: readonly string[];                       // feature keys the edition switches on
  /** Default price, in paisa, per month and per year. null = decided in Phase 3 in the admin panel. */
  price: { monthPaisa: number; yearPaisa: number } | null;
}

export interface LimitDecl { key: string; label: Text; unit: "count" | "mb" | "per_month" | "per_day" }

export interface PermissionDecl {
  id: string;                                        // "expenses.expense.create"
  label: Text;                                       // "Add expenses"
  scopes: readonly DataScope[];                      // which data scopes a role may give. [] = scope does not apply (platform, workspace)
  default: DataScope | null;                         // used when a role grants it without a suffix
  group?: string;                                    // heading on the role screen, e.g. "Expenses"
  approvable?: boolean;                              // can be put behind maker-checker
  sensitive?: boolean;                               // never offered to custom roles by default (money out, people)
}

export interface RoleGrant {
  key: string;                                       // role key: "accountant", "branch_manager", "frontdesk"…
  types: readonly BusinessType[] | "all";            // business types where this grant applies; ignored if the type has no such role
  add: readonly string[];                            // permission ids, optionally with ":scope"; patterns allowed here only
}

export interface ApprovalDecl {
  action: string;                                    // permission id of the action: "expenses.expense.confirm"
  label: Text;
  money: boolean;                                    // true → the rule has an amount limit
  enabledByDefault: boolean;                         // Phase 1: false everywhere
  approverPermission: string;                        // who may approve (a permission of this app or workspace.approval.decide)
}

export interface MenuItem {
  id: string;
  label: Text;
  icon: string;
  path: string;                                      // "/business/expenses"
  group: "main" | "work" | "money" | "customers" | "growth" | "admin";   // the sidebar groups in Shell.jsx
  order: number;
  permission?: string;                               // shown only when the role holds it
  anyPermission?: readonly string[];                 // …or any of these (today's permAny)
  badge?: { endpoint: string; field: string };       // a count shown on the item, e.g. drafts waiting
}

export interface EventDecl {
  name: string;                                      // "expenses.expense.confirmed"
  v: number;                                         // payload version
  label: string;                                     // what happened, in English, for the admin event log
  payload: Record<string, "string" | "number" | "boolean" | "date" | "paisa" | "id">;
}
export interface EventSub { name: string; handler: string; why: string }   // handler = handler id in the app's events.ts

export interface AiFeature {
  id: string;
  name: Text;
  description: Text;
  /** Minutes one use saves a person, used to show "AI saved you N hours" (Phase 4). Proposal numbers; the owner edits them in admin. */
  minutesSaved: number;
  status: "planned" | "preview" | "live";
  /** The permission needed to use it. */
  permission: string;
}

export interface SettingDecl {
  key: string;                                       // "expenses.categories"
  label: Text;
  scope: "platform" | "business";                    // who edits it (SETTINGS.md §2)
  type: "int" | "money" | "bool" | "text" | "select" | "list" | "json";
  default?: unknown;
  /** Where today's value is stored, so Phase 1 reads the old place and nothing breaks. */
  legacy?: string;
}
```

### 3.1 How the files are used

| Consumer | Reads | Produces |
|---|---|---|
| `scripts/gen-permissions.mjs` | `permissions`, `roles`, `businessTypes`, `menu` | `permissions.generated.ts` / `.js`, role templates, `apps.generated.ts` (server registry), `apps.generated.js` (screen registry) |
| `platform/core/apps.ts` (server, at start) | the generated registry | `getManifest(id)`, `appsForBusiness(type, entitlements)`, validates `events.publishes` on every `bus.publish` |
| Business shell (`Shell.jsx`) | `menu`, `name`, `icon` | sidebar, filtered by `canUseApp` and permission |
| Marketplace page (Phase 3) | `name`, `tagline`, `editions`, `ai`, `dependencies` | app cards, install button, "needs Invoicing" notes |
| Admin → Pricing (Phase 3) | `editions`, `limits`, `trialDays` | the screen where staff set prices and free limits; values saved as settings |
| Branch delete (`branches/routes.ts`) | `branchOwned` | the "this branch has 3 expenses…" refusal |
| Role screen | `permissions` (+ `group`, `scopes`) | tick boxes with a scope drop-down |

---

## 4. Branch-owned tables

`branchOwned` replaces the hand-written 16-way count in `DELETE /branches/:id` (listings, rooms, leads, bookings, shifts,
bills, invoices, expenses, recurring expenses, rental owners and units, forms, agreements, stock items, attendance, leave).
Each app lists its own models; the branch route loops over every installed manifest. The refusal text stays: "{branch} has
3 expenses, 1 booking. Move them to another branch, or close the branch instead (its history stays)." The label is
pluralised by the same small helper. A new app cannot forget this check: the manifest checker fails if a model with a
`branchId` field is missing from `branchOwned`.

---

## 5. Editions, free limits, prices: defaults now, admin later

Product decision (TEAM-RULES): per-app pricing, a free-forever tier, 14-day trials, Sheetal earns a commission on each
sale; all of it is a **super admin setting**.

| Question | Answer |
|---|---|
| What does the manifest hold? | Which limits exist (`limits`), a default value for each edition, a default trial length, and optionally a default price. |
| Where does the live value live? | Settings store keys `apps.<id>.editions.<edition>.limits.<key>`, `apps.<id>.trialDays`, `apps.<id>.editions.<edition>.price` (SETTINGS.md §3). Seeded from the manifest the first time, then owned by admin. |
| How does an app check a limit? | `ctx.entitlements.limit("expenses", "expenses_per_month")` → number or `null` (unlimited). The service calls `requireLimit()`. |
| Commission and partner share? | Not in manifests. `commissionPct` is a platform setting (today 10 in `PLATFORM_DEFAULTS`); the technology partner's revenue share is a super-admin setting (SETTINGS.md §7). |
| Phase 1? | **No limit is switched on.** Every `limits` value for Expenses and Reviews is `null` (unlimited) and `price` is `null`, so nothing changes. Phase 3 fills them in the admin panel. |

---

## 6. The Expenses manifest, filled in

```ts
// apps/expenses/app.manifest.ts
// Expenses: what a business spent, recurring expenses, and profit by month and branch.
// Where it fits: loaded by the generator (permissions, menu, roles) and by the API at start (events, limits).
// How it works: plain data. Prices and limits are only defaults; the admin panel owns them after the first start.
// Rules: no functions or logic here; every permission and event starts with "expenses.".

import type { AppManifest } from "@sheetal/platform/core/manifest";

const manifest = {
  manifestVersion: 1,
  id: "expenses",
  kind: "app",
  name:    { en: "Expenses", ne: "खर्च" },
  tagline: { en: "Track what you spend, set recurring costs, and see your profit.", ne: "खर्च हेर्नुहोस्, नियमित खर्च राख्नुहोस्, र नाफा हेर्नुहोस्।" },
  icon: "receipt",
  category: "money",
  businessTypes: "all",                                      // today: hotel, host, developer, agency, sponsor all have Expenses

  trialDays: null,                                           // Phase 3
  limits: [
    { key: "expenses_per_month",  label: { en: "Expenses per month" },        unit: "per_month" },
    { key: "recurring_templates", label: { en: "Recurring expenses" },        unit: "count" },
    { key: "receipt_storage_mb",  label: { en: "Receipt storage" },           unit: "mb" },
  ],
  editions: [
    { id: "free", name: { en: "Free" }, free: true,
      limits: { expenses_per_month: null, recurring_templates: null, receipt_storage_mb: null },   // Phase 1: unlimited. The owner sets real free limits in admin in Phase 3.
      features: [], price: null },
    { id: "full", name: { en: "Full" }, free: false,
      limits: { expenses_per_month: null, recurring_templates: null, receipt_storage_mb: null },
      features: ["expenses.receipts", "expenses.profit"],    // example feature keys; the owner decides what is paid in Phase 3
      price: null },
  ],

  permissions: [
    { id: "expenses.expense.read",       label: { en: "See expenses" },                   scopes: ["own", "branch", "all"], default: "branch", group: "Expenses" },
    { id: "expenses.expense.create",     label: { en: "Add expenses" },                   scopes: ["branch", "all"],        default: "branch", group: "Expenses" },
    { id: "expenses.expense.update",     label: { en: "Change expenses and receipts" },   scopes: ["own", "branch", "all"], default: "branch", group: "Expenses" },
    { id: "expenses.expense.delete",     label: { en: "Delete or skip expenses" },        scopes: ["own", "branch", "all"], default: "branch", group: "Expenses" },
    { id: "expenses.expense.confirm",    label: { en: "Confirm recurring drafts" },       scopes: ["branch", "all"],        default: "branch", group: "Expenses", approvable: true },
    { id: "expenses.recurring.read",     label: { en: "See recurring expenses" },         scopes: ["branch", "all"],        default: "branch", group: "Recurring" },
    { id: "expenses.recurring.create",   label: { en: "Add recurring expenses" },         scopes: ["branch", "all"],        default: "branch", group: "Recurring" },
    { id: "expenses.recurring.update",   label: { en: "Change, pause or resume recurring expenses" }, scopes: ["branch", "all"], default: "branch", group: "Recurring" },
    { id: "expenses.recurring.stop",     label: { en: "Stop recurring expenses" },        scopes: ["branch", "all"],        default: "branch", group: "Recurring" },
    { id: "expenses.profit.read",        label: { en: "See profit" },                     scopes: ["branch", "all"],        default: "branch", group: "Profit" },
  ],

  // Today's templates: "accountant" in every type that has one, and the agency "branch_manager", hold expenses.view + expenses.manage.
  // The hotel "manager" gets everything through its "all permissions except roles and billing" rule, so it is not listed.
  roles: [
    { key: "accountant",     types: ["hotel", "developer", "agency", "sponsor"],
      add: ["expenses.expense.read:branch", "expenses.expense.create:branch", "expenses.expense.update:branch", "expenses.expense.delete:branch", "expenses.expense.confirm:branch",
            "expenses.recurring.read:branch", "expenses.recurring.create:branch", "expenses.recurring.update:branch", "expenses.recurring.stop:branch", "expenses.profit.read:branch"] },
    { key: "branch_manager", types: ["agency"],
      add: ["expenses.expense.read:branch", "expenses.expense.create:branch", "expenses.expense.update:branch", "expenses.expense.delete:branch", "expenses.expense.confirm:branch",
            "expenses.recurring.read:branch", "expenses.recurring.create:branch", "expenses.recurring.update:branch", "expenses.recurring.stop:branch", "expenses.profit.read:branch"] },
  ],

  approvals: [
    { action: "expenses.expense.confirm", label: { en: "Confirm an expense above a limit" }, money: true, enabledByDefault: false, approverPermission: "expenses.expense.confirm" },
  ],

  menu: [
    { id: "expenses", label: { en: "Expenses", ne: "खर्च" }, icon: "receipt", path: "/business/expenses", group: "money", order: 40,
      permission: "expenses.expense.read", badge: { endpoint: "/expenses?status=draft&per=1", field: "meta.total" } },
  ],

  events: {
    publishes: [
      { name: "expenses.expense.confirmed", v: 1, label: "An expense was added or a draft was confirmed",
        payload: { expenseId: "id", branchId: "id", category: "string", amountPaisa: "paisa", spentOn: "date", method: "string" } },
      { name: "expenses.expense.updated",   v: 1, label: "An expense was changed",
        payload: { expenseId: "id", branchId: "id", amountPaisa: "paisa", previousAmountPaisa: "paisa" } },
      { name: "expenses.expense.deleted",   v: 1, label: "An expense was deleted",
        payload: { expenseId: "id", branchId: "id", amountPaisa: "paisa" } },
      { name: "expenses.expense.skipped",   v: 1, label: "A recurring draft was skipped",
        payload: { expenseId: "id", recurringId: "id", forMonth: "string" } },
      { name: "expenses.recurring.draft_created", v: 1, label: "A recurring expense made this month's draft",
        payload: { recurringId: "id", expenseId: "id", forMonth: "string", branchId: "id" } },
    ],
    consumes: [],     // nothing yet. Later: invoicing.payout.paid, to refresh profit caches.
  },

  // Proposals. "minutesSaved" is a first guess for the owner to confirm or change in admin; none of these exist yet.
  ai: [
    { id: "receipt_reader",   name: { en: "Read a receipt" },        description: { en: "Fills date, vendor, amount and category from a receipt photo." },     minutesSaved: 2,  status: "planned", permission: "expenses.expense.create" },
    { id: "categoriser",      name: { en: "Suggest the category" },  description: { en: "Picks the category from the vendor and note." },                       minutesSaved: 0.5, status: "planned", permission: "expenses.expense.create" },
    { id: "monthly_summary",  name: { en: "Explain the month" },     description: { en: "A short note on what changed in spending and profit this month." },    minutesSaved: 15, status: "planned", permission: "expenses.profit.read" },
  ],

  dependencies: {
    requires: [],
    optional: ["invoicing", "rentals"],                       // profit adds their income when present
    reads: ["BizReceipt", "BizInvoice", "Payout", "PayoutItem", "OwnerStatement"],   // the tables profitRows() reads today (KERNEL.md §10.6)
  },

  models: ["Expense", "RecurringExpense"],
  branchOwned: [
    { model: "Expense",          label: { en: "expense" } },
    { model: "RecurringExpense", label: { en: "expense" } },
  ],

  settings: [
    { key: "expenses.categories", label: { en: "Expense categories" }, scope: "platform", type: "list",
      legacy: "AppSetting 'catalog' → lists.expenseCategories (edited in Admin → Listing setup)" },
    { key: "expenses.approval.limit", label: { en: "Ask for approval above (Rs.)" }, scope: "business", type: "money", default: null },
  ],

  jobs: [
    { id: "expenses.generate-due", every: "6h", label: "Add this month's drafts for recurring expenses" },
  ],
} satisfies AppManifest;

export default manifest;
```

Notes on the choices above:

- **`read` includes `recurring.read` and `profit.read` for the same people** because `expenses.view` was one switch for the three
  tabs. The role screen can then separate them later.
- **`expenses.manage` → eight permissions** (ACCESS.md §6.1). Accountants and agency branch managers get all of them, so their
  screens do not change.
- The `ne` text is a first draft; the owner's Nepali editor should check it.
- Free limits are `null` on purpose (rule §5).

---

## 7. The Reviews manifest (short, same format)

```ts
// apps/reviews/app.manifest.ts
const manifest = {
  manifestVersion: 1,
  id: "reviews", kind: "app",
  name: { en: "Reviews", ne: "समीक्षा" },
  tagline: { en: "See what people say about your business and reply in public." },
  icon: "star", category: "growth", businessTypes: "all",
  trialDays: null, limits: [],
  editions: [{ id: "free", name: { en: "Free" }, free: true, limits: {}, features: [], price: null }],
  permissions: [
    { id: "reviews.review.read",  label: { en: "See reviews" },          scopes: ["branch", "all"], default: "branch", group: "Reviews" },
    { id: "reviews.review.reply", label: { en: "Reply to reviews" },     scopes: ["branch", "all"], default: "branch", group: "Reviews" },
  ],
  // Today: customers.view reads reviews, reviews.reply replies (and reads). Roles that hold them:
  roles: [
    { key: "frontdesk",     types: ["hotel"],     add: ["reviews.review.read:branch"] },
    { key: "cohost",        types: ["host"],      add: ["reviews.review.read:branch", "reviews.review.reply:branch"] },
    { key: "sales_manager", types: ["developer"], add: ["reviews.review.read:branch"] },
    { key: "sales_exec",    types: ["developer"], add: ["reviews.review.read:branch"] },
    { key: "branch_manager",types: ["agency"],    add: ["reviews.review.read:branch", "reviews.review.reply:branch"] },
  ],
  approvals: [],
  menu: [{ id: "reviews", label: { en: "Reviews", ne: "समीक्षा" }, icon: "star", path: "/business/reviews", group: "customers", order: 30,
           anyPermission: ["reviews.review.read", "reviews.review.reply"] }],
  events: {
    publishes: [{ name: "reviews.review.replied", v: 1, label: "A business replied to a review", payload: { reviewId: "id", hasReply: "boolean" } }],
    consumes: [],
  },
  ai: [{ id: "reply_drafter", name: { en: "Draft a reply" }, description: { en: "Writes a polite first reply you can edit." }, minutesSaved: 3, status: "planned", permission: "reviews.review.reply" }],
  dependencies: { requires: [], optional: ["listings"], reads: ["Listing"] },   // reviews of listings in view
  models: ["Review"],
  branchOwned: [],                                           // reviews do not belong to a branch
  settings: [],
  jobs: [],
} satisfies AppManifest;
```

(The hotel "manager" holds every hotel-type permission, so it needs no line. Agents, cashiers and accountants have never had
review access and get none.)

---

## 8. Manifests that exist only for permissions (Phase 1)

The generator replaces the hand-written lists in `permissions.ts` / `rbac.js`, so **every** permission in the old files needs a
manifest, even for areas that are not on the kernel yet (hotel, POS, projects, listings…). For those the manifest is
"declaration only": id, name, icon, `businessTypes`, `permissions`, `roles`, `menu`. No backend or frontend folder is needed;
their routes stay in `business/backend/src/modules/*`. They get checked with the new names through the alias layer
(ACCESS.md §6.3). The apps in ACCESS.md §6.1 marked * are proposals; the owner can rename an app id before Phase 1 ends
without cost, because the old names keep working until the alias layer is removed.

| Manifest | Kind | Has code in Phase 1? |
|---|---|---|
| `workspace` | core | team, roles, branches, settings routes stay in `business/backend` |
| `platform` | platform | admin routes stay in `admin/backend`; file lives in `platform/tenancy/platform.manifest.ts` |
| `expenses`, `reviews` | app | **yes, moved onto the kernel** |
| `hotel`, `pos`, `projects`, `collections`, `listings`, `crm`, `rentals`, `investments`, `agreements`, `people`, `invoicing` | app | declaration only |

---

## 9. What the checker (`scripts/check-manifests.mjs`) enforces

1. Folder name = `id`. Every `permissions[].id` and `events.publishes[].name` starts with `<id>.` and has exactly three
   dot-separated parts.
2. Every permission appearing in `roles[].add`, `menu[].permission`, `approvals[].action`, `ai[].permission` is declared (in this
   app or in `workspace`). Pattern entries (`workspace.role.*`) only in `roles`.
3. Every scope suffix in `roles[].add` is allowed by that permission's `scopes`.
4. `events.consumes[].name` is published by some manifest; `requires` has no cycle and names real apps.
5. Every name in `models` has `/// @app <id>` in `schema.prisma`, and every `/// @app <id>` model is listed. Every model with
   a `branchId` field is in `branchOwned`.
6. Each `ne` text exists (a warning in Phase 1, an error later).
7. The generated files are current (`gen:permissions --check`).
8. No manifest imports anything but types.
