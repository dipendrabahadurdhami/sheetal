// Admin dashboard: the live numbers on the first page of the admin panel (Admin → Dashboard).
// Where it fits: LiveDashboard.jsx calls GET /admin/dashboard.
// How it works: businesses by status and type, new sign-ups (7 and 30 days), trials ending within 7 days, past due, MRR
// (what active paid plans are worth a month at list price; businesses covered by another's plan pay nothing), this
// month's earnings (computeEarnings in earnings.ts, so the numbers match Billing → Earnings), and the work waiting for
// staff: bank transfers to check, listings to review, KYC, banner pictures, new platform leads, requirement fees,
// upgrade requests. Each waiting item carries the link to the page where it is handled.
// Rules: dashboard.view reads; every block is only sent to staff whose role may open its page (billing.view,
// moderation.listings, moderation.kyc, tenants.view, plans.manage); counts only, no personal details; whole rupees.

import type { FastifyInstance } from "fastify";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import { computeEarnings } from "./earnings.js";
import { staffOf } from "./routes.js";

export async function adminDashboardRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);

  app.get("/admin/dashboard", async (request) => {
    const s = staffOf(request, "dashboard.view");
    const now = new Date();
    const ago = (days: number) => new Date(now.getTime() - days * 864e5);
    const ahead = (days: number) => new Date(now.getTime() + days * 864e5);
    const month = nepalDay().slice(0, 7);
    const out: Record<string, unknown> = { month };

    const [byStatus, byType, d7, d30, trials, paying] = await Promise.all([
      db().tenant.groupBy({ by: ["status"], _count: true }),
      db().tenant.groupBy({ by: ["type"], _count: true }),
      db().tenant.count({ where: { createdAt: { gte: ago(7) } } }),
      db().tenant.count({ where: { createdAt: { gte: ago(30) } } }),
      db().tenant.count({ where: { status: "trial", renewsAt: { gte: now, lte: ahead(7) } } }),
      db().tenant.findMany({ where: { status: "active", coveredById: null, plan: { price: { gt: 0 } } }, select: { plan: { select: { price: true } } }, take: 100_000 }),
    ]);
    const status = Object.fromEntries(byStatus.map((r) => [r.status, r._count]));
    out.businesses = { total: byStatus.reduce((n, r) => n + r._count, 0), byStatus: status, byType: Object.fromEntries(byType.map((r) => [r.type, r._count])) };
    out.signups = { last7: d7, last30: d30 };
    out.trialsEnding = trials;
    out.pastDue = status.past_due ?? 0;
    out.mrr = { total: paying.reduce((n, t) => n + t.plan.price, 0), payingBusinesses: paying.length };

    // Money this month: what Sheetal earned (without VAT), as Billing → Earnings shows it.
    if (s.can("billing.view")) {
      const e = await computeEarnings(db(), month, month);
      out.money = { plans: e.totals.plans, addons: e.totals.addons, boosts: e.totals.boosts, commission: e.totals.commission, refunds: e.totals.refunds, total: e.totals.total, commissionWaiting: e.commissionWaiting };
    }

    // Work waiting for staff, only what this role can open.
    const queue: { id: string; label: string; count: number; to: string }[] = [];
    const add = async (id: string, label: string, to: string, allowed: boolean, count: () => Promise<number>) => { if (allowed) queue.push({ id, label, to, count: await count() }); };
    await add("transfers", "Bank transfers to check", "/admin/billing", s.can("billing.view"), () => db().payment.count({ where: { status: "pending_review" } }));
    await add("listings", "Listings waiting for review", "/admin/moderation", s.can("moderation.listings"), () => db().listing.count({ where: { status: "pending" } }));
    await add("kyc", "Businesses waiting for verification", "/admin/moderation", s.can("moderation.kyc"), () => db().tenant.count({ where: { verification: "pending" } }));
    await add("banners", "Banner pictures to check", "/admin/promote", s.can("billing.view"), () => db().banner.count({ where: { status: "review" } }));
    await add("upgrades", "Upgrade requests", "/admin/requests", s.can("tenants.view"), () => db().upgradeRequest.count({ where: { status: "pending" } }));
    await add("leads", "New platform leads", "/admin/leads", s.can("tenants.view"), () => db().lead.count({ where: { tenantId: null, status: "new" } }));
    await add("fees", "Requirement fees to check", "/admin/leads", s.can("tenants.view"), () => db().lead.count({ where: { feeStatus: "pending" } }));
    out.queue = queue;
    return { data: out };
  });
}
