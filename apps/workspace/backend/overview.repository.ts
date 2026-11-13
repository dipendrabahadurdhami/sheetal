// The only code of the business Overview that reads tables (KERNEL.md section 6). Moved out of business/backend/src/modules/overview/routes.ts in P2-W6
// (Workspace part 2). Every query is a read: the Overview counts what the other apps keep (listings, leads, bookings, invoices, expenses, payouts, rent,
// boosts) and never writes them (an agreed cross-app read, docs/architecture/MODEL-OWNERS.md).
// Where it fits: OverviewService calls one method per block of the page.
// How it works: each method takes the business from the context and the branch filter (`where`) the service worked out from the branches in view.
// Rules: every query carries this business; branch work is counted only over the branches in view.

import type { Prisma } from "@prisma/client";
import type { BusinessContext } from "@sheetal/platform/core/context";
import { effectiveLimits } from "@sheetal/backend-core/domain/addons";

type Tx = Prisma.TransactionClient;
const db = (ctx: BusinessContext): Tx => (ctx.tx ?? ctx.db) as unknown as Tx;
/** The branch filter: `{}` (the whole business) or `{ branchId: { in: [...] } }`. */
export type InView = { branchId?: { in: string[] } };

export class OverviewRepository {
  tenant(ctx: BusinessContext) { return db(ctx).tenant.findUniqueOrThrow({ where: { id: ctx.business.id }, include: { plan: true } }); }
  listingsByStatus(ctx: BusinessContext, branch: InView) { return db(ctx).listing.groupBy({ by: ["status"], where: { tenantId: ctx.business.id, ...branch }, _count: true }); }

  leads(ctx: BusinessContext, branch: InView, o: { mineOnly: string | null; weekAgo: Date; endOfToday: Date }) {
    const t = ctx.business.id;
    const mine: Prisma.LeadWhereInput = { tenantId: t, ...branch, ...(o.mineOnly ? { OR: [{ assigneeId: o.mineOnly }, { assigneeId: null }] } : {}) };
    const open = { notIn: ["won", "lost"] };
    return Promise.all([
      db(ctx).lead.count({ where: { ...mine, createdAt: { gte: o.weekAgo } } }),
      db(ctx).lead.findMany({ where: { ...mine, status: open, lastAt: { gte: new Date(Date.now() - 90 * 864e5) } }, select: { readAt: true, lastAt: true }, take: 5000 }),
      db(ctx).lead.count({ where: { ...mine, status: open, followAt: { not: null, lt: o.endOfToday } } }),
    ]);
  }

  stays(ctx: BusinessContext, branch: InView, o: { today: Date; monthFrom: Date; monthTo: Date }) {
    const w = { tenantId: ctx.business.id, ...branch };
    return Promise.all([
      db(ctx).booking.count({ where: { ...w, status: { in: ["requested", "confirmed"] }, checkIn: o.today } }),
      db(ctx).booking.count({ where: { ...w, status: "checked_in", checkOut: o.today } }),
      db(ctx).booking.count({ where: { ...w, status: "checked_in" } }),
      db(ctx).room.count({ where: { ...w, active: true } }),
      db(ctx).booking.findMany({ where: { ...w, status: { in: ["confirmed", "checked_in", "completed"] }, checkIn: { lt: o.monthTo }, checkOut: { gt: o.monthFrom } }, select: { checkIn: true, checkOut: true }, take: 20_000 }),
    ]);
  }
  viewings(ctx: BusinessContext, branch: InView, from: Date, to: Date) {
    return db(ctx).lead.count({ where: { tenantId: ctx.business.id, ...branch, status: "viewing", followAt: { gte: from, lt: to } } });
  }
  siteVisits(ctx: BusinessContext, branch: InView) {
    return db(ctx).lead.count({ where: { tenantId: ctx.business.id, ...branch, kind: "site_visit", status: { notIn: ["won", "lost"] } } });
  }
  reservations(ctx: BusinessContext) {
    const t = ctx.business.id;
    return Promise.all([db(ctx).reservation.count({ where: { tenantId: t, status: "reserved" } }), db(ctx).reservation.count({ where: { tenantId: t, status: "sold" } })]);
  }

  sentInvoices(ctx: BusinessContext, branch: InView) {
    return db(ctx).bizInvoice.findMany({ where: { tenantId: ctx.business.id, ...branch, kind: "invoice", status: "sent" }, select: { total: true, issuedOn: true, dueOn: true, receipts: { select: { amount: true } } }, take: 20_000 });
  }
  moneyInOut(ctx: BusinessContext, branch: InView, from: Date, to: Date) {
    const t = ctx.business.id;
    return Promise.all([
      db(ctx).expense.aggregate({ where: { tenantId: t, ...branch, status: "confirmed", spentOn: { gte: from, lt: to } }, _sum: { amount: true }, _count: true }),
      // Money received directly: receipts without VAT; what Sheetal collected reaches the business as a payout.
      db(ctx).bizReceipt.findMany({ where: { tenantId: t, method: { not: "sheetal" }, paidOn: { gte: from, lt: to }, invoice: { ...branch, kind: "invoice" } }, select: { amount: true, invoice: { select: { subtotal: true, total: true } } }, take: 50_000 }),
      db(ctx).payout.aggregate({ where: { tenantId: t, ...branch, status: "paid", paidOn: { gte: from, lt: to } }, _sum: { net: true } }),
    ]);
  }
  payouts(ctx: BusinessContext, branch: InView) {
    const t = ctx.business.id;
    return Promise.all([
      db(ctx).payout.aggregate({ where: { tenantId: t, ...branch, status: "pending" }, _sum: { net: true }, _count: true }),
      db(ctx).payoutItem.aggregate({ where: { tenantId: t, ...branch, payoutId: null }, _sum: { net: true } }),
    ]);
  }
  rentBills(ctx: BusinessContext, branch: InView, month: string, today: Date) {
    return db(ctx).rentBill.findMany({ where: { tenantId: ctx.business.id, ...branch, OR: [{ month }, { dueOn: { lt: today } }] }, select: { month: true, dueOn: true, amount: true, lateFee: true, paid: true }, take: 20_000 });
  }

  /** The plan with any add-ons bought, and what is used of its limits. */
  async planUse<P extends { price: number; limits: unknown }>(ctx: BusinessContext, plan: P) {
    const t = ctx.business.id;
    const [p, seats, listings, featured] = await Promise.all([
      effectiveLimits(db(ctx) as never, t, plan),
      db(ctx).membership.count({ where: { tenantId: t, status: "active" } }),
      db(ctx).listing.count({ where: { tenantId: t, status: { in: ["draft", "pending", "published", "paused"] } } }),
      db(ctx).listing.count({ where: { tenantId: t, featured: true, status: "published" } }),
    ]);
    return { plan: p, used: { seats, listings, featured } as Record<string, number> };
  }
  promotions(ctx: BusinessContext, today: Date) {
    const t = ctx.business.id, live = { startOn: { lte: today }, endOn: { gte: today } };
    return Promise.all([
      db(ctx).boost.count({ where: { tenantId: t, status: "paid", ...live } }),
      db(ctx).banner.count({ where: { tenantId: t, status: "approved", ...live } }),
      db(ctx).boost.count({ where: { tenantId: t, status: "awaiting", endOn: { gte: today } } }),
      db(ctx).banner.count({ where: { tenantId: t, status: "awaiting", endOn: { gte: today } } }),
    ]);
  }
}
