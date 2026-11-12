// Business overview: the live numbers on the first page of the panel (Business → Overview).
// Where it fits: LiveOverview.jsx calls GET /overview; nothing else uses it.
// How it works: one call returns blocks (listings, leads, today, money, rent, plan, promote, attention). A block is
// only sent when the person's role may see it (ws.can for each), and everything that belongs to a branch is counted
// over the branches in view (branchView / inView). Dates are Nepal days; money is whole rupees.
// Rules: read only (no audit row); a role with nothing to see gets empty blocks, not an error; "needs attention" only
// lists what the person can open, each with a link to the page that fixes it.

import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { effectiveLimits } from "@sheetal/backend-core/domain/addons";
import { dayOf, ymd } from "@sheetal/backend-core/domain/money";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import { addDays } from "@sheetal/backend-core/domain/promote";
import { branchView, inView, workspaceOf, type Workspace } from "../access.js";

const NEPAL_MS = 5.75 * 3_600_000;
/** The moment a Nepal day starts, as a real time (Nepal midnight). */
const startOfDay = (s: string) => new Date(dayOf(s).getTime() - NEPAL_MS);
/** Guards Invalid Date: a bad date never reaches a query. */
const safeDay = (s: string) => { const d = dayOf(s); return Number.isNaN(d.getTime()) ? null : d; };
const monthEnd = (month: string) => { const [y, m] = month.split("-").map(Number) as [number, number]; return ymd(new Date(Date.UTC(y, m, 0))); };

export async function overviewRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const any = (ws: Workspace, ...perms: string[]) => perms.some((p) => ws.can(p));

  app.get("/overview", async (request) => {
    const ws = workspaceOf(request);
    const v = await branchView(db(), request, ws);
    const branch = inView(v);
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

    const tenant = await db().tenant.findUniqueOrThrow({ where: { id: ws.tenantId }, include: { plan: true } });
    const type = tenant.type;
    const out: Record<string, unknown> = { today, month, type, branches: v.mine.length };
    const attention: { id: string; icon: string; text: string; to: string; cta: string }[] = [];
    const todo = (id: string, icon: string, text: string, to: string, cta: string) => attention.push({ id, icon, text, to, cta });
    const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

    // ───── Listings ─────
    if (any(ws, "listings.listing.read+listings.listing.create+listings.listing.update+listings.listing.delete+listings.listing.publish", "projects.project.read+projects.project.create+projects.project.update+projects.project.delete", "investments.offering.read+investments.offering.create+investments.offering.update+investments.offering.delete", "hotel.calendar.update")) {
      const rows = await db().listing.groupBy({ by: ["status"], where: { tenantId: ws.tenantId, ...branch }, _count: true });
      const n = (s: string) => rows.find((r) => r.status === s)?._count ?? 0;
      out.listings = { published: n("published"), pending: n("pending"), drafts: n("draft"), rejected: n("rejected"), paused: n("paused") };
      if (n("rejected")) todo("rejected", "file-warning", `${plural(n("rejected"), "listing")} sent back with changes to make`, "/business/listings", "Open");
    }

    // ───── Leads (people who can assign leads see all; others their own and unassigned) ─────
    if (any(ws, "crm.lead.read", "crm.message.reply")) {
      const all = ws.can("crm.lead.assign") || ws.member.role.key === "owner";
      const mine: Prisma.LeadWhereInput = { tenantId: ws.tenantId, ...branch, ...(all ? {} : { OR: [{ assigneeId: ws.user.id }, { assigneeId: null }] }) };
      const open = { notIn: ["won", "lost"] };
      const [week, recent, followUps] = await Promise.all([
        db().lead.count({ where: { ...mine, createdAt: { gte: weekAgo } } }),
        db().lead.findMany({ where: { ...mine, status: open, lastAt: { gte: new Date(Date.now() - 90 * 864e5) } }, select: { readAt: true, lastAt: true }, take: 5000 }),
        db().lead.count({ where: { ...mine, status: open, followAt: { not: null, lt: endOfToday } } }),
      ]);
      const unread = recent.filter((l) => !l.readAt || l.readAt < l.lastAt).length;
      out.leads = { newThisWeek: week, unread, followUpsDue: followUps };
      if (unread) todo("unread", "mail", `${plural(unread, "message")} waiting for a reply`, "/business/inbox", "Open");
      if (followUps) todo("followups", "phone-call", `${plural(followUps, "follow-up")} due today or late`, "/business/inbox", "Open");
    }

    // ───── By business type ─────
    const today_: Record<string, unknown> = {};
    if ((type === "hotel" || type === "host") && ws.can("hotel.booking.read")) {
      const [arrivals, departures, inHouse, rooms, stays] = await Promise.all([
        db().booking.count({ where: { tenantId: ws.tenantId, ...branch, status: { in: ["requested", "confirmed"] }, checkIn: todayD } }),
        db().booking.count({ where: { tenantId: ws.tenantId, ...branch, status: "checked_in", checkOut: todayD } }),
        db().booking.count({ where: { tenantId: ws.tenantId, ...branch, status: "checked_in" } }),
        db().room.count({ where: { tenantId: ws.tenantId, ...branch, active: true } }),
        db().booking.findMany({ where: { tenantId: ws.tenantId, ...branch, status: { in: ["confirmed", "checked_in", "completed"] }, checkIn: { lt: monthTo }, checkOut: { gt: monthFrom } }, select: { checkIn: true, checkOut: true }, take: 20_000 }),
      ]);
      // Occupancy this month: nights sold (inside the month) over rooms × days of the month.
      const days = Math.round((monthTo.getTime() - monthFrom.getTime()) / 864e5);
      const nights = stays.reduce((s, b) => s + Math.max(0, Math.round((Math.min(b.checkOut.getTime(), monthTo.getTime()) - Math.max(b.checkIn.getTime(), monthFrom.getTime())) / 864e5)), 0);
      today_.stays = { arrivals, departures, inHouse, rooms, nightsSold: nights, days, occupancyPct: rooms ? Math.min(100, Math.round((nights / (rooms * days)) * 100)) : null };
    }
    if (type === "agency" && any(ws, "listings.viewing.read+listings.viewing.create+listings.viewing.update+listings.viewing.delete", "crm.lead.read")) {
      const viewings = await db().lead.count({ where: { tenantId: ws.tenantId, ...branch, status: "viewing", followAt: { gte: startOfDay(today), lt: weekEnd } } });
      today_.agency = { viewingsThisWeek: viewings };
    }
    if (type === "developer") {
      const sub: Record<string, number> = {};
      if (ws.can("projects.visit.read+projects.visit.create+projects.visit.update+projects.visit.delete")) sub.siteVisits = await db().lead.count({ where: { tenantId: ws.tenantId, ...branch, kind: "site_visit", status: { notIn: ["won", "lost"] } } });
      if (ws.can("projects.reservation.read+projects.reservation.create+projects.reservation.update+projects.reservation.delete")) {
        const [reserved, sold] = await Promise.all([db().reservation.count({ where: { tenantId: ws.tenantId, status: "reserved" } }), db().reservation.count({ where: { tenantId: ws.tenantId, status: "sold" } })]);
        sub.reservations = reserved; sub.sold = sold;
      }
      if (Object.keys(sub).length) today_.developer = sub;
    }
    if (Object.keys(today_).length) out.today = today_;

    // ───── Money this month ─────
    const money: Record<string, unknown> = {};
    if (ws.can("invoicing.invoice.read")) {
      const sent = await db().bizInvoice.findMany({ where: { tenantId: ws.tenantId, ...branch, kind: "invoice", status: "sent" }, select: { total: true, issuedOn: true, dueOn: true, receipts: { select: { amount: true } } }, take: 20_000 });
      let sentN = 0, sentTotal = 0, paidN = 0, overdueN = 0, overdueTotal = 0;
      for (const i of sent) {
        const paid = i.receipts.reduce((s, r) => s + r.amount, 0), balance = Math.max(0, i.total - paid);
        if (i.issuedOn >= monthFrom && i.issuedOn < monthTo) { sentN++; sentTotal += i.total; if (!balance) paidN++; }
        if (balance > 0 && i.dueOn < todayD) { overdueN++; overdueTotal += balance; }
      }
      money.invoices = { sent: sentN, sentTotal, paid: paidN, overdue: overdueN, overdueTotal };
      if (overdueN) todo("overdue", "receipt", `${plural(overdueN, "invoice")} overdue`, "/business/invoices", "Open");
    }
    if (ws.can("expenses.expense.read+expenses.recurring.read+expenses.profit.read")) {
      const [spent, receipts, payouts] = await Promise.all([
        db().expense.aggregate({ where: { tenantId: ws.tenantId, ...branch, status: "confirmed", spentOn: { gte: monthFrom, lt: monthTo } }, _sum: { amount: true }, _count: true }),
        // Money received directly: receipts without VAT; what Sheetal collected reaches the business as a payout.
        db().bizReceipt.findMany({ where: { tenantId: ws.tenantId, method: { not: "sheetal" }, paidOn: { gte: monthFrom, lt: monthTo }, invoice: { ...branch, kind: "invoice" } }, select: { amount: true, invoice: { select: { subtotal: true, total: true } } }, take: 50_000 }),
        db().payout.aggregate({ where: { tenantId: ws.tenantId, ...branch, status: "paid", paidOn: { gte: monthFrom, lt: monthTo } }, _sum: { net: true } }),
      ]);
      const received = receipts.reduce((s, r) => s + (r.invoice.total > 0 ? Math.round((r.amount * r.invoice.subtotal) / r.invoice.total) : r.amount), 0) + (payouts._sum.net ?? 0);
      const expenses = spent._sum.amount ?? 0;
      money.expenses = { total: expenses, count: spent._count, received, profit: received - expenses };
    }
    if (ws.can("invoicing.payout.read")) {
      const [pending, waiting] = await Promise.all([
        db().payout.aggregate({ where: { tenantId: ws.tenantId, ...branch, status: "pending" }, _sum: { net: true }, _count: true }),
        db().payoutItem.aggregate({ where: { tenantId: ws.tenantId, ...branch, payoutId: null }, _sum: { net: true } }),
      ]);
      money.payouts = { pending: pending._sum.net ?? 0, pendingCount: pending._count, waiting: waiting._sum.net ?? 0 };
    }
    if (Object.keys(money).length) out.money = money;

    if (type === "agency" && ws.can("rentals.rental.read")) {
      const bills = await db().rentBill.findMany({ where: { tenantId: ws.tenantId, ...branch, OR: [{ month }, { dueOn: { lt: todayD } }] }, select: { month: true, dueOn: true, amount: true, lateFee: true, paid: true }, take: 20_000 });
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
    if (any(ws, "workspace.overview.read", "workspace.billing.manage")) {
      const plan = await effectiveLimits(db(), ws.tenantId, tenant.plan);
      const limits = (plan.limits ?? {}) as Record<string, number>;
      const [seats, listings, featured] = await Promise.all([
        db().membership.count({ where: { tenantId: ws.tenantId, status: "active" } }),
        db().listing.count({ where: { tenantId: ws.tenantId, status: { in: ["draft", "pending", "published", "paused"] } } }),
        db().listing.count({ where: { tenantId: ws.tenantId, featured: true, status: "published" } }),
      ]);
      const used: Record<string, number> = { seats, listings, featured };
      out.plan = { id: plan.id, name: plan.name, price: plan.price, status: tenant.status, renewsAt: tenant.renewsAt ? ymd(tenant.renewsAt) : null, usage: Object.entries(limits).map(([key, limit]) => ({ key, limit, used: used[key] ?? null })) };
      if (tenant.status === "past_due" && ws.can("workspace.billing.manage")) todo("past-due", "credit-card", "Your plan payment is late", "/business/billing", "Pay now");
    }
    if (any(ws, "listings.listing.read+listings.listing.create+listings.listing.update+listings.listing.delete+listings.listing.publish", "projects.project.read+projects.project.create+projects.project.update+projects.project.delete", "investments.offering.read+investments.offering.create+investments.offering.update+investments.offering.delete", "hotel.calendar.update", "workspace.billing.manage")) {
      const live = { startOn: { lte: todayD }, endOn: { gte: todayD } };
      const [boosts, banners, unpaidBoosts, unpaidBanners] = await Promise.all([
        db().boost.count({ where: { tenantId: ws.tenantId, status: "paid", ...live } }),
        db().banner.count({ where: { tenantId: ws.tenantId, status: "approved", ...live } }),
        db().boost.count({ where: { tenantId: ws.tenantId, status: "awaiting", endOn: { gte: todayD } } }),
        db().banner.count({ where: { tenantId: ws.tenantId, status: "awaiting", endOn: { gte: todayD } } }),
      ]);
      out.promote = { liveBoosts: boosts, liveBanners: banners, unpaid: unpaidBoosts + unpaidBanners };
      if (unpaidBoosts + unpaidBanners) todo("unpaid-boost", "megaphone", `${plural(unpaidBoosts + unpaidBanners, "boost or banner")} waiting for payment`, "/business/promote", "Pay");
    }
    if (ws.can("workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete") && (tenant.verification === "none" || tenant.verification === "rejected")) {
      todo("verify", "badge-check", tenant.verification === "rejected" ? "Your business verification was sent back" : "Verify your business to show the badge", "/business/settings/verification", "Open");
    }

    out.attention = attention;
    return { data: out };
  });
}
