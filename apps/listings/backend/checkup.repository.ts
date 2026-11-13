// The table code of listing check-ups (KERNEL.md section 6): the business's check-up setup (tenants.settings.checkups), the team who may review, the
// listings to review, the reviews themselves (ListingReview) and the listing fields a decision changes. Moved out of
// business/backend/src/modules/reviews/checkups.ts in P2-W6.
// Where it fits: CheckupService and the 15-minute job (checkup.job.ts).
// Rules: every query carries this business; branch work is read over the branches in view (`inView`).

import { Prisma } from "@prisma/client";
import type { BusinessContext } from "@sheetal/platform/core/context";

type Tx = Prisma.TransactionClient;
export const dbOf = (ctx: BusinessContext): Tx => (ctx.tx ?? ctx.db) as unknown as Tx;
export type InView = { branchId?: { in: string[] } };

export class CheckupRepository {
  settings(d: Tx, tenantId: string) { return d.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } }).then((t) => (t?.settings ?? {}) as Record<string, unknown>); }
  saveSettings(d: Tx, tenantId: string, settings: Record<string, unknown>) { return d.tenant.update({ where: { id: tenantId }, data: { settings: settings as Prisma.InputJsonValue } }); }
  branchesAndTeam(d: Tx, tenantId: string) {
    return Promise.all([
      d.branch.findMany({ where: { tenantId }, select: { id: true, name: true } }),
      d.membership.findMany({ where: { tenantId, status: "active" }, include: { role: true, user: { select: { id: true, userName: true } } } }),
    ]);
  }
  rolePerms(d: Tx, tenantId: string, roleId: string) { return roleId ? d.role.findFirst({ where: { id: roleId, tenantId }, select: { perms: true } }).then((r) => r?.perms ?? []) : Promise.resolve([] as string[]); }
  toReview(ctx: BusinessContext, inView: InView, or: Prisma.ListingWhereInput[], day: string, userId: string) {
    const t = ctx.business.id, d = dbOf(ctx);
    return Promise.all([
      d.listing.findMany({ where: { tenantId: t, status: { in: ["published", "sold", "rented", "paused"] }, ...inView, OR: or }, include: { photos: { orderBy: { sort: "asc" }, take: 1 } }, orderBy: [{ checkDueAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }], take: 2000 }),
      d.listingReview.findMany({ where: { tenantId: t, day }, select: { listingId: true } }),
      d.listingReview.count({ where: { tenantId: t, day, userId } }),
    ]);
  }
  listing(ctx: BusinessContext, code: string, inView: InView) { return dbOf(ctx).listing.findFirst({ where: { code: code.slice(0, 40), tenantId: ctx.business.id, ...inView } }); }
  addReview(ctx: BusinessContext, data: Omit<Prisma.ListingReviewUncheckedCreateInput, "tenantId">) { return dbOf(ctx).listingReview.create({ data: { ...data, tenantId: ctx.business.id } }); }
  /** Only a listing of this business, found by the caller first. */
  changeListing(d: Tx, id: number, data: Prisma.ListingUpdateInput) { return d.listing.update({ where: { id }, data: { ...data, version: { increment: 1 } } }); }
  undecided(d: Tx, tenantId: string, before: string | null) { return d.listingReview.findMany({ where: { tenantId, action: "change", decided: false, ...(before ? { day: { lt: before } } : {}) } }); }
  markDecided(d: Tx, ids: string[]) { return d.listingReview.updateMany({ where: { id: { in: ids } }, data: { decided: true } }); }
  businessesWithUndecided(d: Tx, today: string) { return d.listingReview.findMany({ where: { action: "change", decided: false, day: { lt: today } }, distinct: ["tenantId"], select: { tenantId: true } }); }
  conflicts(ctx: BusinessContext, inView: InView) { return dbOf(ctx).listing.findMany({ where: { tenantId: ctx.business.id, reviewHold: true, reviewConflict: { not: Prisma.DbNull }, ...inView }, take: 200 }); }
  userNames(ctx: BusinessContext, ids: string[]) { return dbOf(ctx).user.findMany({ where: { id: { in: ids } }, select: { id: true, userName: true } }); }
  history(ctx: BusinessContext, since: string, branchIds: readonly string[] | null) {
    return dbOf(ctx).listingReview.findMany({ where: { tenantId: ctx.business.id, day: { gte: since }, ...(branchIds ? { branchId: { in: [...branchIds] } } : {}) }, orderBy: { createdAt: "desc" }, take: 1000 });
  }
  listingTitles(ctx: BusinessContext, ids: number[]) { return dbOf(ctx).listing.findMany({ where: { id: { in: ids }, tenantId: ctx.business.id }, select: { id: true, code: true, title: true } }); }
}
