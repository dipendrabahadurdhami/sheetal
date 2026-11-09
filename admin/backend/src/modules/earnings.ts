// Platform earnings: what Sheetal earned, by month: plan payments, add-ons, boosts, and the commission kept on payouts, without
// VAT (VAT is shown on its own; it is owed to the government), less refunds.
// Where it fits: Admin → Billing → Earnings (LiveEarnings.jsx), with a CSV download made by the page.
// How it works: a plan or add-on payment counts in the month it was paid; a refunded one counts as a refund in that
// month. Commission counts when its payout is paid (money still waiting to be paid out is shown separately).
// Rules: billing.view reads. Whole rupees; months in Nepal time. computeEarnings() is also used by the admin dashboard
// (modules/dashboard.ts), so both always show the same numbers.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dbOf, type Db } from "@sheetal/backend-core/lib/db";
import { badRequest } from "@sheetal/backend-core/lib/errors";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import { staffOf } from "./routes.js";

const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month like 2026-11.");
const monthOf = (d: Date) => new Date(d.getTime() + 5.75 * 3_600_000).toISOString().slice(0, 7);
const startOf = (m: string) => new Date(new Date(`${m}-01T00:00:00.000Z`).getTime() - 5.75 * 3_600_000);
const nextMonth = (m: string) => { let [y, mo] = m.split("-").map(Number) as [number, number]; if (++mo > 12) { mo = 1; y++; } return `${y}-${String(mo).padStart(2, "0")}`; };
const vatOf = (amount: number, inv: { vat: number; total: number }) => (inv.total > 0 ? Math.round((amount * inv.vat) / inv.total) : 0);

export interface EarningsRow { month: string; plans: number; addons: number; boosts: number; commission: number; refunds: number; vat: number; total: number }

export async function adminEarningsRoutes(app: FastifyInstance) {
  app.get("/admin/earnings", async (request) => {
    staffOf(request, "billing.view");
    const now = nepalDay().slice(0, 7);
    const q = z.object({ from: Month.optional(), to: Month.optional() }).parse(request.query);
    const to = q.to ?? now;
    let [fy, fm] = to.split("-").map(Number) as [number, number];
    fm -= 11; if (fm < 1) { fm += 12; fy--; }
    const from = q.from ?? `${fy}-${String(fm).padStart(2, "0")}`;
    return { data: await computeEarnings(dbOf(app), from, to) };
  });
}

/** What Sheetal earned from month `from` to month `to` (both like 2026-11), by month, type and business. */
export async function computeEarnings(db: Db, from: string, to: string) {
  if (from > to) throw badRequest("The first month is after the last month.");
  const months: string[] = [];
  for (let m = from; m <= to && months.length < 37; m = nextMonth(m)) months.push(m);
  if (months.length > 36) throw badRequest("Choose up to 36 months.");
  const gte = startOf(from), lt = startOf(nextMonth(to));

  const [payments, payouts, waiting] = await Promise.all([
    db.payment.findMany({ where: { status: { in: ["paid", "refunded"] }, paidAt: { gte, lt } }, select: { tenantId: true, amount: true, status: true, paidAt: true, invoice: { select: { kind: true, vat: true, total: true } } }, take: 100_000 }),
    db.payout.findMany({ where: { status: "paid", paidOn: { gte: new Date(`${from}-01T00:00:00.000Z`), lt: new Date(`${nextMonth(to)}-01T00:00:00.000Z`) } }, select: { tenantId: true, fee: true, paidOn: true }, take: 100_000 }),
    db.payoutItem.aggregate({ where: { payoutId: null }, _sum: { fee: true } }),
  ]);
  const tenantIds = [...new Set([...payments.map((p) => p.tenantId), ...payouts.map((p) => p.tenantId)])];
  const tenants = new Map((await db.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true, type: true } })).map((t) => [t.id, t]));

  const rows = new Map<string, EarningsRow>(months.map((m) => [m, { month: m, plans: 0, addons: 0, boosts: 0, commission: 0, refunds: 0, vat: 0, total: 0 }]));
  const byType: Record<string, number> = {};
  const byTenant = new Map<string, number>();
  const add = (tenantId: string, n: number) => { const t = tenants.get(tenantId); if (t) byType[t.type] = (byType[t.type] ?? 0) + n; byTenant.set(tenantId, (byTenant.get(tenantId) ?? 0) + n); };
  for (const p of payments) {
    const r = rows.get(monthOf(p.paidAt!)); if (!r) continue;
    const vat = vatOf(p.amount, p.invoice), net = p.amount - vat;
    if (p.status === "refunded") { r.refunds += net; r.vat -= vat; add(p.tenantId, -net); continue; }
    if (p.invoice.kind === "addon") r.addons += net; else if (p.invoice.kind === "boost" || p.invoice.kind === "banner") r.boosts += net; else r.plans += net;
    r.vat += vat; add(p.tenantId, net);
  }
  for (const p of payouts) { const r = rows.get(p.paidOn!.toISOString().slice(0, 7)); if (!r) continue; r.commission += p.fee; add(p.tenantId, p.fee); }
  for (const r of rows.values()) r.total = r.plans + r.addons + r.boosts + r.commission - r.refunds;
  const list = [...rows.values()].reverse();
  const sum = (k: keyof Omit<EarningsRow, "month">) => list.reduce((s, r) => s + r[k], 0);
  return {
      from, to, rows: list,
      totals: { plans: sum("plans"), addons: sum("addons"), boosts: sum("boosts"), commission: sum("commission"), refunds: sum("refunds"), vat: sum("vat"), total: sum("total") },
      commissionWaiting: waiting._sum.fee ?? 0,
      byType: Object.entries(byType).map(([type, total]) => ({ type, total })).sort((a, b) => b.total - a.total),
      top: [...byTenant.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, total]) => ({ id, name: tenants.get(id)?.name ?? "", type: tenants.get(id)?.type ?? "", total })),
  };
}
