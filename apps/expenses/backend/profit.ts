// Profit by month and branch: money received minus money spent.
// Where it fits: moved here from backend-core/src/domain/expenses.ts (P1-BE-5); that file re-exports it. Used by GET /expenses/profit.
// How it works: Profit by month and branch = money received directly + payouts from Sheetal − confirmed expenses. Direct money is what the
// business received itself (invoice payments, without VAT, counted in the month they were paid); money Sheetal collected reaches the
// business through a payout, so a payment with method "sheetal" is left out and the payout (its net, in the month it was paid) is counted
// instead. Rentals: the management fee of saved owner statements counts as direct money in the statement's month (rent itself is the
// owner's money). VAT collected and Sheetal's commission are shown for information only: VAT is owed to the government, and the
// commission is already taken off the payout.
// Rules: whole rupees; months are calendar months in Nepal time (use nepalDay()); expenses count by their expense date, invoice
// payments by their paid date, payouts by their paid date; only confirmed, not-deleted expenses count. This stays inside the Expenses app
// for Phase 1 and the manifest lists the tables it reads (dependencies.reads); it is split into profit sources in Phase 2 (KERNEL.md 10.6).

import type { Db } from "@sheetal/platform/db/client";
import { dayOf, ymd } from "@sheetal/backend-core/domain/money";
import { SHEETAL_METHOD } from "./categories.js";
import { rupeesOf } from "./money.js";

/** A payment on an invoice split in the invoice's own ratio: the part before VAT and the VAT (they add back to the payment). */
export function paymentSplit(amount: number, invoice: { subtotal: number; total: number }) {
  const net = invoice.total > 0 ? Math.round((amount * invoice.subtotal) / invoice.total) : amount;
  return { net, vat: amount - net };
}

/** The first and last day of a month (YYYY-MM), as YYYY-MM-DD. */
export function monthSpan(month: string) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return { first: `${month}-01`, last: ymd(new Date(Date.UTC(y, m, 0))) };
}
/** Every month from one to another, both included (YYYY-MM). */
export function monthsBetween(from: string, to: string) {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  while ((y < ty || (y === ty && m <= tm)) && out.length < 120) { out.push(`${y}-${String(m).padStart(2, "0")}`); if (++m > 12) { m = 1; y++; } }
  return out;
}

export interface ProfitRow { month: string; branchId: string; branch: string; direct: number; vat: number; payouts: number; commission: number; expenses: number; profit: number }

/** Profit by month and branch. branchIds null = every branch of the business. */
export async function profitRows(db: Db, o: { tenantId: string; branchIds: string[] | null; branchNames: Map<string, string>; from: string; to: string }): Promise<ProfitRow[]> {
  const first = dayOf(monthSpan(o.from).first), last = dayOf(monthSpan(o.to).last);
  const inBranch = o.branchIds ? { in: o.branchIds } : undefined;
  const [receipts, payouts, expenses, fees] = await Promise.all([
    db.bizReceipt.findMany({
      where: { tenantId: o.tenantId, paidOn: { gte: first, lte: last }, method: { not: SHEETAL_METHOD }, invoice: { kind: "invoice", ...(inBranch ? { branchId: inBranch } : {}) } },
      select: { amount: true, paidOn: true, invoice: { select: { branchId: true, subtotal: true, total: true } } }, take: 100_000,
    }),
    db.payout.findMany({ where: { tenantId: o.tenantId, status: "paid", paidOn: { gte: first, lte: last }, ...(inBranch ? { branchId: inBranch } : {}) }, select: { branchId: true, paidOn: true, net: true, fee: true, items: { where: { source: "rent" }, select: { net: true, fee: true } } }, take: 100_000 }),
    // A deleted expense (deletedAt set) never counts. The amount is read from paisa (rupees for a row the backfill has not reached).
    db.expense.findMany({ where: { tenantId: o.tenantId, status: "confirmed", deletedAt: null, spentOn: { gte: first, lte: last }, ...(inBranch ? { branchId: inBranch } : {}) }, select: { branchId: true, spentOn: true, amount: true, amountPaisa: true }, take: 100_000 }),
    // Rentals: rent belongs to the owner; only the agency's management fee, from saved owner statements, is income.
    db.ownerStatement.findMany({ where: { tenantId: o.tenantId, month: { gte: o.from, lte: o.to }, ...(inBranch ? { branchId: inBranch } : {}) }, select: { branchId: true, month: true, fee: true }, take: 100_000 }),
  ]);
  const rows = new Map<string, ProfitRow>();
  const at = (date: Date, branchId: string) => {
    const month = ymd(date).slice(0, 7);
    const key = `${month}|${branchId}`;
    let r = rows.get(key);
    if (!r) { r = { month, branchId, branch: o.branchNames.get(branchId) ?? "", direct: 0, vat: 0, payouts: 0, commission: 0, expenses: 0, profit: 0 }; rows.set(key, r); }
    return r;
  };
  for (const r of receipts) { const s = paymentSplit(r.amount, r.invoice); const row = at(r.paidOn, r.invoice.branchId); row.direct += s.net; row.vat += s.vat; }
  // Rent in a payout is the owner's money (the agency's income is its fee, from owner statements), so it is left out.
  for (const p of payouts) { const row = at(p.paidOn!, p.branchId); row.payouts += p.net - p.items.reduce((s, i) => s + i.net, 0); row.commission += p.fee - p.items.reduce((s, i) => s + i.fee, 0); }
  for (const e of expenses) at(e.spentOn, e.branchId).expenses += rupeesOf(e);
  for (const f of fees) at(dayOf(`${f.month}-01`), f.branchId).direct += f.fee;
  for (const r of rows.values()) r.profit = r.direct + r.payouts - r.expenses;
  return [...rows.values()].sort((a, b) => (a.month === b.month ? a.branch.localeCompare(b.branch) : b.month.localeCompare(a.month)));
}
