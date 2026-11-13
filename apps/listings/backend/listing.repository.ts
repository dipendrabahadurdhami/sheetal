// The only code that reads and writes a business's listings and their photos for the business panel (KERNEL.md section 6).
// Where it fits: ListingService calls it, in its transaction for a change. Sheetal staff review listings on the admin API and the website reads published
// ones; those are not moved here.
// How it works: every read carries this business, a listing that is not "removed", and the branches in view. A listing is never really deleted: "removed"
// keeps leads and history pointing somewhere. A new listing gets its code (prefix of the business + id) and slug in the same transaction it is made in.
// It also reads the business's plan (room for listings) and the other businesses this person belongs to (to move a listing there).
// Rules: Lead is the CRM app's table, but when a listing moves to another branch or business its enquiries go with it, in the same transaction
// (docs/architecture/MODEL-OWNERS.md).

import type { ListingStatus, Prisma } from "@prisma/client";
import { actorIdOf, type BusinessContext } from "@sheetal/platform/core/context";
import { COUNTED } from "@sheetal/backend-core/domain/listings";
import { listingCode, prefixFor } from "@sheetal/backend-core/domain/codes";

type Tx = Prisma.TransactionClient;
export const db = (ctx: BusinessContext): Tx => (ctx.tx ?? ctx.db) as unknown as Tx;
const inView = (ctx: BusinessContext) => { const ids = ctx.branches.idsFor("branch"); return ids ? { branchId: { in: [...ids] } } : {}; };
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "property";
const tmp = () => `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
export const WITH = { photos: { orderBy: { sort: "asc" as const } }, branch: { select: { id: true, name: true } } };
const bump = (ctx: BusinessContext) => ({ version: { increment: 1 }, updatedBy: actorIdOf(ctx) });

export class ListingRepository {
  /** Listings of this business in view that are not removed. */
  base(ctx: BusinessContext): Prisma.ListingWhereInput { return { tenantId: ctx.business.id, status: { not: "removed" }, ...inView(ctx) }; }
  one(ctx: BusinessContext, code: string) { return db(ctx).listing.findFirst({ where: { ...this.base(ctx), code }, include: WITH }); }
  many(ctx: BusinessContext, codes: string[]) { return db(ctx).listing.findMany({ where: { ...this.base(ctx), code: { in: codes } }, include: { photos: { take: 1 } } }); }
  byStatus(ctx: BusinessContext) { return db(ctx).listing.groupBy({ by: ["status"], where: this.base(ctx), _count: true }); }
  byKind(ctx: BusinessContext) { return db(ctx).listing.groupBy({ by: ["kind"], where: this.base(ctx), _count: true }); }
  /** Listings that use the plan's room, in the whole business (not only the branches in view). */
  used(ctx: BusinessContext, tenantId = ctx.business.id) { return db(ctx).listing.count({ where: { tenantId, status: { in: COUNTED } } }); }
  summary(ctx: BusinessContext) {
    return db(ctx).listing.findMany({ where: this.base(ctx), orderBy: { updatedAt: "desc" }, select: { code: true, tenantId: true, kind: true, title: true, status: true, price: true, updatedAt: true, checkDueAt: true, lastCheckedAt: true, branchId: true, branch: { select: { name: true } } } });
  }
  count(ctx: BusinessContext, where: Prisma.ListingWhereInput) { return db(ctx).listing.count({ where }); }
  page(ctx: BusinessContext, where: Prisma.ListingWhereInput, skip: number, take: number) {
    return db(ctx).listing.findMany({ where, include: { photos: { orderBy: { sort: "asc" }, take: 1 }, branch: { select: { id: true, name: true } } }, orderBy: { updatedAt: "desc" }, skip, take });
  }
  async leadCounts(ctx: BusinessContext, ids: number[]) {
    const g = await db(ctx).lead.groupBy({ by: ["listingId"], where: { tenantId: ctx.business.id, listingId: { in: ids } }, _count: true });
    return new Map<number | null, number>(g.map((x) => [x.listingId as number | null, x._count as number]));
  }

  // ── Writes (inside the caller's transaction) ──

  /** A new listing with its photos, then its code and slug. */
  async create(ctx: BusinessContext, data: Omit<Prisma.ListingUncheckedCreateInput, "code" | "slug" | "tenantId">, photos: { file: string; sort: number }[]) {
    const me = actorIdOf(ctx);
    const l = await db(ctx).listing.create({ data: { ...data, code: tmp(), slug: tmp(), tenantId: ctx.business.id, createdBy: me, updatedBy: me, photos: { create: photos } } });
    return db(ctx).listing.update({ where: { id: l.id }, data: { code: listingCode(await prefixFor(db(ctx), ctx.business.id), l.id), slug: `${slugify(l.title)}-${l.id}` }, include: WITH });
  }
  /** Replaces a listing's fields and photos. False (null) = someone changed it first (when a version is given). */
  async replace(ctx: BusinessContext, id: number, data: Prisma.ListingUncheckedUpdateInput, photos: { file: string; sort: number }[], version?: number) {
    if (version !== undefined && !(await db(ctx).listing.updateMany({ where: { id, version }, data: bump(ctx) })).count) return null;
    await db(ctx).listingPhoto.deleteMany({ where: { listingId: id } });
    return db(ctx).listing.update({ where: { id }, data: { ...data, ...(version === undefined ? bump(ctx) : {}), photos: { create: photos } }, include: WITH });
  }
  setStatus(ctx: BusinessContext, id: number, status: ListingStatus, submitted: boolean) {
    return db(ctx).listing.update({ where: { id }, data: { status, ...(submitted ? { submittedAt: new Date() } : {}), ...bump(ctx) } });
  }
  async remove(ctx: BusinessContext, codes: string[]): Promise<number> {
    return (await db(ctx).listing.updateMany({ where: { ...this.base(ctx), code: { in: codes } }, data: { status: "removed", featured: false, ...bump(ctx) } })).count;
  }
  /** Moves a listing (and its enquiries) to another branch of this business. */
  async moveBranch(ctx: BusinessContext, listingId: number, branchId: string) {
    await db(ctx).lead.updateMany({ where: { listingId, tenantId: ctx.business.id }, data: { branchId } });
  }
  /** Moves a listing (and its enquiries, unassigned) into another business, at its first open branch. */
  async moveBusiness(ctx: BusinessContext, listingId: number, tenantId: string, branchId: string | null) {
    await db(ctx).listing.update({ where: { id: listingId }, data: { tenantId, branchId, ...bump(ctx) } });
    await db(ctx).lead.updateMany({ where: { listingId, tenantId: ctx.business.id }, data: { tenantId, branchId, assigneeId: null } });
  }

  // ── Read only: the plan, and this person's other businesses ──

  plan(ctx: BusinessContext, tenantId = ctx.business.id) { return db(ctx).tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, type: true, plan: true } }).then((t) => t); }
  memberships(ctx: BusinessContext) {
    return db(ctx).membership.findMany({ where: { userId: ctx.member.userId }, include: { role: true, tenant: { include: { plan: true } } } });
  }
  firstOpenBranch(ctx: BusinessContext, tenantId: string) { return db(ctx).branch.findFirst({ where: { tenantId, status: "open" }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] }); }
}
