// Sample customer invoices (drafts, sent invoices, credit notes, receipts) for the business panel.
// Where it fits: Customer invoices (sample data for now, marked Preview).

import { TODAY } from "../core/format";

const DAY = TODAY.slice(0, 10);
const L = (what, qty, rate) => ({ what, qty, rate });
const R = (id, at, amount, method) => ({ id, at, amount, method });
export const invoicesOf = (db, tid) => db.money?.[tid]?.invoices || [];

export function totals(inv) {
  const sub = (inv.lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
  const vat = Math.round((sub * (Number(inv.vatPct) || 0)) / 100);
  const sign = inv.kind === "credit" ? -1 : 1;
  const paid = (inv.receipts || []).reduce((s, r) => s + r.amount, 0);
  const total = sign * (sub + vat);
  return { sub: sign * sub, vat: sign * vat, total, paid: sign * paid, balance: inv.kind === "credit" ? 0 : Math.max(0, total - paid) };
}

// draft | cancelled | credit | paid | partly | overdue | unpaid
export function statusOf(inv) {
  if (inv.status === "cancelled") return "cancelled";
  if (inv.status === "draft") return "draft";
  if (inv.kind === "credit") return "credit";
  const t = totals(inv);
  if (t.paid >= t.total) return "paid";
  if (inv.due < DAY) return "overdue";
  return t.paid > 0 ? "partly" : "unpaid";
}

export const nextNo = (list, prefix) => prefix + String(Math.max(0, ...list.filter((x) => x.id.startsWith(prefix)).map((x) => Number(x.id.slice(prefix.length)) || 0)) + 1).padStart(4, "0");
const addDays = (s, n) => { const x = new Date(s + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// Rows for CSV export/import (keys match TEMPLATES.invoices in DataIO)
export const invoiceRow = (inv) => { const t = totals(inv); return { ...inv, item: inv.lines.map((l) => (l.qty > 1 ? `${l.what} × ${l.qty}` : l.what)).join("; "), amount: t.sub, vat: inv.vatPct, paid: t.paid }; };
export const invoiceFromRow = (r, list) => ({
  id: nextNo(list, "INV-"), kind: "invoice", to: r.to, phone: r.phone || "", pan: r.pan || "", order: "", date: r.date, due: addDays(r.date, 10),
  vatPct: r.vat === "" || r.vat === undefined ? 13 : r.vat, status: "sent", lines: [L(r.item, 1, r.amount)],
  receipts: r.paid ? [R(nextNo(list.flatMap((x) => x.receipts || []), "RC-"), r.date, r.paid, "Imported")] : [],
});
export { addDays };
