// Expenses and profit: what a business spent, recurring expenses, and the money-in minus money-out view.
// Where it fits: the business API's expenses module (business/backend/src/modules/expenses) uses it; the daily job
// generateDueExpenses() adds recurring expenses as drafts.
// How it works: an expense is confirmed (counts in profit), a draft (made by a recurring expense, waiting for the
// business to confirm it) or skipped (a dismissed draft, kept so the month is never added twice). Profit by month and
// branch = money received directly + payouts from Sheetal − confirmed expenses. Direct money is what the business
// received itself (invoice payments, without VAT, counted in the month they were paid); money Sheetal collected
// reaches the business through a payout, so a payment with method "sheetal" is left out and the payout (its net,
// in the month it was paid) is counted instead. VAT collected and Sheetal's commission are shown for information
// only: VAT is owed to the government, and the commission is already taken off the payout.
// Rules: whole rupees; months are calendar months in Nepal time (use nepalDay()); expenses count by their expense
// date, invoice payments by their paid date, payouts by their paid date; only confirmed expenses count.

import type { Db } from "../lib/db.js";
import { notify, teamWith } from "../lib/notify.js";
import { dayOf, ymd } from "./money.js";

export const EXPENSE_METHODS = ["cash", "bank", "fonepay", "esewa", "khalti", "card", "other"] as const;
export const MAX_EXPENSE = 2_000_000_000;
/** The payment method of money Sheetal collected for the business (set by the system; never typed by a person). */
export const SHEETAL_METHOD = "sheetal";

export interface ExpenseCategory { id: string; en: string; ne: string; icon?: string }
/** The built-in list, in step with `expenseCategories` in shared/src/data/catalog.js. Staff can change it in Admin →
 *  Listing setup (stored in the "catalog" app setting). */
export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  { id: "salaries", en: "Salaries", ne: "तलब", icon: "users" },
  { id: "rent", en: "Rent", ne: "भाडा", icon: "key-round" },
  { id: "utilities", en: "Utilities", ne: "बिजुली, पानी र इन्टरनेट", icon: "zap" },
  { id: "repairs", en: "Repairs and maintenance", ne: "मर्मत सम्भार", icon: "wrench" },
  { id: "marketing", en: "Marketing", ne: "मार्केटिङ", icon: "megaphone" },
  { id: "supplies", en: "Supplies", ne: "सामग्री", icon: "shopping-bag" },
  { id: "travel", en: "Fuel and travel", ne: "इन्धन र यात्रा", icon: "car" },
  { id: "commissions", en: "Commissions", ne: "कमिसन", icon: "hand-coins" },
  { id: "taxes", en: "Taxes and fees", ne: "कर र शुल्क", icon: "receipt" },
  { id: "other", en: "Other", ne: "अन्य", icon: "circle-check" },
];

/** The categories now: the list staff saved, or the built-in one. */
export async function expenseCategories(db: Db): Promise<ExpenseCategory[]> {
  const stored = ((await db.appSetting.findUnique({ where: { key: "catalog" } }))?.value as { lists?: Record<string, unknown> } | null)?.lists?.expenseCategories;
  if (!Array.isArray(stored) || !stored.length) return EXPENSE_CATEGORIES;
  return stored.filter((c): c is ExpenseCategory => !!c && typeof c === "object" && typeof (c as ExpenseCategory).id === "string").map((c) => ({ id: c.id, en: String(c.en ?? c.id), ne: String(c.ne ?? c.en ?? c.id), icon: c.icon }));
}

/** EX-0007 */
export const expenseNo = (seq: number) => `EX-${String(seq).padStart(4, "0")}`;

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
  const [receipts, payouts, expenses] = await Promise.all([
    db.bizReceipt.findMany({
      where: { tenantId: o.tenantId, paidOn: { gte: first, lte: last }, method: { not: SHEETAL_METHOD }, invoice: { kind: "invoice", ...(inBranch ? { branchId: inBranch } : {}) } },
      select: { amount: true, paidOn: true, invoice: { select: { branchId: true, subtotal: true, total: true } } }, take: 100_000,
    }),
    db.payout.findMany({ where: { tenantId: o.tenantId, status: "paid", paidOn: { gte: first, lte: last }, ...(inBranch ? { branchId: inBranch } : {}) }, select: { branchId: true, paidOn: true, net: true, fee: true }, take: 100_000 }),
    db.expense.findMany({ where: { tenantId: o.tenantId, status: "confirmed", spentOn: { gte: first, lte: last }, ...(inBranch ? { branchId: inBranch } : {}) }, select: { branchId: true, spentOn: true, amount: true }, take: 100_000 }),
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
  for (const p of payouts) { const row = at(p.paidOn!, p.branchId); row.payouts += p.net; row.commission += p.fee; }
  for (const e of expenses) at(e.spentOn, e.branchId).expenses += e.amount;
  for (const r of rows.values()) r.profit = r.direct + r.payouts - r.expenses;
  return [...rows.values()].sort((a, b) => (a.month === b.month ? a.branch.localeCompare(b.branch) : b.month.localeCompare(a.month)));
}

/** Adds this month's draft for every active recurring expense that has reached its day. Safe to run again and again:
 *  one draft per recurring expense and month, whatever happens (a dismissed draft stays as "skipped"). Returns how many
 *  drafts were added. tenantId limits it to one business. */
export async function generateDueExpenses(db: Db, o: { today: string; tenantId?: string }): Promise<number> {
  const month = o.today.slice(0, 7);
  const dueDay = Number(o.today.slice(8, 10));
  const templates = await db.recurringExpense.findMany({ where: { status: "active", startMonth: { lte: month }, dayOfMonth: { lte: dueDay }, ...(o.tenantId ? { tenantId: o.tenantId } : {}) } });
  const added = new Map<string, number>();
  for (const t of templates) {
    const made = await db.expense.createMany({
      data: [{ tenantId: t.tenantId, branchId: t.branchId, status: "draft", spentOn: dayOf(`${month}-${String(t.dayOfMonth).padStart(2, "0")}`), category: t.category, amount: t.amount, vendor: t.vendor, note: t.note, method: t.method, recurringId: t.id, forMonth: month, createdBy: t.createdBy }],
      skipDuplicates: true,
    });
    if (made.count) added.set(t.tenantId, (added.get(t.tenantId) ?? 0) + made.count);
  }
  for (const [tenantId, n] of added) {
    await notify(db, await teamWith(db, tenantId, ["expenses.manage"]), { type: "expense", title: `${n} recurring expense${n > 1 ? "s" : ""} to confirm`, message: "Check the amount and confirm it, so it counts in your profit.", link: "/business/expenses", tenantId }).catch(() => {});
  }
  return [...added.values()].reduce((a, b) => a + b, 0);
}
