// The only code in the Workspace app that reads and writes branches and the business's own settings (KERNEL.md section 6).
// Where it fits: BranchService and SettingsService call these, in their transaction for a change. The access system (platform/src/tenancy) also reads
// branches and memberships to build every request's context; that reading stays where it is.
// How it works: branches carry the kernel columns (version, who changed it); a branch is really deleted only when it has no work at all (the counts below
// read the other apps' tables, never writing them, except the branch's own menu items which go with it, as before). Settings are the JSON sections of
// tenants.settings, saved whole per section.
// Rules: every query carries this business.

import type { Prisma } from "@prisma/client";
import { actorIdOf, type BusinessContext } from "@sheetal/platform/core/context";
import { OPEN_STATUSES } from "@sheetal/backend-core/domain/ota-requests";

type Tx = Prisma.TransactionClient;
export const db = (ctx: BusinessContext): Tx => (ctx.tx ?? ctx.db) as unknown as Tx;
const bump = (ctx: BusinessContext) => ({ version: { increment: 1 }, updatedBy: actorIdOf(ctx) });

export class BranchRepository {
  all(ctx: BusinessContext) { return db(ctx).branch.findMany({ where: { tenantId: ctx.business.id }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] }); }
  one(ctx: BusinessContext, id: string) { return db(ctx).branch.findFirst({ where: { id, tenantId: ctx.business.id } }); }
  named(ctx: BusinessContext, name: string, except?: string) { return db(ctx).branch.findFirst({ where: { tenantId: ctx.business.id, name: { equals: name, mode: "insensitive" }, ...(except ? { id: { not: except } } : {}) } }); }
  count(ctx: BusinessContext, where: Prisma.BranchWhereInput = {}) { return db(ctx).branch.count({ where: { tenantId: ctx.business.id, ...where } }); }
  create(ctx: BusinessContext, d: { name: string; address?: string | null; phone?: string | null; manager?: string | null; receipt?: string | null; sort: number }) {
    const me = actorIdOf(ctx);
    return db(ctx).branch.create({ data: { ...d, tenantId: ctx.business.id, createdBy: me, updatedBy: me } });
  }
  async change(ctx: BusinessContext, id: string, data: Prisma.BranchUpdateManyMutationInput, version?: number): Promise<boolean> {
    return (await db(ctx).branch.updateMany({ where: { id, tenantId: ctx.business.id, ...(version !== undefined ? { version } : {}) }, data: { ...data, ...bump(ctx) } })).count > 0;
  }
  /** Removes a branch and its own menu items (the access link rows go with it by cascade). */
  async remove(ctx: BusinessContext, id: string) {
    await db(ctx).menuItem.deleteMany({ where: { tenantId: ctx.business.id, branchId: id } });
    await db(ctx).branch.delete({ where: { id } });
  }
  /** Rooms, listings and active team members per branch (for the branches list). */
  usage(ctx: BusinessContext) {
    const t = ctx.business.id;
    return Promise.all([
      db(ctx).room.groupBy({ by: ["branchId"], where: { tenantId: t, active: true }, _count: true }),
      db(ctx).listing.groupBy({ by: ["branchId"], where: { tenantId: t, status: { notIn: ["removed", "archived"] } }, _count: true }),
      db(ctx).membership.findMany({ where: { tenantId: t, status: "active" }, select: { scopes: true, allBranches: true, branches: { select: { branchId: true } }, role: { select: { perms: true } } } }),
    ]);
  }
  /** Everything recorded at a branch, by kind (a branch with any of it can't be removed). */
  async work(ctx: BusinessContext, branchId: string): Promise<[number, string][]> {
    const w = { branchId }, x = db(ctx);
    const n = await Promise.all([
      x.listing.count({ where: { ...w, status: { not: "removed" } } }), x.room.count({ where: w }), x.lead.count({ where: w }),
      x.booking.count({ where: w }), x.shift.count({ where: w }), x.posBill.count({ where: w }), x.bizInvoice.count({ where: w }),
      x.expense.count({ where: w }), x.recurringExpense.count({ where: w }),
      x.rentOwner.count({ where: { ...w, deletedAt: null } }), x.rentUnit.count({ where: { ...w, deletedAt: null } }), x.form.count({ where: w }), x.agreement.count({ where: w }),
      x.stockItem.count({ where: w }), x.attendance.count({ where: w }), x.leaveRequest.count({ where: w }),
      x.otaRequest.count({ where: { ...w, status: { in: [...OPEN_STATUSES, "live"] } } }), // paused and rejected ones don't block
    ]);
    const [listings, rooms, leads, bookings, shifts, bills, invoices, expenses, recurring, owners, units, forms, agreements, stock, attendance, leaves, sites] = n;
    return [[listings!, "listing"], [rooms!, "room"], [leads!, "enquiry"], [bookings!, "booking"], [shifts! + bills!, "till record"], [invoices!, "invoice"], [expenses! + recurring!, "expense"], [owners! + units!, "rental record"], [forms!, "online form"], [agreements!, "agreement"], [stock!, "stock item"], [attendance!, "attendance record"], [leaves!, "leave request"], [sites!, "other-site request"]];
  }
  /** Limited members whose only branch is this one. */
  onlyHere(ctx: BusinessContext, branchId: string) {
    return db(ctx).membership.findMany({ where: { tenantId: ctx.business.id, allBranches: false, branches: { some: { branchId }, none: { branchId: { not: branchId } } } }, include: { user: true } });
  }
  /** The memberships and pending invites linked to this branch (only limited people have link rows). */
  async linkedTo(ctx: BusinessContext, branchId: string) {
    return {
      members: (await db(ctx).membershipBranch.findMany({ where: { branchId }, select: { membershipId: true } })).map((l) => l.membershipId),
      invites: (await db(ctx).inviteBranch.findMany({ where: { branchId, invite: { status: "pending" } }, select: { inviteId: true } })).map((l) => l.inviteId),
    };
  }
}

export class SettingsRepository {
  async read(ctx: BusinessContext): Promise<Record<string, unknown>> {
    const t = await db(ctx).tenant.findUnique({ where: { id: ctx.business.id }, select: { settings: true } });
    const s = t?.settings;
    return s && typeof s === "object" && !Array.isArray(s) ? (s as Record<string, unknown>) : {};
  }
  async write(ctx: BusinessContext, settings: Record<string, unknown>) { await db(ctx).tenant.update({ where: { id: ctx.business.id }, data: { settings: settings as Prisma.InputJsonValue } }); }
  listing(ctx: BusinessContext, code: string) {
    const ids = ctx.branches.idsFor("branch");
    return db(ctx).listing.findFirst({ where: { code: code.slice(0, 40), tenantId: ctx.business.id, status: { not: "removed" }, ...(ids ? { branchId: { in: [...ids] } } : {}) } });
  }
  checkListing(ctx: BusinessContext, id: number, data: Prisma.ListingUpdateInput) { return db(ctx).listing.update({ where: { id }, data: { ...data, version: { increment: 1 }, updatedBy: actorIdOf(ctx) } }); }
  checkupLog(ctx: BusinessContext) { return db(ctx).auditLog.findMany({ where: { tenantId: ctx.business.id, action: { startsWith: "checkup." } }, orderBy: { createdAt: "desc" }, take: 300 }); }
  userNames(ctx: BusinessContext, ids: string[]) { return db(ctx).user.findMany({ where: { id: { in: ids } }, select: { id: true, userName: true } }); }
}
