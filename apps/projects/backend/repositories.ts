// The only code that reads and writes units, reservations and reservation payments (KERNEL.md section 6).
// Where it fits: ProjectService calls these.
// How it works: these tables have no branch column. A unit belongs to a project listing and follows that listing's branch; a reservation and its payments follow
// their unit. So the standard branch filter is off and extraScope() carries the rule: the listings of the business in the branches in view (none = the whole
// business), exactly as the old inBranches(). Named methods are the old queries; every write is a compare-and-set where two people could race (hold, reserve).
// Rules: Collection is tagged "collections" in the schema, but a payment on a reservation is written HERE, in the same transaction that marks the reservation
// and its unit sold when it is fully paid (one atomic step, as before). docs/architecture/MODEL-OWNERS.md records this. Nothing is hard deleted.

import type { BusinessContext, DataScope } from "@sheetal/platform/core/context";
import { actorIdOf } from "@sheetal/platform/core/context";
import { notFound } from "@sheetal/platform/core/errors";
import { BaseRepository } from "@sheetal/platform/core/repository";
import type { CollectionRow, ReservationFull, ReservationRow, UnitRow } from "./types.js";

type Where = Record<string, unknown>;
interface Delegate { findMany(a: object): Promise<unknown[]>; findFirst(a: object): Promise<unknown>; count(a: object): Promise<number>; createMany(a: object): Promise<{ count: number }>; create(a: object): Promise<unknown>; updateMany(a: object): Promise<{ count: number }> }
type T = Record<"listing" | "unit" | "reservation" | "collection" | "tenant", Delegate>;
const t = (ctx: BusinessContext): T => (ctx.tx ?? ctx.db) as unknown as T;

/** The ids of the business's listings in the branches in view; null = the whole business (the old inBranches()). */
export async function listingsInView(ctx: BusinessContext, scope: DataScope): Promise<number[] | null> {
  const ids = ctx.branches.idsFor(scope);
  if (!ids) return null;
  return ((await t(ctx).listing.findMany({ where: { tenantId: ctx.business.id, branchId: { in: [...ids] } }, select: { id: true } })) as { id: number }[]).map((l) => l.id);
}

export class UnitRepository extends BaseRepository<UnitRow, never, Partial<UnitRow>> {
  constructor() { super({ model: "unit", branchField: null, ownerField: null, label: "This unit", filterable: {}, sortable: ["block", "no"], defaultSort: [{ field: "block", dir: "asc" }, { field: "no", dir: "asc" }] }); }
  protected override async extraScope(ctx: BusinessContext, scope: DataScope): Promise<Where> {
    const ids = await listingsInView(ctx, scope);
    return ids ? { listingId: { in: ids } } : {};
  }
  async all(ctx: BusinessContext, scope: DataScope): Promise<UnitRow[]> {
    return (await t(ctx).unit.findMany({ where: await this.scopeWhere(ctx, scope), orderBy: [{ block: "asc" }, { no: "asc" }] })) as UnitRow[];
  }
  async one(ctx: BusinessContext, scope: DataScope, id: string): Promise<UnitRow> {
    const u = await this.find(ctx, id, scope);
    if (!u) throw notFound("Unit not found.");
    return u;
  }
  /** Units of the whole business (the plan's room for units counts all of them). */
  countAll(ctx: BusinessContext): Promise<number> { return t(ctx).unit.count({ where: { tenantId: ctx.business.id, deletedAt: null } }); }
  async addMany(ctx: BusinessContext, listingId: number, b: { block: string; type: string; sizeSqft?: number; price: number; nos: string[] }): Promise<number> {
    const me = actorIdOf(ctx);
    return (await t(ctx).unit.createMany({ data: b.nos.map((no) => ({ tenantId: ctx.business.id, listingId, block: b.block, no, type: b.type, sizeSqft: b.sizeSqft, price: BigInt(b.price), createdBy: me, updatedBy: me })), skipDuplicates: true })).count;
  }
  /** Holds a unit only if it is free (or its hold ran out): one person wins. */
  async hold(ctx: BusinessContext, scope: DataScope, id: string, until: Date): Promise<boolean> {
    const now = new Date();
    return (await t(ctx).unit.updateMany({ where: { AND: [await this.scopeWhere(ctx, scope), { id }, { OR: [{ status: "available" }, { status: "held", holdUntil: { lt: now } }] }] }, data: { status: "held", holdUntil: until, version: { increment: 1 }, updatedBy: actorIdOf(ctx) } })).count > 0;
  }
  /** Moves a unit from the status it had to another (false = someone changed it first). */
  async move(ctx: BusinessContext, id: string, from: string | null, to: { status: string; holdUntil?: null }): Promise<boolean> {
    return (await t(ctx).unit.updateMany({ where: { id, tenantId: ctx.business.id, ...(from ? { status: from } : {}) }, data: { ...to, version: { increment: 1 }, updatedBy: actorIdOf(ctx) } })).count > 0;
  }
  /** The plan limits of the business's plan (as stored; -1 or missing = no limit). */
  async planLimits(ctx: BusinessContext): Promise<Record<string, number>> {
    const r = (await t(ctx).tenant.findFirst({ where: { id: ctx.business.id }, select: { plan: { select: { limits: true } } } })) as { plan: { limits: unknown } } | null;
    return (r?.plan.limits ?? {}) as Record<string, number>;
  }
}

const FULL = { unit: true, collections: { orderBy: { createdAt: "asc" as const } } };

export class ReservationRepository extends BaseRepository<ReservationRow, never, Partial<ReservationRow>> {
  constructor() { super({ model: "reservation", branchField: null, ownerField: "createdBy", label: "This reservation", filterable: { status: ["eq"] }, sortable: ["createdAt"], defaultSort: [{ field: "createdAt", dir: "desc" }] }); }
  protected override async extraScope(ctx: BusinessContext, scope: DataScope): Promise<Where> {
    const ids = await listingsInView(ctx, scope);
    return ids ? { unit: { listingId: { in: ids } } } : {};
  }
  async allFull(ctx: BusinessContext, scope: DataScope): Promise<ReservationFull[]> {
    return (await t(ctx).reservation.findMany({ where: await this.scopeWhere(ctx, scope), include: FULL, orderBy: { createdAt: "desc" } })) as ReservationFull[];
  }
  async full(ctx: BusinessContext, scope: DataScope, id: string): Promise<ReservationFull | null> {
    return (await t(ctx).reservation.findFirst({ where: { AND: [await this.scopeWhere(ctx, scope), { id }] }, include: FULL })) as ReservationFull | null;
  }
  async open(ctx: BusinessContext, data: { unitId: string; buyerName: string; phone?: string; email: string | null; price: bigint; plan: unknown; notes?: string }): Promise<ReservationRow> {
    const me = actorIdOf(ctx);
    return (await t(ctx).reservation.create({ data: { ...data, tenantId: ctx.business.id, createdBy: me, updatedBy: me } })) as ReservationRow;
  }
  /** Changes the status only from the one it had (false = changed meanwhile). */
  async move(ctx: BusinessContext, id: string, from: string, data: { status: string; notes?: string | null }): Promise<boolean> {
    return (await t(ctx).reservation.updateMany({ where: { id, tenantId: ctx.business.id, status: from }, data: { ...data, version: { increment: 1 }, updatedBy: actorIdOf(ctx) } })).count > 0;
  }
  /** A payment (or a refund, negative) on a reservation. */
  async addPayment(ctx: BusinessContext, reservationId: string, b: { amount: number; method: string; ref?: string; note?: string }): Promise<CollectionRow> {
    const me = actorIdOf(ctx);
    return (await t(ctx).collection.create({ data: { reservationId, tenantId: ctx.business.id, amount: BigInt(b.amount), method: b.method, ref: b.ref, note: b.note, byUserId: me, createdBy: me, updatedBy: me } })) as CollectionRow;
  }
}

/** The business's project (or investment) listings in view, not removed (Listing is the Listings app's table: read only, manifest dependencies.reads). */
export async function listingsOfKind(ctx: BusinessContext, scope: DataScope, kind: "project" | "invest", select: Record<string, true>): Promise<Record<string, unknown>[]> {
  const ids = await listingsInView(ctx, scope);
  return (await t(ctx).listing.findMany({ where: { tenantId: ctx.business.id, kind, status: { not: "removed" }, ...(ids ? { id: { in: ids } } : {}) }, select })) as Record<string, unknown>[];
}
/** One project (or investment) listing of the business in view, or the old "not found" answer. */
export async function listingInView(ctx: BusinessContext, scope: DataScope, id: number, kind: "project" | "invest"): Promise<{ id: number; code: string; title: string }> {
  const ids = ctx.branches.idsFor(scope);
  const l = await t(ctx).listing.findFirst({ where: { id, tenantId: ctx.business.id, kind, status: { not: "removed" }, ...(ids ? { branchId: { in: [...ids] } } : {}) } });
  if (!l) throw notFound(kind === "project" ? "Project not found." : "Investment not found.");
  return l as { id: number; code: string; title: string };
}
