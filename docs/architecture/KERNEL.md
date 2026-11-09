# Platform kernel: base classes and conventions

Status: design for Phase 1 (task P1-ARCH-1). Nothing here is built yet. The Backend and Database specialists build from
this file. Read [ACCESS.md](ACCESS.md) next: the request context below is built from the access model.

Plain-English rule of this file: every signature is exact TypeScript, every rule has a "why".

---

## 1. What the kernel is

Today every business module (expenses, reviews, listings…) repeats the same steps by hand: find the business and role
(`workspaceOf`), check a permission, parse input with zod, add `tenantId` and the branch filter to every query, write the
audit row, send a notification. Expenses repeats them in 20 routes. The kernel does these steps **once**, in four base
classes, so an app only writes what is special about it.

```
HTTP request
  → BaseController   builds the RequestContext, validates the query/body shape, formats { data, meta, message }
  → BaseService      checks app + permission + data scope, runs business rules, writes audit + events, one transaction
  → BaseRepository   the only code that touches Prisma; always adds business, branch, own and "not deleted" filters
  → PostgreSQL
```

Rules that never change:

1. **Only a repository talks to Prisma** for business data. Services and controllers never import `@prisma/client`
   delegates. (Why: tenant isolation is then one place to test, not 40.)
2. **A repository never receives a business id from a caller.** It reads it from the context. (Why: a bug in a route can
   no longer read another business.)
3. **One write = one transaction** holding the row change, the audit row and the event row. (Why: today the audit row is
   written after the change; a crash between them loses the audit.)
4. **Names stay as they are in the database.** The business is the Prisma model `Tenant`, the column is `tenantId`.
   The kernel says "business" in code and docs, and maps to `tenantId` in one config line. (Why: TEAM-RULES forbids
   renaming columns.)
5. **Errors keep the current wire format** `{ message, code, errors?, requestId }` (`lib/errors.ts`). No app changes.

---

## 2. Where the kernel lives

Folder `platform/core/` (the move plan is in [FOLDERS-AND-MOVE-PLAN.md](FOLDERS-AND-MOVE-PLAN.md)). Files:

| File | Holds |
|---|---|
| `platform/core/errors.ts` | `AppError` and helpers (moved from `backend-core/src/lib/errors.ts`, same class) |
| `platform/core/money.ts` | `Money` |
| `platform/core/context.ts` | `BaseContext`, `BusinessContext`, `StaffContext`, `BranchScope`, `PermissionSet`, `Entitlements` |
| `platform/core/repository.ts` | `BaseRepository`, `ListQuery`, `Page` |
| `platform/core/service.ts` | `BaseService` |
| `platform/core/controller.ts` | `BaseController` |
| `platform/core/events.ts` | `DomainEvent`, `EventBus` |
| `platform/core/validation.ts` | shared zod pieces (`Day`, `Month`, `Page`, `Sort`, `Id`) taken from Expenses |

---

## 3. AppError

Same class as today. Added: an optional `details` bag, and two helpers. Nothing that exists changes.

```ts
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly errors?: Record<string, string[]>,   // field errors, 422 shape
    readonly details?: Record<string, unknown>,   // NEW: extra safe facts, e.g. { limit: 50 }. Sent to the browser.
  );
}

// Existing, unchanged:
export const badRequest:   (message: string, errors?: Record<string, string[]>) => AppError; // 400 bad_request
export const unauthorized: (message?: string) => AppError;                                    // 401 unauthorized
export const forbidden:    (message?: string) => AppError;                                    // 403 forbidden
export const notFound:     (message?: string) => AppError;                                    // 404 not_found
export const conflict:     (message: string) => AppError;                                     // 409 conflict

// NEW:
export const versionConflict: (what: string) => AppError;
//   409 "version_conflict": "<what> was changed by someone else. Reload and try again."
export const planLimit: (code: "plan_feature" | "seat_limit" | "upgrade_needed" | "app_limit", message: string, details?: Record<string, unknown>) => AppError;
//   402 — the same status and codes the team and branding routes use today with `new AppError(402, ...)`.
```

Why `versionConflict` is its own code: the screen can show "Reload" instead of a red error.

---

## 4. Money

Phase 1 moves money to **paisa** (1 rupee = 100 paisa). Today everything is whole rupees (`Int`, `MAX_EXPENSE = 2_000_000_000`).

```ts
export class Money {
  readonly paisa: number;                         // always a safe integer (Number.isSafeInteger); negative allowed for refunds
  static paisa(n: number): Money;                 // throws if not an integer
  static rupees(r: number | string): Money;       // "1250.50" → 125050. Throws if more than 2 decimals.
  static zero(): Money;

  plus(o: Money): Money;
  minus(o: Money): Money;
  times(n: number): Money;                        // n may be fractional; result rounded half away from zero
  percent(pct: number, mode?: "round" | "floor" | "ceil"): Money;   // default "round"
  split(ratios: number[]): Money[];               // shares always add back to the original: no lost paisa
  splitVat(ratePct: number): { subtotal: Money; vat: Money; total: Money };   // price includes VAT, like domain/billing.ts splitVat()

  compare(o: Money): -1 | 0 | 1;
  equals(o: Money): boolean;
  isZero(): boolean;
  isNegative(): boolean;

  toRupeesWhole(): number;                        // throws if there are paisa. For old endpoints that still return whole rupees.
  toString(): string;                             // "1250.50"
  toJSON(): { paisa: number };                    // new endpoints send { paisa: 125050 }
}
```

How it is stored: a Prisma `BigInt` column named `<field>Paisa` (for example `amountPaisa`). `BigInt` because
`Int` stops at about 21 million rupees in paisa. The repository turns it into `Money` with `Number(bigint)`, which is safe up
to 90 trillion rupees. Rule: **never** do money maths with plain numbers in an app; use `Money`.

Phase 1 compatibility: old endpoints keep sending and accepting **whole rupees** in a field called `amount`
(exactly as `Expenses` does now, including "Use whole rupees."). The service converts with `Money.rupees(amount)` on the
way in and `toRupeesWhole()` on the way out. New endpoints and new apps use `{ paisa }` or `Money` strings. The old
`amount` column stays until a later task that is allowed to drop it (TEAM-RULES: never drop unless the task says).

---

## 5. The request context

One object per request. Controllers build it, services and repositories read it. It replaces `Workspace` from
`business/backend/src/modules/access.ts` (which stays as a thin shim until the move is finished).

```ts
export type Tx = Prisma.TransactionClient;

export type Actor =
  | { kind: "user";   userId: string; name: string }
  | { kind: "staff";  staffId: string; name: string; role: string }          // Sheetal staff (admin panel, or impersonating)
  | { kind: "system"; job: string };                                          // background jobs, event handlers

export interface BaseContext {
  readonly requestId: string;            // request.id, returned in every error
  readonly ip: string;
  readonly now: Date;                    // fixed for the whole request; tests can set it. Stored in UTC.
  readonly actor: Actor;
  readonly db: Db;                       // the PrismaClient (lib/db.ts)
  readonly tx: Tx | null;                // set only inside ctx.transaction()
  readonly log: FastifyBaseLogger;
  transaction<R>(fn: (ctx: this) => Promise<R>): Promise<R>;   // returns a copy of the context with tx set
}

export interface BusinessContext extends BaseContext {
  readonly business: { id: string; name: string; type: BusinessType; status: string; planId: string };
  readonly member: { userId: string; membershipId: string; roleId: string; roleKey: string; isOwner: boolean };
  readonly branches: BranchScope;
  readonly permissions: PermissionSet;
  readonly entitlements: Entitlements;
  readonly impersonation: { staffId: string; reason: string; expiresAt: Date; readOnly: boolean } | null;
}

export interface StaffContext extends BaseContext {
  readonly staff: { id: string; role: string };
  readonly permissions: PermissionSet;   // platform permissions, see ACCESS.md §6.2 and §11
}
```

### 5.1 Branch scope

Replaces `branchesOf`, `branchView`, `inView`, `branchFor` and `worksAt`. All of them work with **branch ids** (see
ACCESS.md §3 for the migration from names).

```ts
export interface BranchInfo { id: string; name: string; status: "open" | "closed" }

export interface BranchScope {
  /** What the person's membership allows: every branch of the business, or a list of branch ids. Owners are always "all". */
  readonly allowed: "all" | readonly string[];
  /** The branches this person may use (loaded once per request). */
  readonly mine: readonly BranchInfo[];
  /** What the top bar picked (x-branch). null = "All branches". */
  readonly picked: string | null;
  /** Branch ids to filter by for a data scope. null = no branch filter (the whole business). */
  idsFor(scope: DataScope): readonly string[] | null;
  /** The branch for new work: asked → picked → the person's only open branch; throws like branchFor() does today. */
  branchForNew(asked?: string | null): string;
  /** Whether a record of this branch is visible to this person (records with no branch belong to everyone). */
  canSee(branchId: string | null | undefined): boolean;
}
```

`idsFor` rules, in plain words:

- `scope "all"` → `null` (the whole business). Only roles whose permission is granted with the `all` data scope get this.
- `scope "branch"` → the picked branch if one is picked, else all branches in `mine`. Owners and "all branches" people:
  `null` when nothing is picked (so a record with a `null` branch is still visible to them), exactly like `inView` today.
- `scope "own"` → same branches as `"branch"`; the repository adds the owner filter (§6).

The error messages stay word for word: "You don't work at that branch.", "That branch is closed.", "Pick a branch first…".

### 5.2 Permission set

```ts
export type DataScope = "own" | "branch" | "all";     // narrowest → widest
export type PermissionId = string;                    // "app.resource.action", e.g. "expenses.expense.create"

export interface PermissionSet {
  can(perm: PermissionId): boolean;                   // true for "*" holders
  scopeOf(perm: PermissionId): DataScope | null;      // null = not granted. "*" → "all".
  require(perm: PermissionId, message?: string): DataScope;   // throws forbidden(message) if not granted; returns the scope
  canAny(perms: readonly PermissionId[]): boolean;
}
```

### 5.3 Entitlements

What the business has bought or been given. In Phase 1 it is built from today's plan (`plan.limits`, `plan.features`,
`effectiveLimits()` in `domain/addons.ts`) so nothing changes; in Phase 3 it is built from per-app subscriptions.

```ts
export interface Entitlements {
  hasApp(appId: string): boolean;                     // is the app installed and paid/free-tier for this business?
  edition(appId: string): string | null;              // "free" | "pro" | ... (Phase 3); Phase 1: "default"
  limit(appId: string, key: string): number | null;   // null = unlimited; -1 from old plans is mapped to null
  feature(key: string): boolean;                      // e.g. "custom_roles", "branding.custom", "all_kinds"
  seats(): { used: number; limit: number | null };
  ai(appId: string): "locked" | "own_key" | "sheetal";
}
```

Phase 1 mapping: `hasApp` is true for every app the business type had before (so nobody loses a screen);
`limit()` reads `effectiveLimits`; `feature("custom_roles")` reads `plan.features.custom_roles`.

---

## 6. BaseRepository<T>

### 6.1 The row shape every kernel table carries

```ts
export interface Entity {
  id: string;
  version: number;            // starts at 1, +1 on every update
  createdAt: Date; updatedAt: Date;
  createdBy: string | null;   // user id
  updatedBy: string | null;
  deletedAt: Date | null;     // soft delete
  deletedBy: string | null;
}
export interface BusinessEntity extends Entity { tenantId: string }          // the business
export interface BranchEntity   extends BusinessEntity { branchId: string }  // belongs to one branch
```

Database work (task P1-DB-1): add `version Int @default(1)`, `updatedBy`, `deletedAt`, `deletedBy` to `Expense` and
`RecurringExpense`, and `Review` gets `version` only (Sheetal hides reviews; a business never deletes one). Adding the
columns is additive: no data lost, no drop. Existing `createdBy` is reused.

### 6.2 Config

Each repository declares what may be filtered and sorted. Anything not listed is refused (why: no client can sort or
filter by a column that has no index or that leaks data).

```ts
export type FilterOp = "eq" | "ne" | "in" | "gte" | "lte" | "between" | "contains" | "isNull";

export interface RepositoryConfig<T extends BusinessEntity> {
  model: string;                                   // Prisma delegate name, e.g. "expense"
  tenantField?: string;                            // default "tenantId"
  branchField?: string | null;                     // default "branchId"; null for business-wide tables
  ownerField?: (keyof T & string) | null;          // who "own" means, e.g. "createdBy"; null = "own" not supported
  filterable: Partial<Record<keyof T & string, readonly FilterOp[]>>;
  sortable: readonly (keyof T & string)[];
  defaultSort: readonly SortSpec[];
  searchable?: readonly (keyof T & string)[];      // fields the free-text "q" looks in (contains, case-insensitive)
  maxPerPage?: number;                             // default 200
  legacyMaxRows?: number;                          // old endpoints that return a plain list (Expenses: 2000), see §10.3
}

export interface SortSpec { field: string; dir: "asc" | "desc" }
export interface Filter  { field: string; op: FilterOp; value: unknown }

export interface ListQuery {
  page?: number;               // 1-based, default 1
  per?: number;                // default 50, capped by maxPerPage
  sort?: readonly SortSpec[];
  filters?: readonly Filter[];
  q?: string;
}

export interface Page<R> {
  rows: R[];
  meta: { total: number; current_page: number; last_page: number; per_page: number };   // the shape the panels already use
}
```

### 6.3 Class

`Db` here is `ctx.tx ?? ctx.db`: inside a transaction the repository joins it automatically.

```ts
export abstract class BaseRepository<T extends BusinessEntity, Create extends object, Update extends object> {
  constructor(protected readonly cfg: RepositoryConfig<T>);

  // ── The one place filters are built. Every method below uses it. ──
  /** tenant + not deleted + branch (by data scope) + owner (when scope is "own"). Subclasses may add to it with extraScope(). */
  protected scopeWhere(ctx: BusinessContext, scope: DataScope): Record<string, unknown>;
  /** Hook for tables whose visibility is not just branch: Reviews (business OR its listings in view). Default: {}. */
  protected extraScope(ctx: BusinessContext, scope: DataScope): Record<string, unknown> | Promise<Record<string, unknown>>;

  // ── Read ──
  find(ctx: BusinessContext, id: string, scope: DataScope, opts?: { includeDeleted?: boolean }): Promise<T | null>;
  get(ctx: BusinessContext, id: string, scope: DataScope, opts?: { includeDeleted?: boolean }): Promise<T>;    // notFound() if missing or out of scope
  list(ctx: BusinessContext, scope: DataScope, query?: ListQuery): Promise<Page<T>>;
  count(ctx: BusinessContext, scope: DataScope, filters?: readonly Filter[]): Promise<number>;

  // ── Write ──
  /** Sets tenantId from the context, branchId from the data (already checked by the service), createdBy/updatedBy, version 1. */
  create(ctx: BusinessContext, data: Create & { branchId?: string }): Promise<T>;
  /** Updates only when `version` still matches, then bumps it. Throws versionConflict if someone else changed the row.
   *  expectedVersion undefined = last write wins (allowed only where RepositoryConfig / service say so). */
  update(ctx: BusinessContext, id: string, data: Update, scope: DataScope, expectedVersion?: number): Promise<T>;
  /** Compare-and-set: change the row only if it still looks like `from` (e.g. { status: "draft" }). Returns false if not.
   *  This is the "Taken only if it is still a draft" trick of expenses/:id/confirm, now reusable. */
  transition(ctx: BusinessContext, id: string, from: Partial<T>, to: Update, scope: DataScope): Promise<boolean>;
  softDelete(ctx: BusinessContext, id: string, scope: DataScope, expectedVersion?: number): Promise<void>;
  restore(ctx: BusinessContext, id: string, scope: DataScope): Promise<T>;
}
```

There is **no** `hardDelete` in the base class. A table that really needs one (a draft that was never saved) gets a
named method in its own repository, with a comment saying why.

### 6.4 What "scopeWhere" builds

For `ctx` = business B, person P, and permission scope S:

```
{ tenantId: B.id, deletedAt: null }
 + S = "all"    → nothing more
 + S = "branch" → branchId IN ctx.branches.idsFor("branch")        (skipped when null)
 + S = "own"    → branchId IN ctx.branches.idsFor("own") AND <ownerField> = P.userId
 + extraScope()
```

This is a direct generalisation of `{ tenantId, ...inView(v) }` in every route today.

### 6.5 The isolation test (required for every repository)

`platform/core/testing/isolation.ts` exports `testRepositoryIsolation(repo, factory)`. It creates two businesses with two
branches each and checks that every method refuses or hides rows of the other business, of other branches (scope
`branch`), and of other people (scope `own`), and that soft-deleted rows never appear. Each app adds one line
calling it. (Why: this is the test that would have caught a forgotten `tenantId`.)

---

## 7. BaseService<T>

The service is where the rules live.

```ts
export interface ResourcePermissions {
  read: PermissionId;            // list + get
  create: PermissionId;
  update: PermissionId;
  delete: PermissionId;          // also guards restore
}

export interface ServiceDeps<T extends BusinessEntity, C extends object, U extends object> {
  app: string;                                   // app id from the manifest, e.g. "expenses"
  resource: string;                              // "expense"
  repo: BaseRepository<T, C, U>;
  permissions: ResourcePermissions;
  schemas: { create: z.ZodType<C>; update: z.ZodType<U>; list?: z.ZodType<ListQuery> };
  audit: { entity: string; label: (row: T) => string };       // label goes in AuditLog.target, e.g. "EX-0007 Rs. 1500"
  bus: EventBus;
  /** false = an update without `version` is allowed (last write wins). Default true. Expenses sets false in Phase 1. */
  requireVersion?: boolean;
}

export abstract class BaseService<T extends BusinessEntity, C extends object, U extends object> {
  constructor(protected readonly deps: ServiceDeps<T, C, U>);

  // ── Standard operations, in the order every one of them runs ──
  //   1 app on?  2 permission + scope  3 parse input  4 before-hook  5 transaction { repo write, audit, event }  6 after-commit
  list(ctx: BusinessContext, rawQuery: unknown): Promise<Page<T>>;
  get(ctx: BusinessContext, id: string): Promise<T>;
  create(ctx: BusinessContext, raw: unknown): Promise<T>;
  update(ctx: BusinessContext, id: string, raw: unknown): Promise<T>;
  remove(ctx: BusinessContext, id: string, version?: number): Promise<void>;     // soft delete
  restore(ctx: BusinessContext, id: string): Promise<T>;

  // ── Hooks an app overrides (all optional, all run inside the transaction) ──
  protected beforeCreate(ctx: BusinessContext, data: C): Promise<C>;                         // business rules, e.g. category check
  protected beforeUpdate(ctx: BusinessContext, current: T, data: U): Promise<U>;
  protected beforeDelete(ctx: BusinessContext, current: T): Promise<void>;                   // may refuse: "a draft is skipped, not deleted"
  protected afterWrite(ctx: BusinessContext, row: T, kind: "created" | "updated" | "deleted" | "restored"): Promise<void>;

  // ── For actions that are not plain create/update/delete (confirm, pause, reply, cancel) ──
  protected action<R>(ctx: BusinessContext, a: {
    name: string;                    // "confirm"
    permission: PermissionId;        // "expenses.expense.confirm"
    scope?: DataScope;               // default: the scope the person was granted
    approval?: ApprovalSpec;         // maker-checker, see ACCESS.md §9
    audit: (result: R) => { action: string; target: string; meta?: object };
    event?: (result: R) => { name: string; payload: object };
    run: (ctx: BusinessContext, scope: DataScope) => Promise<R>;   // runs inside the transaction
  }): Promise<R>;

  // ── Helpers ──
  protected parse<X>(schema: z.ZodType<X>, raw: unknown): X;        // zod → 422 with field errors (errorHandler already does this)
  protected requireApp(ctx: BusinessContext): void;                 // forbidden("<App> isn't part of your plan.") if !entitlements.hasApp
  protected requireLimit(ctx: BusinessContext, key: string, used: number): void;  // planLimit(402) when over the free limit
}
```

What the standard write does for the caller (this is what the 20 hand-written routes in `expenses/routes.ts` repeat today):

| Step | Today in each route | In the kernel |
|---|---|---|
| App is on for this business | not checked | `requireApp` |
| Permission | `canWrite(ws)` helper written per module | `permissions.require(...)` → scope |
| Input | `Body.parse(request.body)` | `parse(schemas.create, raw)` |
| Branch for new work | `branchFor(await branchView(...), b.branchId)` | `ctx.branches.branchForNew(asked)` in `create` |
| Query with tenant and branch | `{ tenantId, ...inView(v) }` typed by hand | `repo.scopeWhere` |
| Audit | `audit(ws, request.ip, action, target)` after the write | inside the transaction, from `deps.audit` |
| Event | none | `bus.publish` inside the transaction |
| Concurrency | `updateMany({ where: { id, status: "draft" } })` in one place | `repo.update(..., version)` / `repo.transition` |

The audit row written by the kernel: `AuditLog { tenantId, actorId, action: "<app>.<resource>.<verb>"... }`. To keep the
old activity feed readable, the **action string stays the old one** in Phase 1 (`"expense.added"`, `"expense.confirmed"`).
`deps.audit` can override the default per operation (see the Expenses example).
When `ctx.actor.kind === "staff"` (impersonation) the row also carries `meta.impersonatedBy` and `meta.reason` (ACCESS.md §12).

---

## 8. BaseController

A controller turns HTTP into context + service calls. Standard routes come free; custom ones are one line each.

```ts
export interface ControllerConfig<T extends BusinessEntity> {
  basePath: string;                                         // "/expenses"
  present: (row: T, ctx: BusinessContext) => unknown;       // the JSON shape; keeps today's field names
  listQuery: z.ZodType<ListQuery>;                          // how ?page=&per=&sort=&status=&month= map to a ListQuery
  standardRoutes?: Array<"list" | "get" | "create" | "update" | "delete" | "restore">;   // default: all. Expenses omits "get" and "restore" in Phase 1.
  messages?: Partial<Record<"created" | "updated" | "deleted", (row: T) => string>>;     // "EX-0007 saved."
}

export abstract class BaseController<T extends BusinessEntity> {
  constructor(protected readonly service: BaseService<T, any, any>, protected readonly cfg: ControllerConfig<T>);

  /** Registers the standard routes and calls routes(). */
  register(app: FastifyInstance): void;
  /** Where a controller adds its own routes (profit, receipt, pause/resume). */
  protected routes(app: FastifyInstance): void;

  /** Builds the BusinessContext from x-tenant-id, x-branch and the session. Replaces workspaceOf(). */
  protected ctxOf(request: FastifyRequest): Promise<BusinessContext>;

  /** { data, message? } or { data, meta, message? }: the response shape all panels already read. */
  protected ok<D>(data: D, extra?: { meta?: object; message?: string }): { data: D; meta?: object; message?: string };
  protected done(message: string): { message: string };
}
```

Rate limits and body limits (`bodyLimit`, `config.rateLimit` on the receipt upload) stay as options on the custom route.

Public (website) and staff (admin) requests: the website API has no business, so it keeps plain Prisma until Phase 2.
The admin API gets `StaffContext` and `BaseController` with `ctxOf` returning a `StaffContext`
(replacing `staffOf(request, perm)`). Nothing else in this file changes for them.

---

## 9. Events and the bus

Apps talk to each other through **events**, never by importing each other's code (why: Expenses can run without Invoicing
installed; an app can be switched off).

```ts
export interface DomainEvent<P = unknown> {
  id: string;                    // uuid; also the idempotency key
  name: string;                  // "expenses.expense.confirmed": <app>.<resource>.<past-tense verb>
  v: number;                     // payload version, starts at 1
  at: Date;
  businessId: string;
  branchId: string | null;
  actor: Actor;
  requestId: string;
  payload: P;                    // small, JSON, no secrets, no files. Ids and amounts (as paisa), not whole rows.
}

export interface EventHandlerOptions {
  id: string;                    // unique handler id, e.g. "invoicing.on-expense-confirmed". Used for "run once per event".
  app: string;                   // the app that owns the handler; must list the event in manifest.events.consumes
}

export interface EventBus {
  /** Writes an EventOutbox row inside ctx.tx (so it commits or rolls back with the change). Throws if the event name is
   *  not in the publishing app's manifest.events.publishes (in development and tests; in production it logs). */
  publish<P>(ctx: BusinessContext, name: string, payload: P, v?: number): Promise<void>;
  subscribe<P>(pattern: string, handler: (e: DomainEvent<P>, ctx: SystemContext) => Promise<void>, opts: EventHandlerOptions): () => void;
  /** Starts the dispatcher (a job in platform/jobs). Safe to call once per process. */
  start(): void;
  /** Tests: deliver everything waiting now and wait for it. */
  drain(): Promise<void>;
}
```

Delivery rules:

1. **Outbox.** `publish` inserts `EventOutbox(id, name, v, payload Json, tenantId, branchId, actor Json, requestId, createdAt, dispatchedAt, attempts, lastError)`
   in the same transaction as the change. A dispatcher job (runs every few seconds, and once right after a commit) reads
   rows with `dispatchedAt IS NULL`, calls handlers, and sets `dispatchedAt`.
2. **At least once, in order per business.** A handler can see an event twice, so it must be safe to repeat. The table
   `EventDelivery(eventId, handlerId)` with a unique key makes "run once per handler" a database fact.
3. **Failures** retry with a growing delay, up to 8 times, then stay in the outbox as dead letters. Admin → System status
   lists them. One failing handler never blocks the others.
4. **Patterns**: `subscribe("expenses.*")`, `subscribe("*.expense.confirmed")`. Wildcards only for whole segments.
5. **System context.** A handler runs with `SystemContext` = a `BusinessContext` whose actor is
   `{ kind: "system", job: handlerId }` and whose permission set is `"*"` **limited to the event's business** (the
   repository still adds `tenantId` from it). Handlers never get another business's data.

Recommendation: keep the dispatcher inside the API process for Phase 1 (same as `startExpenseJob`); move it to BullMQ
with the other jobs when Redis is added (backend-plan: Redis + BullMQ). Alternative: Postgres `LISTEN/NOTIFY`: faster, but
more moving parts for a small team.

---

## 10. Worked example: Expenses on the kernel

This shows signatures and flow. The Backend specialist writes the code (task P1-BE-5). Behaviour stays the same; the
few differences are listed in §10.5.

### 10.1 Files

```
apps/expenses/
  app.manifest.ts                      ← APP-MANIFEST.md §6
  backend/
    expense.repository.ts              ExpenseRepository, RecurringExpenseRepository
    expense.service.ts                 ExpenseService (+ confirm, skip), RecurringExpenseService (+ pause/resume/stop, generateDue)
    expense.controller.ts              ExpenseController, RecurringController; profit + receipt routes
    expense.presenter.ts               present(), presentRecurring()  (moved from the route file)
    profit.ts                          profitRows(), paymentSplit(), monthSpan(), monthsBetween()  (moved from domain/expenses.ts)
    categories.ts                      EXPENSE_CATEGORIES, expenseCategories(db), expenseNo()
    jobs.ts                            registers "expenses.generate-due" (every 6 h)
    events.ts                          event names + payload types
    routes.ts                          export async function expenseRoutes(app) { new ExpenseController(...).register(app) ... }
    test/                              expenses.test.ts (moved), isolation.test.ts, profit.test.ts
  frontend/                            FRONTEND-KIT.md §9
```

### 10.2 Repository

```ts
export interface ExpenseRow extends BranchEntity {
  seq: number; status: "confirmed" | "draft" | "skipped";
  spentOn: Date; category: string; amountPaisa: number; vendor: string | null; note: string | null;
  method: string; receiptFile: string | null; recurringId: string | null; forMonth: string | null;
  confirmedBy: string | null; confirmedAt: Date | null;
}

export class ExpenseRepository extends BaseRepository<ExpenseRow, CreateExpense, UpdateExpense> {
  constructor() {
    super({
      model: "expense", ownerField: "createdBy",
      filterable: { status: ["eq", "in"], spentOn: ["gte", "lte", "between"], category: ["eq", "in"], branchId: ["eq", "in"] },
      sortable: ["spentOn", "seq", "amountPaisa", "createdAt"],
      defaultSort: [{ field: "spentOn", dir: "desc" }, { field: "seq", dir: "desc" }],   // the order the page has today
      legacyMaxRows: 2000,
    });
  }
  /** Used by profit: confirmed expenses of a month range, only fields profit needs. */
  confirmedBetween(ctx: BusinessContext, scope: DataScope, from: Date, to: Date): Promise<Pick<ExpenseRow, "branchId" | "spentOn" | "amountPaisa">[]>;
  /** The recurring-expense job's insert: ON CONFLICT DO NOTHING on (recurringId, forMonth). Named method because it is not a normal create. */
  createDraftIfMissing(ctx: BusinessContext, t: RecurringExpenseRow, month: string): Promise<boolean>;
  // `seq` (EX-0007) is still given by the database default, as today. No hard delete here: see §10.5 (1).
}
```

### 10.3 Service

```ts
export class ExpenseService extends BaseService<ExpenseRow, CreateExpense, UpdateExpense> {
  constructor(deps: ...) {
    super({
      app: "expenses", resource: "expense", repo: new ExpenseRepository(),
      permissions: {
        read:   "expenses.expense.read",
        create: "expenses.expense.create",
        update: "expenses.expense.update",
        delete: "expenses.expense.delete",
      },
      schemas: { create: ExpenseBody, update: ExpenseBody.omit({ branchId: true }) },    // the zod objects from routes.ts, unchanged
      audit: { entity: "expense", label: (e) => `${expenseNo(e.seq)} Rs. ${Money.paisa(e.amountPaisa).toRupeesWhole()}` },
      bus: deps.bus,
      requireVersion: false,                                                            // Phase 1: no behaviour change
    });
  }

  protected beforeCreate(ctx, data)  { await this.checkCategory(ctx, data.category, data.note); return data; }     // moved from checkCategory()
  protected beforeUpdate(ctx, cur, d){ await this.checkCategory(ctx, d.category, d.note); return d; }
  protected beforeDelete(ctx, cur)   { /* recurring drafts are skipped, not deleted: handled in remove() override below */ }

  /** Business-rule overrides */
  remove(ctx, id): Promise<void>;           // if recurringId → status "skipped" (event expenses.expense.skipped); else soft delete

  /** Actions */
  confirm(ctx, id, raw): Promise<ExpenseRow>;   // this.action({ name:"confirm", permission:"expenses.expense.confirm", ... }), uses repo.transition(from {status:"draft"})
  attachReceipt(ctx, id, raw): Promise<void>;   // permission expenses.expense.update; stores with platform/files private storage
  readReceipt(ctx, id): Promise<{ type: string; data: Buffer }>;  // permission expenses.expense.read
  removeReceipt(ctx, id): Promise<void>;

  /** Reports */
  profit(ctx, q: { from?: string; to?: string }): Promise<ProfitReport>;   // permission expenses.profit.read; same maths as profitRows()
}
```

`RecurringExpenseService` has `create`, `update` (refuses when stopped), `pause`, `resume`, `stop` (three actions with the
same compare-and-set as the current `for (const [action, from, to, said] of …)` loop) and `generateDue(ctx|system, today)`.

### 10.4 Flow of three requests

**POST /v1/expenses** (add)

```
controller.ctxOf        session → user, x-tenant-id → membership, x-branch → picked; builds BusinessContext
service.create
  requireApp            entitlements.hasApp("expenses")
  permissions.require   "expenses.expense.create" → scope "branch"
  parse                 ExpenseBody (date, category, amount whole rupees, vendor, note, method, branchId)
  beforeCreate          checkCategory(): category in the business list; "other" needs a note of 3+ letters   (same messages)
  branchForNew          ctx.branches.branchForNew(b.branchId)                                                (same messages)
  ctx.transaction {
    repo.create         status "confirmed", confirmedBy/At = actor/now, amountPaisa = Money.rupees(amount).paisa
    audit               action "expense.added", target "EX-0007 Rs. 1500"
    bus.publish         "expenses.expense.confirmed" { expenseId, amountPaisa, branchId, category, spentOn }
  }
controller              { message: "EX-0007 saved.", data: present(row) }   ← identical JSON to today
```

**POST /v1/expenses/:id/confirm**

```
service.confirm → this.action({ name:"confirm", permission:"expenses.expense.confirm", ... })
  require perm, load row with repo.get(ctx, id, scope)   (skipped rows are "not found", as today)
  if row.status !== "draft" → badRequest("Only a draft can be confirmed.")
  checkCategory(next values)
  transaction {
    ok = repo.transition(id, from {status:"draft"}, to {…next, status:"confirmed", confirmedBy, confirmedAt})
    if (!ok) badRequest("Someone already confirmed this expense.")        ← the same compare-and-set as today
    audit "expense.confirmed" "EX-0007 Rs. 1800"
    publish "expenses.expense.confirmed"
  }
```

**GET /v1/expenses/profit**

```
service.profit
  require "expenses.profit.read"           (today: expenses.view or expenses.manage; see ACCESS.md §6 for the mapping)
  months = from..to (default last 12), limit 36 months (same messages)
  rows = profitRows(ctx, scope, ...)       reads Expense via ExpenseRepository, and BizReceipt, Payout, OwnerStatement
                                           through a small read-only "profit sources" interface (§10.6)
  → { from, to, rows, totals }             ← identical JSON
```

### 10.5 What is different from today (the only differences)

1. **Soft delete.** Deleting a normal expense used to remove the row; now `deletedAt` is set and every query hides it.
   Nobody sees a difference. Profit already counts only `confirmed`, and now also `deletedAt IS NULL`.
2. **Audit inside the transaction**, and one new event per change. No screen shows events yet.
3. **Recurring drafts** are still skipped, never deleted ("skipped" rows keep the month from being added twice). This rule
   is business logic, so it lives in `ExpenseService.remove()`, not in the base class.
4. **Amount stored in paisa** (`amountPaisa`). The API still takes and returns whole rupees under `amount`.
5. **`GET /expenses` without `page`/`per`** still returns up to 2000 rows (`legacyMaxRows`), as the page expects.
   With `page`/`per` it pages. The new `CrudPage` uses paging; the old call keeps working during the move.
6. **Permission names change** (ACCESS.md §6). Every role is rewritten by the migration so people keep the same abilities.

### 10.6 The profit sources (the one cross-app read)

`profitRows` needs invoice receipts (Invoicing), payouts (Payouts), and owner statements (Rentals). The kernel rule is "apps
do not import each other". Recommendation for Phase 1, to keep behaviour identical and the work small:

```ts
// platform/core/reports.ts
export interface ProfitSource {
  id: string;                                                   // "invoicing.receipts"
  incomeBetween(ctx: BusinessContext, scope: DataScope, o: { from: Date; to: Date }): Promise<ProfitIncomeRow[]>;
}
export interface ProfitIncomeRow { month: string; branchId: string; kind: "direct" | "vat" | "payouts" | "commission"; amount: Money }
```

Each of those areas registers a `ProfitSource` (a function). In Phase 1 the three sources are small adapters around the
existing queries in `profitRows`, living in `platform/billing` until Invoicing/Rentals become apps. The manifest of Expenses
lists them under `reads`. Alternative: leave `profitRows` untouched inside the Expenses app and only list the tables in
`reads`. It is faster; do it first if P1-BE-5 runs long, then split in Phase 2.

### 10.7 Reviews on the kernel (short)

- `ReviewRepository` extends `BaseRepository<ReviewRow>` with `branchField: null` and `extraScope()` returning
  `{ status: "published", OR: [{ tenantId }, { listingId: { in: <listings in view> } }] }`. This is today's `scope()`.
  It does not use the standard `tenantId` filter, so the repository config sets `tenantField: null` and `extraScope`
  carries the whole rule. The isolation test is still required.
- `ReviewService extends BaseService` but disables create/update/delete (`standardRoutes: ["list"]`); reviews are written
  by the website API. One action: `reply(ctx, id, text)` with permission `reviews.review.reply`, the empty text meaning
  "remove the reply", the notification to the reviewer, and the audit actions `review.replied` / `review.reply_removed`
  (same strings).
- Read permission: `reviews.review.read`. Today's rule "reviews.reply **or** customers.view can read" becomes a data
  migration (ACCESS.md §6): everyone with either old permission gets `reviews.review.read`.

---

## 11. Conventions every app follows

| Topic | Rule |
|---|---|
| Names | `<app>.<resource>.<verb>` for permissions and events. Lower case, singular resource: `expenses.expense.create`. |
| Verbs | `read`, `create`, `update`, `delete`, `restore`, plus named actions: `confirm`, `cancel`, `approve`, `reply`, `export`. |
| Status columns | text, with the allowed values in a `const` array in the app. Never free text. |
| Dates | stored UTC. "Today" and "this month" use `nepalDay()` (UTC+05:45). Calendar dates without time (`spentOn`) are `DATE`. |
| Numbers like EX-0007 | `seq` per business from the database; formatter in the app. |
| Errors | throw the helpers in §3. Messages are plain English, said to the user. |
| Private files | `platform/files` (`savePrivateFile` / `readPrivateFile`); a file id is stored on the row. |
| Notifications | `platform/notifications` (`notify`, `teamWith`, `notifyStaff`), called from `afterWrite` or an event handler. |
| Jobs | registered in `platform/jobs` with an id and an interval; the job runs with `{ kind: "system" }`. `JOBS=off` still turns them off. |
| Tests | each app has `backend/test/`: allowed, refused (wrong role, other business, other branch), bad input, plus the isolation test. |

---

## 12. Open choices (one recommendation each)

| Choice | Recommendation | Alternative |
|---|---|---|
| Money column type | `BigInt` paisa, `Money` class | Keep `Int` rupees and convert at the edge: simpler now, breaks when paisa is needed |
| Event delivery | Outbox table + in-process dispatcher | Plain in-memory emitter: simplest, loses events on a crash |
| Optimistic locking | `version` column, required for new apps, optional for Expenses in Phase 1 | `updatedAt` as the token: no new column, but clocks are coarse |
| Soft delete | `deletedAt` on kernel tables | Hard delete with an archive table: more code |
| One repository file per table | yes | Generic `repo("expense")` registry: fewer files, loses typing |
