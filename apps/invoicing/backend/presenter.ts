// How an invoice is shown: the same JSON the Customer invoices page (LiveMoney.jsx) reads today, plus `version`.
// Where it fits: InvoiceService answers with these. Moved unchanged from business/backend/src/modules/invoicing/routes.ts (P2-W3).
// How it works: a credit note's amounts are sent negative; the balance of a credit note or a cancelled invoice is 0; a draft is labelled DRAFT-0001.
// Rules: nothing here reads the database (the names of the invoices a credit note is for are passed in).

import type { InvoiceLine } from "@sheetal/backend-core/domain/money";
import type { Full } from "./types.js";

export const label = (i: { no: string | null; seq: number }) => i.no ?? `DRAFT-${String(i.seq).padStart(4, "0")}`;
export const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
export const rupees = (n: number) => `Rs. ${n.toLocaleString("en-IN")}`;
/** A booking's code, the same as the Hotel app's (BK-0001); a test checks the two never differ. */
export const bookingCode = (b: { seq: number }) => `BK-${String(b.seq).padStart(4, "0")}`;

export function present(i: Full, names: Map<string, string>) {
  const credit = i.kind === "credit";
  const sign = credit ? -1 : 1;
  const paid = i.receipts.reduce((s, r) => s + r.amount, 0);
  return {
    id: i.id, no: i.no, label: label(i), kind: i.kind, status: i.status, to: i.toName, phone: i.toPhone ?? "", pan: i.toPan ?? "",
    order: i.order ?? "", bookingId: i.bookingId, date: day(i.issuedOn)!, due: day(i.dueOn)!, vatPct: i.vatPct, lines: i.lines as unknown as InvoiceLine[],
    notes: i.notes ?? "", reason: i.reason ?? "", creditFor: i.creditForId ? names.get(i.creditForId) ?? null : null, creditForId: i.creditForId, branchId: i.branchId,
    cancelReason: i.cancelReason ?? "", cancelledOn: day(i.cancelledAt), sentOn: day(i.sentAt), version: i.version,
    t: { sub: sign * i.subtotal, vat: sign * i.vat, total: sign * i.total, paid: credit ? 0 : paid, balance: credit || i.status === "cancelled" ? 0 : Math.max(0, i.total - paid) },
    receipts: i.receipts.map((r) => ({ id: r.id, no: r.no, at: day(r.paidOn)!, amount: r.amount, method: r.method, note: r.note ?? "" })),
  };
}

/** One row of the Export button (same columns as the Import template). */
export const exportRow = (i: Full) => ({ to: i.toName, phone: i.toPhone ?? "", pan: i.toPan ?? "", date: day(i.issuedOn), item: (i.lines as unknown as InvoiceLine[]).map((l) => (l.qty > 1 ? `${l.what} × ${l.qty}` : l.what)).join("; "), amount: i.subtotal, vat: i.vatPct, paid: i.receipts.reduce((x, r) => x + r.amount, 0) });
