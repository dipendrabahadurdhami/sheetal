// Business overview on the kernel: the live numbers on the first page of the panel (Business → Overview). Moved from
// business/backend/src/modules/overview/routes.ts in P2-W6 (Workspace part 2); every block, number, text and link unchanged.
// Where it fits: OverviewController calls overview() for GET /overview (LiveOverview.jsx); nothing else uses it.
// How it works: one call returns blocks (listings, leads, today, money, rent, plan, promote, attention). A block is only sent when the person's role may
// see it, and everything that belongs to a branch is counted over the branches in view (ctx.branches.idsFor("branch")). Dates are Nepal days; money is
// whole rupees.
// Rules: read only (no audit row, no event); a role with nothing to see gets empty blocks, not an error; "needs attention" only lists what the person can
// open, each with a link to the page that fixes it.

import type { BusinessContext } from "@sheetal/platform/core/context";
import { dayOf, ymd } from "@sheetal/backend-core/domain/money";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import { addDays } from "@sheetal/backend-core/domain/promote";
import { OverviewRepository, type InView } from "./overview.repository.js";
import { SETTINGS_PERM } from "./workspace.service.js";

const NEPAL_MS = 5.75 * 3_600_000;
/** The moment a Nepal day starts, as a real time (Nepal midnight). */
const startOfDay = (s: string) => new Date(dayOf(s).getTime() - NEPAL_MS);
/** Guards Invalid Date: a bad date never reaches a query. */
const safeDay = (s: string) => { const d = dayOf(s); return Number.isNaN(d.getTime()) ? null : d; };
const monthEnd = (month: string) => { const [y, m] = month.split("-").map(Number) as [number, number]; return ymd(new Date(Date.UTC(y, m, 0))); };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const LISTING_SIDE = ["listings.listing.read+listings.listing.create+listings.listing.update+listings.listing.delete+listings.listing.publish", "projects.project.read+projects.project.create+projects.project.update+projects.project.delete", "investments.offering.read+investments.offering.create+investments.offering.update+investments.offering.delete", "hotel.calendar.update"];

export class OverviewService {
  readonly repo = new OverviewRepository();

  async overview(ctx: BusinessContext) {
    const can = (p: string) => ctx.permissions.can(p);
    const any = (...perms: string[]) => perms.some(can);
    const ids = ctx.branches.idsFor("branch");
    const branch: InView = ids ? { branchId: { in: [...ids] } } : {};
    const today = nepalDay();
    const tomorrow = addDays(today, 1);
    const month = today.slice(0, 7);
    const first = `${month}-01`, last = monthEnd(month);
    const monthFrom = dayOf(first), monthTo = dayOf(addDays(last, 1));
    const todayD = safeDay(today), tomorrowD = safeDay(tomorrow);
    if (!todayD || !tomorrowD) throw new Error("Bad date.");
    const weekAgo = startOfDay(addDays(today, -6));
    const endOfToday = startOfDay(tomorrow);
    const weekEnd = startOfDay(addDays(today, 7));

    const tenant = await this.repo.tenant(ctx);
    const type = tenant.type;
    const out: Record<string, unknown> = { today, month, type, branches: ctx.branches.mine.length };
    const attention: { id: string; icon: string; text: string; to: string; cta: string }[] = [];
    const todo = (id: string, icon: string, text: string, to: string, cta: string) => attention.push({ id, icon, text, to, cta });

    // ───── Listings ─────
    if (any(...LISTING_SIDE)) {
      const rows = await this.repo.listingsByStatus(ctx, branch);
      const n = (s: string) => rows.find((r) => r.status === s)?._count ?? 0;
      out.listings = { published: n("published"), pending: n("pending"), drafts: n("draft"), rejected: n("rejected"), paused: n("paused") };
      if (n("rejected")) todo("rejected", "file-warning", `${plural(n("rejected"), "listing")} sent back with changes to make`, "/business/listings", "Open");
    }

    // ───── Leads (people who can assign leads see all; others their own and unassigned) ─────
    if (any("crm.lead.read", "crm.message.reply")) {
      const all = can("crm.lead.assign") || ctx.member.roleKey === "owner";
      const [week, recent, followUps] = await this.repo.leads(ctx, branch, { mineOnly: all ? null : ctx.member.userId, weekAgo, endOfToday });
      const unread = recent.filter((l) => !l.readAt || l.readAt < l.lastAt).length;
      out.leads = { newThisWeek: week, unread, followUpsDue: followUps };
      if (unread) todo("unread", "mail", `${plural(unread, "message")} waiting for a reply`, "/business/inbox", "Open");
      if (followUps) todo("followups", "phone-call", `${plural(followUps, "follow-up")} due today or late`, "/business/inbox", "Open");
    }

    // ───── By business type ─────
    const today_: Record<string, unknown> = {};
    if ((type === "hotel" || type === "host") && can("hotel.booking.read")) {
      const [arrivals, departures, inHouse, rooms, stays] = await this.repo.stays(ctx, branch, { today: todayD, monthFrom, monthTo });
      // Occupancy this month: nights sold (inside the month) over rooms × days of the month.
      const days = Math.round((monthTo.getTime() - monthFrom.getTime()) / 864e5);
      const nights = stays.reduce((s, b) => s + Math.max(0, Math.round((Math.min(b.checkOut.getTime(), monthTo.getTime()) - Math.max(b.checkIn.getTime(), monthFrom.getTime())) / 864e5)), 0);
      today_.stays = { arrivals, departures, inHouse, rooms, nightsSold: nights, days, occupancyPct: rooms ? Math.min(100, Math.round((nights / (rooms * days)) * 100)) : null };
    }
    if (type === "agency" && any("listings.viewing.read+listings.viewing.create+listings.viewing.update+listings.viewing.delete", "crm.lead.read")) {
      today_.agency = { viewingsThisWeek: await this.repo.viewings(ctx, branch, startOfDay(today), weekEnd) };
    }
    if (type === "developer") {
      const sub: Record<string, number> = {};
      if (can("projects.visit.read+projects.visit.create+projects.visit.update+projects.visit.delete")) sub.siteVisits = await this.repo.siteVisits(ctx, branch);
      if (can("projects.reservation.read+projects.reservation.create+projects.reservation.update+projects.reservation.delete")) {
        const [reserved, sold] = await this.repo.reservations(ctx);
        sub.reservations = reserved; sub.sold = sold;
      }
      if (Object.keys(sub).length) today_.developer = sub;
    }
    if (Object.keys(today_).length) out.today = today_;

    // ───── Money this month ─────
    const money: Record<string, unknown> = {};
    if (can("invoicing.invoice.read")) {
      const sent = await this.repo.sentInvoices(ctx, branch);
      let sentN = 0, sentTotal = 0, paidN = 0, overdueN = 0, overdueTotal = 0;
      for (const i of sent) {
        const paid = i.receipts.reduce((s, r) => s + r.amount, 0), balance = Math.max(0, i.total - paid);
        if (i.issuedOn >= monthFrom && i.issuedOn < monthTo) { sentN++; sentTotal += i.total; if (!balance) paidN++; }
        if (balance > 0 && i.dueOn < todayD) { overdueN++; overdueTotal += balance; }
      }
      money.invoices = { sent: sentN, sentTotal, paid: paidN, overdue: overdueN, overdueTotal };
      if (overdueN) todo("overdue", "receipt", `${plural(overdueN, "invoice")} overdue`, "/business/invoices", "Open");
    }
    if (can("expenses.expense.read+expenses.recurring.read+expenses.profit.read")) {
      const [spent, receipts, payouts] = await this.repo.moneyInOut(ctx, branch, monthFrom, monthTo);
      const received = receipts.reduce((s, r) => s + (r.invoice.total > 0 ? Math.round((r.amount * r.invoice.subtotal) / r.invoice.total) : r.amount), 0) + (payouts._sum.net ?? 0);
      const expenses = spent._sum.amount ?? 0;
      money.expenses = { total: expenses, count: spent._count, received, profit: received - expenses };
    }
    if (can("invoicing.payout.read")) {
      const [pending, waiting] = await this.repo.payouts(ctx, branch);
      money.payouts = { pending: pending._sum.net ?? 0, pendingCount: pending._count, waiting: waiting._sum.net ?? 0 };
    }
    if (Object.keys(money).length) out.money = money;

    if (type === "agency" && can("rentals.rental.read")) {
      const bills = await this.repo.rentBills(ctx, branch, month, todayD);
      let due = 0, dueN = 0, late = 0, lateN = 0;
      for (const b of bills) {
        const left = b.amount + b.lateFee - b.paid;
        if (left <= 0) continue;
        if (b.month === month) { due += left; dueN++; }
        if (b.dueOn < todayD) { late += left; lateN++; }
      }
      out.rent = { due, dueCount: dueN, late, lateCount: lateN };
      if (lateN) todo("rent-late", "home", `${plural(lateN, "rent bill")} late`, "/business/rentals", "Open");
    }

    // ───── Plan, boosts and banners ─────
    if (any("workspace.overview.read", "workspace.billing.manage")) {
      const { plan, used } = await this.repo.planUse(ctx, tenant.plan);
      const limits = (plan.limits ?? {}) as Record<string, number>;
      out.plan = { id: plan.id, name: plan.name, price: plan.price, status: tenant.status, renewsAt: tenant.renewsAt ? ymd(tenant.renewsAt) : null, usage: Object.entries(limits).map(([key, limit]) => ({ key, limit, used: used[key] ?? null })) };
      if (tenant.status === "past_due" && can("workspace.billing.manage")) todo("past-due", "credit-card", "Your plan payment is late", "/business/billing", "Pay now");
    }
    if (any(...LISTING_SIDE, "workspace.billing.manage")) {
      const [boosts, banners, unpaidBoosts, unpaidBanners] = await this.repo.promotions(ctx, todayD);
      out.promote = { liveBoosts: boosts, liveBanners: banners, unpaid: unpaidBoosts + unpaidBanners };
      if (unpaidBoosts + unpaidBanners) todo("unpaid-boost", "megaphone", `${plural(unpaidBoosts + unpaidBanners, "boost or banner")} waiting for payment`, "/business/promote", "Pay");
    }
    if (can(SETTINGS_PERM) && (tenant.verification === "none" || tenant.verification === "rejected")) {
      todo("verify", "badge-check", tenant.verification === "rejected" ? "Your business verification was sent back" : "Verify your business to show the badge", "/business/settings/verification", "Open");
    }

    out.attention = attention;
    return out;
  }
}
