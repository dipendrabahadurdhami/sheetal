// BaseService: where an app's rules live (KERNEL.md section 7).
// Where it fits: controller -> service -> repository. A service checks the app and the permission, parses the input, runs the
// business rules, and writes the row, the audit line and the event in ONE transaction.
// How it works: every standard operation runs the same steps in the same order: 1 app on? 2 permission and data scope
// 3 parse input 4 before-hook 5 transaction { repository write, audit row, event row, after-hook } 6 answer.
// Rules: a service never touches Prisma delegates for business data (only the repository does); the audit row is the only
// thing it writes itself, with the same transaction. Old audit action strings stay as they are in Phase 1 (set per
// operation in `audit.actions`). Maker-checker approvals are not built yet: an action that asks for one is refused loudly
// rather than run without the check.

import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { badRequest, forbidden, planLimit } from "./errors.js";
import { actorIdOf, narrowest, type BusinessContext, type DataScope, type PermissionId } from "./context.js";
import type { EventBus } from "./events.js";
import type { BaseRepository, BusinessEntity, ListQuery, Page } from "./repository.js";
import type { Money } from "./money.js";

export interface ResourcePermissions {
  read: PermissionId;            // list + get
  create: PermissionId;
  update: PermissionId;
  delete: PermissionId;          // also guards restore
}

export type WriteKind = "created" | "updated" | "deleted" | "restored";

/** Placeholder until the approvals task (ACCESS.md section 9): naming the action and, if known, the amount. */
export interface ApprovalSpec { action: string; amount?: Money }

export interface ServiceDeps<T extends BusinessEntity, C extends object, U extends object> {
  app: string;                                   // app id from the manifest, e.g. "expenses"
  resource: string;                              // "expense"
  repo: BaseRepository<T, C, U>;
  permissions: ResourcePermissions;
  schemas: { create: z.ZodType<C>; update: z.ZodType<U>; list?: z.ZodType<ListQuery> };
  /** `label` goes in AuditLog.target, e.g. "EX-0007 Rs. 1500". `actions` are the AuditLog.action strings; the defaults are
   *  "<entity>.added", ".updated", ".removed", ".restored". Apps with older strings set them here. */
  audit: { entity: string; label: (row: T) => string; actions?: Partial<Record<WriteKind, string>> };
  bus: EventBus;
  /** false = an update without `version` is allowed (last write wins). Default true. */
  requireVersion?: boolean;
}

const VERB: Record<WriteKind, string> = { created: "created", updated: "updated", deleted: "deleted", restored: "restored" };
const AUDIT_DEFAULT: Record<WriteKind, string> = { created: "added", updated: "updated", deleted: "removed", restored: "restored" };

export abstract class BaseService<T extends BusinessEntity, C extends object, U extends object> {
  constructor(protected readonly deps: ServiceDeps<T, C, U>) {}

  // ── Standard operations ──

  async list(ctx: BusinessContext, rawQuery: unknown): Promise<Page<T>> {
    this.requireApp(ctx);
    const scope = ctx.permissions.require(this.deps.permissions.read);
    const query = this.deps.schemas.list ? this.parse(this.deps.schemas.list, rawQuery) : ((rawQuery ?? {}) as ListQuery);
    return this.deps.repo.list(ctx, scope, query);
  }

  async get(ctx: BusinessContext, id: string): Promise<T> {
    this.requireApp(ctx);
    const scope = ctx.permissions.require(this.deps.permissions.read);
    return this.deps.repo.get(ctx, id, scope);
  }

  async create(ctx: BusinessContext, raw: unknown): Promise<T> {
    this.requireApp(ctx);
    ctx.permissions.require(this.deps.permissions.create);
    const input = this.parse(this.deps.schemas.create, raw);
    return this.inTransaction(ctx, async (tx) => {
      const data = await this.beforeCreate(tx, input);
      const asked = (data as { branchId?: string | null }).branchId;
      const row = await this.deps.repo.create(tx, this.deps.repo.branched ? { ...data, branchId: tx.branches.branchForNew(asked) } : data);
      await this.wrote(tx, row, "created");
      return row;
    });
  }

  async update(ctx: BusinessContext, id: string, raw: unknown): Promise<T> {
    this.requireApp(ctx);
    const scope = ctx.permissions.require(this.deps.permissions.update);
    const version = this.versionOf(raw);
    const input = this.parse(this.deps.schemas.update, raw);
    return this.inTransaction(ctx, async (tx) => {
      const current = await this.deps.repo.get(tx, id, scope);
      const data = await this.beforeUpdate(tx, current, input);
      const row = await this.deps.repo.update(tx, id, data, scope, version);
      await this.wrote(tx, row, "updated");
      return row;
    });
  }

  /** Soft delete. */
  async remove(ctx: BusinessContext, id: string, version?: number): Promise<void> {
    this.requireApp(ctx);
    const scope = ctx.permissions.require(this.deps.permissions.delete);
    await this.inTransaction(ctx, async (tx) => {
      const current = await this.deps.repo.get(tx, id, scope);
      await this.beforeDelete(tx, current);
      await this.deps.repo.softDelete(tx, id, scope, version);
      await this.wrote(tx, current, "deleted");
    });
  }

  async restore(ctx: BusinessContext, id: string): Promise<T> {
    this.requireApp(ctx);
    const scope = ctx.permissions.require(this.deps.permissions.delete);
    return this.inTransaction(ctx, async (tx) => {
      const row = await this.deps.repo.restore(tx, id, scope);
      await this.wrote(tx, row, "restored");
      return row;
    });
  }

  // ── Hooks an app overrides (all optional, all run inside the transaction) ──

  protected async beforeCreate(_ctx: BusinessContext, data: C): Promise<C> { return data; }
  protected async beforeUpdate(_ctx: BusinessContext, _current: T, data: U): Promise<U> { return data; }
  /** May refuse by throwing: "a draft is skipped, not deleted". */
  protected async beforeDelete(_ctx: BusinessContext, _current: T): Promise<void> { /* nothing by default */ }
  protected async afterWrite(_ctx: BusinessContext, _row: T, _kind: WriteKind): Promise<void> { /* nothing by default */ }
  /** The small JSON an event carries for a standard write. Apps override it to add amounts (in paisa) and so on. */
  protected eventPayload(row: T, _kind: WriteKind): object { return { id: row.id }; }

  // ── For actions that are not plain create/update/delete (confirm, pause, reply, cancel) ──

  protected async action<R>(ctx: BusinessContext, a: {
    name: string;                    // "confirm"
    permission: PermissionId;        // "expenses.expense.confirm"
    scope?: DataScope;               // default: the scope the person was granted. Never wider than that.
    approval?: ApprovalSpec;         // maker-checker (ACCESS.md section 9): not built yet
    audit: (result: R) => { action: string; target: string; meta?: object };
    event?: (result: R) => { name: string; payload: object };
    run: (ctx: BusinessContext, scope: DataScope) => Promise<R>;   // runs inside the transaction
  }): Promise<R> {
    this.requireApp(ctx);
    const granted = ctx.permissions.require(a.permission);
    if (a.approval) throw new Error(`Action "${a.name}" asks for an approval, but approvals are built in a later task; refusing to run it unchecked.`);
    const scope = a.scope ? narrowest(a.scope, granted) : granted;
    return this.inTransaction(ctx, async (tx) => {
      const result = await a.run(tx, scope);
      const line = a.audit(result);
      await this.writeAudit(tx, line.action, line.target, line.meta);
      const ev = a.event?.(result);
      if (ev) await this.deps.bus.publish(tx, ev.name, ev.payload, 1, { branchId: (result as { branchId?: string } | null)?.branchId ?? null });
      return result;
    });
  }

  // ── Helpers ──

  protected parse<X>(schema: z.ZodType<X>, raw: unknown): X { return schema.parse(raw); }   // a ZodError becomes 422 in errorHandler

  protected requireApp(ctx: BusinessContext): void {
    if (!ctx.entitlements.hasApp(this.deps.app)) {
      const name = this.deps.app.charAt(0).toUpperCase() + this.deps.app.slice(1);
      throw forbidden(`${name} isn't part of your plan.`);
    }
  }

  /** Refuses when `used` already reaches the app's limit for `key` (null = unlimited): call it before adding one more. */
  protected requireLimit(ctx: BusinessContext, key: string, used: number): void {
    const limit = ctx.entitlements.limit(this.deps.app, key);
    if (limit !== null && used >= limit) throw planLimit("app_limit", `Your plan allows ${limit} here. Upgrade to add more.`, { limit, key });
  }

  /** Joins the caller's transaction if there is one, otherwise starts one. Every write (create, update, remove, restore,
   *  action) passes through here, so a read-only staff support session is refused in this one place (ACCESS.md: impersonation
   *  is read-only by default). Reads never come here. */
  protected inTransaction<R>(ctx: BusinessContext, fn: (ctx: BusinessContext) => Promise<R>): Promise<R> {
    if (ctx.impersonation?.readOnly) {
      return Promise.reject(forbidden("This is a read-only support session. Changes are not allowed."));
    }
    return ctx.tx ? fn(ctx) : ctx.transaction(fn);
  }

  /** The version a client says it loaded. Required unless the service turned requireVersion off. */
  private versionOf(raw: unknown): number | undefined {
    const v = raw && typeof raw === "object" ? (raw as { version?: unknown }).version : undefined;
    if (v === undefined || v === null || v === "") {
      if (this.deps.requireVersion === false) return undefined;
      throw badRequest("This page is out of date. Reload and try again.");
    }
    const n = typeof v === "string" ? Number(v) : v;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1) throw badRequest("This page is out of date. Reload and try again.");
    return n;
  }

  /** Audit row + event + after-hook for a standard write, inside the transaction. */
  private async wrote(ctx: BusinessContext, row: T, kind: WriteKind): Promise<void> {
    const a = this.deps.audit;
    await this.writeAudit(ctx, a.actions?.[kind] ?? `${a.entity}.${AUDIT_DEFAULT[kind]}`, a.label(row));
    const branchId = (row as { branchId?: string | null }).branchId ?? null;
    await this.deps.bus.publish(ctx, `${this.deps.app}.${this.deps.resource}.${VERB[kind]}`, this.eventPayload(row, kind), 1, { branchId });
    await this.afterWrite(ctx, row, kind);
  }

  /** One AuditLog row, written with the context's transaction. Staff acting as the business carry who and why (ACCESS.md 12). */
  protected async writeAudit(ctx: BusinessContext, action: string, target: string, meta?: object): Promise<void> {
    const staff = ctx.actor.kind === "staff" ? { impersonatedBy: ctx.actor.staffId, reason: ctx.impersonation?.reason ?? null } : null;
    const merged = { ...(meta ?? {}), ...(staff ?? {}) };
    await (ctx.tx ?? ctx.db).auditLog.create({
      data: {
        tenantId: ctx.business.id, actorId: actorIdOf(ctx), action, target, ip: ctx.ip,
        ...(Object.keys(merged).length ? { meta: merged as Prisma.InputJsonValue } : {}),
      },
    });
  }
}
