// BaseRepository: the only code that reads and writes a business's rows (KERNEL.md section 6).
// Where it fits: every app has one repository per table, extending this class; services call it, never Prisma directly.
// How it works: every method builds its filter in ONE place (scopeWhere): this business, not deleted, the branches the
// person's data scope allows, and "created by me" when the scope is "own". The business comes from the context, never from
// the caller. Writes bump `version`; a save made on an old version is refused with 409 version_conflict. There is no
// hard delete: a table that really needs one gets a named method of its own, with a comment saying why.
// Rules: filters and sorts a client sends are checked against the lists in RepositoryConfig; anything else is refused.
// Every caller-made filter is ANDed to the scope, so it can only narrow the result, never widen it.
// Deviations from KERNEL.md (all additive): scopeWhere is async (extraScope may be), tenantField may be null (Reviews,
// 10.7), and the config has an optional `label` for the version-conflict message.

import { badRequest, forbidden, notFound, versionConflict } from "./errors.js";
import { actorIdOf, type BusinessContext, type DataScope } from "./context.js";

// ── Row shapes every kernel table carries ──

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
export interface BranchEntity extends BusinessEntity { branchId: string }    // belongs to one branch

// ── Config ──

export type FilterOp = "eq" | "ne" | "in" | "gte" | "lte" | "between" | "contains" | "isNull";
export interface SortSpec { field: string; dir: "asc" | "desc" }
export interface Filter { field: string; op: FilterOp; value: unknown }

export interface RepositoryConfig<T extends BusinessEntity> {
  model: string;                                   // Prisma delegate name, e.g. "expense"
  tenantField?: string | null;                     // default "tenantId"; null = the table has no business column (extraScope carries the rule)
  branchField?: string | null;                     // default "branchId"; null for business-wide tables
  ownerField?: (keyof T & string) | null;          // who "own" means, e.g. "createdBy"; null = "own" not supported
  filterable: Partial<Record<keyof T & string, readonly FilterOp[]>>;
  sortable: readonly (keyof T & string)[];
  defaultSort: readonly SortSpec[];
  searchable?: readonly (keyof T & string)[];      // fields the free-text "q" looks in (contains, case-insensitive)
  maxPerPage?: number;                             // default 200
  legacyMaxRows?: number;                          // old endpoints that return a plain list (Expenses: 2000), see KERNEL 10.3
  label?: string;                                  // "This expense": used in the version-conflict message. Default "This record"
}

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

// The few Prisma delegate methods used. Delegates are looked up by name, so this stays one class for every table.
interface Delegate {
  findFirst(args: { where: object }): Promise<unknown>;
  findMany(args: { where: object; orderBy?: object[]; skip?: number; take?: number }): Promise<unknown[]>;
  count(args: { where: object }): Promise<number>;
  create(args: { data: object }): Promise<unknown>;
  updateMany(args: { where: object; data: object }): Promise<{ count: number }>;
}
type Where = Record<string, unknown>;

/** Keys a caller may never set through create/update: the repository owns them. */
const OWNED = new Set(["id", "version", "createdAt", "updatedAt", "createdBy", "updatedBy", "deletedAt", "deletedBy"]);

export abstract class BaseRepository<T extends BusinessEntity, Create extends object, Update extends object> {
  constructor(protected readonly cfg: RepositoryConfig<T>) {}

  get config(): Readonly<RepositoryConfig<T>> { return this.cfg; }
  /** Whether rows of this table belong to a branch. */
  get branched(): boolean { return this.branchField() !== null; }

  private tenantField() { return this.cfg.tenantField === undefined ? "tenantId" : this.cfg.tenantField; }
  private branchField() { return this.cfg.branchField === undefined ? "branchId" : this.cfg.branchField; }
  private label() { return this.cfg.label ?? "This record"; }

  private delegate(ctx: BusinessContext): Delegate {
    const d = ((ctx.tx ?? ctx.db) as unknown as Record<string, Delegate | undefined>)[this.cfg.model];
    if (!d) throw new Error(`BaseRepository: there is no Prisma model "${this.cfg.model}".`);
    return d;
  }

  // ── The one place filters are built. Every method below uses it. ──

  /** tenant + not deleted + branch (by data scope) + owner (when scope is "own"), plus extraScope(). */
  protected async scopeWhere(ctx: BusinessContext, scope: DataScope, o: { includeDeleted?: boolean } = {}): Promise<Where> {
    const where: Where = {};
    const tenant = this.tenantField();
    if (tenant) where[tenant] = ctx.business.id;
    if (!o.includeDeleted) where.deletedAt = null;
    const branch = this.branchField();
    if (branch) {
      const ids = ctx.branches.idsFor(scope);
      if (ids) where[branch] = { in: [...ids] };
    }
    if (scope === "own") {
      if (!this.cfg.ownerField) throw forbidden("This list can't be limited to your own records.");
      where[this.cfg.ownerField] = ctx.member.userId;
    }
    const extra = await this.extraScope(ctx, scope);
    return Object.keys(extra).length ? { AND: [where, extra] } : where;
  }

  /** Hook for tables whose visibility is not just branch: Reviews (the business OR its listings in view). Default: nothing. */
  protected extraScope(_ctx: BusinessContext, _scope: DataScope): Where | Promise<Where> { return {}; }

  private async where(ctx: BusinessContext, scope: DataScope, more: readonly Where[] = [], o: { includeDeleted?: boolean } = {}): Promise<Where> {
    return { AND: [await this.scopeWhere(ctx, scope, o), ...more] };
  }

  private filterClause(f: Filter): Where {
    if (!Object.hasOwn(this.cfg.filterable, f.field) || !(this.cfg.filterable as Record<string, readonly FilterOp[]>)[f.field]!.includes(f.op)) {
      throw badRequest(`You can't filter by ${f.field} like that.`);
    }
    const { field: k, value: v } = f;
    if (v === undefined) throw badRequest(`Give a value to filter ${k} by.`);
    switch (f.op) {
      case "eq": return { [k]: v };
      case "ne": return { [k]: { not: v } };
      case "in":
        if (!Array.isArray(v)) throw badRequest(`Give a list of values to filter ${k} by.`);
        return { [k]: { in: v } };
      case "gte": return { [k]: { gte: v } };
      case "lte": return { [k]: { lte: v } };
      case "between":
        if (!Array.isArray(v) || v.length !== 2) throw badRequest(`Give a start and an end to filter ${k} by.`);
        return { [k]: { gte: v[0], lte: v[1] } };
      case "contains":
        if (typeof v !== "string") throw badRequest(`Give some text to search ${k} for.`);
        return { [k]: { contains: v, mode: "insensitive" } };
      case "isNull": return { [k]: v === false ? { not: null } : null };
    }
  }

  private orderBy(sort: readonly SortSpec[] | undefined): object[] {
    const list = sort?.length ? sort : this.cfg.defaultSort;
    const out: object[] = [];
    for (const s of list) {
      if (!(this.cfg.sortable as readonly string[]).includes(s.field)) throw badRequest(`You can't sort by ${s.field}.`);
      out.push({ [s.field]: s.dir === "desc" ? "desc" : "asc" });
    }
    out.push({ id: "asc" }); // a fixed last key, so pages never repeat or skip a row
    return out;
  }

  private async listWhere(ctx: BusinessContext, scope: DataScope, filters: readonly Filter[] | undefined, q?: string): Promise<Where> {
    const more: Where[] = (filters ?? []).map((f) => this.filterClause(f));
    const text = q?.trim();
    if (text) {
      if (!this.cfg.searchable?.length) throw badRequest("Search isn't available here.");
      more.push({ OR: this.cfg.searchable.map((f) => ({ [f]: { contains: text, mode: "insensitive" } })) });
    }
    return this.where(ctx, scope, more);
  }

  // ── Read ──

  async find(ctx: BusinessContext, id: string, scope: DataScope, opts: { includeDeleted?: boolean } = {}): Promise<T | null> {
    const row = await this.delegate(ctx).findFirst({ where: await this.where(ctx, scope, [{ id }], opts) });
    return (row as T | null) ?? null;
  }

  /** notFound() if the row is missing or out of scope (the caller cannot tell which: that is on purpose). */
  async get(ctx: BusinessContext, id: string, scope: DataScope, opts: { includeDeleted?: boolean } = {}): Promise<T> {
    const row = await this.find(ctx, id, scope, opts);
    if (!row) throw notFound();
    return row;
  }

  async list(ctx: BusinessContext, scope: DataScope, query: ListQuery = {}): Promise<Page<T>> {
    const where = await this.listWhere(ctx, scope, query.filters, query.q);
    const orderBy = this.orderBy(query.sort);
    const asked = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : undefined);
    const legacy = asked(query.page) === undefined && asked(query.per) === undefined && this.cfg.legacyMaxRows !== undefined;
    const per = legacy ? this.cfg.legacyMaxRows! : Math.min(Math.max(1, asked(query.per) ?? 50), this.cfg.maxPerPage ?? 200);
    const page = legacy ? 1 : Math.max(1, asked(query.page) ?? 1);
    const d = this.delegate(ctx);
    const [rows, total] = await Promise.all([d.findMany({ where, orderBy, skip: (page - 1) * per, take: per }), d.count({ where })]);
    return { rows: rows as T[], meta: { total, current_page: page, last_page: Math.max(1, Math.ceil(total / per)), per_page: per } };
  }

  async count(ctx: BusinessContext, scope: DataScope, filters?: readonly Filter[]): Promise<number> {
    return this.delegate(ctx).count({ where: await this.listWhere(ctx, scope, filters) });
  }

  // ── Write ──

  private checkBranch(ctx: BusinessContext, branchId: unknown) {
    if (typeof branchId === "string" && !ctx.branches.canSee(branchId)) throw forbidden("You don't work at that branch.");
  }
  private checkVersion(v: number | undefined) {
    if (v !== undefined && (!Number.isInteger(v) || v < 1)) throw badRequest("The version must be a whole number from 1.");
  }
  private clean(data: object): Record<string, unknown> {
    const tenant = this.tenantField();
    return Object.fromEntries(Object.entries(data).filter(([k]) => !OWNED.has(k) && k !== tenant));
  }

  /** Sets the business from the context, the branch from the data (already checked by the service), createdBy/updatedBy,
   *  version 1. A business, version or deleted flag in `data` is ignored: the repository owns them. */
  async create(ctx: BusinessContext, data: Create & { branchId?: string }): Promise<T> {
    const tenant = this.tenantField();
    if (!tenant) throw new Error(`BaseRepository: "${this.cfg.model}" has no business column, so it cannot create rows.`);
    const branch = this.branchField();
    const row: Record<string, unknown> = this.clean(data);
    if (branch) {
      const branchId = (data as Record<string, unknown>)[branch] ?? data.branchId;
      this.checkBranch(ctx, branchId);
      row[branch] = branchId;
    }
    const me = actorIdOf(ctx);
    Object.assign(row, { [tenant]: ctx.business.id, createdBy: me, updatedBy: me, version: 1, deletedAt: null, deletedBy: null });
    return (await this.delegate(ctx).create({ data: row })) as T;
  }

  private async changed(ctx: BusinessContext, id: string, count: number, scope: DataScope): Promise<void> {
    if (count > 0) return;
    // Nothing matched: either the row is not ours to touch, or someone saved a newer version first.
    if (await this.find(ctx, id, scope)) throw versionConflict(this.label());
    throw notFound();
  }

  /** Updates only when `version` still matches, then bumps it. Throws versionConflict if someone else changed the row.
   *  expectedVersion undefined = last write wins (allowed only where the service says so). */
  async update(ctx: BusinessContext, id: string, data: Update, scope: DataScope, expectedVersion?: number): Promise<T> {
    this.checkVersion(expectedVersion);
    const changes = this.clean(data);
    const branch = this.branchField();
    if (branch) this.checkBranch(ctx, changes[branch]);
    const where = await this.where(ctx, scope, [{ id }, ...(expectedVersion === undefined ? [] : [{ version: expectedVersion }])]);
    const { count } = await this.delegate(ctx).updateMany({ where, data: { ...changes, version: { increment: 1 }, updatedBy: actorIdOf(ctx) } });
    await this.changed(ctx, id, count, scope);
    return this.reload(ctx, id);
  }

  /** The row after our own write: same business, but not narrowed by the branch/owner scope (the write may have moved it). */
  private async reload(ctx: BusinessContext, id: string): Promise<T> {
    const row = await this.delegate(ctx).findFirst({ where: await this.where(ctx, "all", [{ id }]) });
    if (!row) throw notFound();
    return row as T;
  }

  /** Compare-and-set: change the row only if it still looks like `from` (e.g. { status: "draft" }). Returns false if not.
   *  This is the "taken only if it is still a draft" trick of expenses/:id/confirm, now reusable. */
  async transition(ctx: BusinessContext, id: string, from: Partial<T>, to: Update, scope: DataScope): Promise<boolean> {
    const conditions = Object.entries(from).map(([k, v]) => ({ [k]: v }));
    const where = await this.where(ctx, scope, [{ id }, ...conditions]);
    const { count } = await this.delegate(ctx).updateMany({ where, data: { ...this.clean(to), version: { increment: 1 }, updatedBy: actorIdOf(ctx) } });
    return count > 0;
  }

  /** Soft delete: the row stays, every query hides it. */
  async softDelete(ctx: BusinessContext, id: string, scope: DataScope, expectedVersion?: number): Promise<void> {
    this.checkVersion(expectedVersion);
    const where = await this.where(ctx, scope, [{ id }, ...(expectedVersion === undefined ? [] : [{ version: expectedVersion }])]);
    const me = actorIdOf(ctx);
    const { count } = await this.delegate(ctx).updateMany({ where, data: { deletedAt: ctx.now, deletedBy: me, updatedBy: me, version: { increment: 1 } } });
    await this.changed(ctx, id, count, scope);
  }

  async restore(ctx: BusinessContext, id: string, scope: DataScope): Promise<T> {
    const where = await this.where(ctx, scope, [{ id }, { deletedAt: { not: null } }], { includeDeleted: true });
    const { count } = await this.delegate(ctx).updateMany({ where, data: { deletedAt: null, deletedBy: null, updatedBy: actorIdOf(ctx), version: { increment: 1 } } });
    if (count === 0) throw notFound();
    return this.reload(ctx, id);
  }
}
