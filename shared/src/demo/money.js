// Invoices a business sends its own customers: drafts, sent invoices, credit notes and receipts.
// Lives in db.money[tenantId].invoices. Workspaces without their own list start from this sample.
import { TODAY } from "../core/format";

const DAY = TODAY.slice(0, 10);
const L = (what, qty, rate) => ({ what, qty, rate });
const R = (id, at, amount, method) => ({ id, at, amount, method });
const SEED = [
  { id: "INV-0413", kind: "invoice", to: "Rajesh Koirala", phone: "984-1203344", pan: "", order: "", date: DAY, due: "2027-03-12", vatPct: 13, status: "draft", lines: [L("Room night, Deluxe garden", 2, 6500), L("Airport pickup", 1, 1200)], receipts: [] },
  { id: "INV-0412", kind: "invoice", to: "Sita Gurung", phone: "984-1010101", pan: "", order: "BK-2027-0418", date: "2027-03-02", due: "2027-03-12", vatPct: 13, status: "sent", lines: [L("Room 201, Deluxe lake view", 3, 14667)], receipts: [R("RC-0291", "2027-03-02", 14916, "Fonepay")] },
  { id: "INV-0411", kind: "invoice", to: "Lin Chen", phone: "+86 138 0013 8000", pan: "", order: "BK-2027-0411", date: "2027-03-01", due: "2027-03-01", vatPct: 13, status: "sent", lines: [L("Room 207, Deluxe garden", 3, 6903)], receipts: [R("RC-0288", "2027-03-01", 23401, "Card")] },
  { id: "INV-0409", kind: "invoice", to: "Marco Rossi (company)", phone: "", pan: "609912345", order: "BK-2027-0405", date: "2027-02-26", due: "2027-03-01", vatPct: 13, status: "sent", lines: [L("Corporate stay, 4 nights", 4, 8407)], receipts: [] },
  { id: "INV-0402", kind: "invoice", to: "Eva Novak", phone: "+420 601 123 456", pan: "", order: "BK-2027-0402", date: "2027-02-27", due: "2027-02-27", vatPct: 13, status: "sent", lines: [L("Room 204, Deluxe lake view", 3, 6478)], receipts: [R("RC-0279", "2027-02-27", 21960, "eSewa")] },
  { id: "INV-0391", kind: "invoice", to: "Priya Sharma", phone: "+91 98100 12345", pan: "", order: "BK-2027-0391", date: "2027-02-20", due: "2027-02-20", vatPct: 13, status: "sent", lines: [L("Room 205, Deluxe lake view", 2, 13806)], receipts: [R("RC-0262", "2027-02-20", 31201, "Card")] },
  { id: "CN-0007", kind: "credit", creditFor: "INV-0391", reason: "Booking cancelled within the free cancellation period", to: "Priya Sharma", phone: "+91 98100 12345", pan: "", order: "BK-2027-0391", date: "2027-02-24", due: "2027-02-24", vatPct: 13, status: "sent", lines: [L("Refund for cancelled booking BK-2027-0391", 1, 27612)], receipts: [] },
];

export const invoicesOf = (db, tid) => db.money?.[tid]?.invoices || structuredClone(SEED);

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
