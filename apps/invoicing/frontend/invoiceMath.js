// The invoice editor's preview sums and small helpers (copied from shared/src/demo/money.js in P2-W6, which only the website and the old import code use now).
// Where it fits: pages/InvoiceViews.jsx. The server works out the real totals, numbers and balances; these only preview a draft being typed.
// Rules: pure functions; VAT rounds to whole rupees as the server does.

/** Sub-total, VAT, total, paid and balance of an invoice's lines (credit notes are negative). */
export function totals(inv) {
  const sub = (inv.lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
  const vat = Math.round((sub * (Number(inv.vatPct) || 0)) / 100);
  const sign = inv.kind === "credit" ? -1 : 1;
  const paid = (inv.receipts || []).reduce((s, r) => s + r.amount, 0);
  const total = sign * (sub + vat);
  return { sub: sign * sub, vat: sign * vat, total, paid: sign * paid, balance: inv.kind === "credit" ? 0 : Math.max(0, total - paid) };
}

/** The next number with this prefix in the list ("INV-0007"). */
export const nextNo = (list, prefix) => prefix + String(Math.max(0, ...list.filter((x) => x.id.startsWith(prefix)).map((x) => Number(x.id.slice(prefix.length)) || 0)) + 1).padStart(4, "0");
/** "YYYY-MM-DD" plus n days. */
export const addDays = (s, n) => { const x = new Date(s + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
/** A row for the CSV export (keys match TEMPLATES.invoices in DataIO). */
export const invoiceRow = (inv) => { const t = totals(inv); return { ...inv, item: inv.lines.map((l) => (l.qty > 1 ? `${l.what} × ${l.qty}` : l.what)).join("; "), amount: t.sub, vat: inv.vatPct, paid: t.paid }; };
