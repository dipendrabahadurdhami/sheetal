// The only code that reads and writes investor pledges and investment updates (KERNEL.md section 6).
// Where it fits: InvestmentService calls these.
// How it works: neither table has a branch; a row follows the branch of its investment listing, so extraScope() limits them to the business's listings in the
// branches in view (the old inBranches()). The investment listings themselves are the Listings app's table, read only (manifest dependencies.reads).
// Rules: nothing is hard deleted.

import type { BusinessContext, DataScope } from "@sheetal/platform/core/context";
import { actorIdOf } from "@sheetal/platform/core/context";
import { notFound } from "@sheetal/platform/core/errors";
import { BaseRepository } from "@sheetal/platform/core/repository";
import type { CommitmentRow, UpdateRow } from "./types.js";

interface Delegate { findMany(a: object): Promise<unknown[]>; findFirst(a: object): Promise<unknown>; create(a: object): Promise<unknown> }
type T = Record<"listing" | "commitment" | "investmentUpdate", Delegate>;
const t = (ctx: BusinessContext): T => (ctx.tx ?? ctx.db) as unknown as T;

async function inView(ctx: BusinessContext, scope: DataScope): Promise<number[] | null> {
  const ids = ctx.branches.idsFor(scope);
  if (!ids) return null;
  return ((await t(ctx).listing.findMany({ where: { tenantId: ctx.business.id, branchId: { in: [...ids] } }, select: { id: true } })) as { id: number }[]).map((l) => l.id);
}
const byListing = async (ctx: BusinessContext, scope: DataScope) => { const ids = await inView(ctx, scope); return ids ? { listingId: { in: ids } } : {}; };

export async function investmentListings(ctx: BusinessContext, scope: DataScope) {
  const ids = await inView(ctx, scope);
  return (await t(ctx).listing.findMany({ where: { tenantId: ctx.business.id, kind: "invest", status: { not: "removed" }, ...(ids ? { id: { in: ids } } : {}) }, select: { id: true, code: true, title: true, status: true, price: true } })) as { id: number; code: string; title: string; status: string; price: bigint | null }[];
}
export async function investmentListing(ctx: BusinessContext, scope: DataScope, id: number): Promise<{ id: number; code: string; title: string }> {
  const ids = ctx.branches.idsFor(scope);
  const l = await t(ctx).listing.findFirst({ where: { id, tenantId: ctx.business.id, kind: "invest", status: { not: "removed" }, ...(ids ? { branchId: { in: [...ids] } } : {}) } });
  if (!l) throw notFound("Investment not found.");
  return l as { id: number; code: string; title: string };
}

export class CommitmentRepository extends BaseRepository<CommitmentRow, never, Partial<CommitmentRow>> {
  constructor() { super({ model: "commitment", branchField: null, ownerField: null, label: "This pledge", filterable: { status: ["eq"] }, sortable: ["createdAt"], defaultSort: [{ field: "createdAt", dir: "desc" }] }); }
  protected override extraScope(ctx: BusinessContext, scope: DataScope) { return byListing(ctx, scope); }
  async all(ctx: BusinessContext, scope: DataScope): Promise<CommitmentRow[]> {
    return (await t(ctx).commitment.findMany({ where: await this.scopeWhere(ctx, scope), orderBy: { createdAt: "desc" } })) as CommitmentRow[];
  }
  async add(ctx: BusinessContext, d: { listingId: number; name: string; email: string | null; phone?: string; amount: bigint }): Promise<CommitmentRow> {
    const me = actorIdOf(ctx);
    return (await t(ctx).commitment.create({ data: { ...d, tenantId: ctx.business.id, createdBy: me, updatedBy: me } })) as CommitmentRow;
  }
  /** The emails of everyone who pledged to this listing and was not refunded (lower case, once each). */
  async emailsOf(ctx: BusinessContext, listingId: number): Promise<string[]> {
    const rows = (await t(ctx).commitment.findMany({ where: { listingId, tenantId: ctx.business.id, deletedAt: null, status: { not: "refunded" }, email: { not: null } }, select: { email: true } })) as { email: string }[];
    return [...new Set(rows.map((c) => c.email.toLowerCase()))];
  }
}

export class UpdateRepository extends BaseRepository<UpdateRow, never, never> {
  constructor() { super({ model: "investmentUpdate", branchField: null, ownerField: "byUserId", label: "This update", filterable: {}, sortable: ["createdAt"], defaultSort: [{ field: "createdAt", dir: "desc" }] }); }
  protected override extraScope(ctx: BusinessContext, scope: DataScope) { return byListing(ctx, scope); }
  async recent(ctx: BusinessContext, scope: DataScope): Promise<UpdateRow[]> {
    return (await t(ctx).investmentUpdate.findMany({ where: await this.scopeWhere(ctx, scope), orderBy: { createdAt: "desc" }, take: 100 })) as UpdateRow[];
  }
  async add(ctx: BusinessContext, d: { listingId: number; title: string; body: string }): Promise<UpdateRow> {
    const me = actorIdOf(ctx);
    return (await t(ctx).investmentUpdate.create({ data: { ...d, tenantId: ctx.business.id, byUserId: me, createdBy: me, updatedBy: me } })) as UpdateRow;
  }
}
