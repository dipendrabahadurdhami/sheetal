// Hotel and restaurant bill maths, and date helpers for stays.
// Where it fits: used by bookings, the room bill (folio) and point of sale.
// How it works: 10% service charge on the amount after discount, then 13% VAT on that plus the service charge, in
// whole rupees. Dates are whole days at midnight UTC.
// Rules: the POS screens in shared/src use the same rule; change both together.

export const SERVICE_RATE = 0.1;
export const VAT_RATE = 0.13;

export function hotelBill(subtotal: number, discount = 0) {
  const base = Math.max(0, subtotal - discount);
  const service = Math.round(base * SERVICE_RATE);
  const vat = Math.round((base + service) * VAT_RATE);
  return { subtotal, discount, service, vat, total: base + service + vat };
}

/** Whole nights between two dates (check-in day to check-out day). */
export const nightsBetween = (from: Date, to: Date) => Math.round((Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) - Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())) / 864e5);

/** A YYYY-MM-DD date as midnight UTC. */
export const dayOf = (s: string) => new Date(`${s}T00:00:00.000Z`);
export const ymd = (d: Date) => d.toISOString().slice(0, 10);

// ───── Customer invoices (a business's own bills to its customers) ─────

export const INVOICE_VAT = 13;
export interface InvoiceLine { what: string; qty: number; rate: number }

/** Subtotal, VAT and total of an invoice, in whole rupees: VAT is the percent of the subtotal, rounded. */
export function invoiceAmounts(lines: readonly InvoiceLine[], vatPct: number) {
  const sub = lines.reduce((s, l) => s + l.qty * l.rate, 0);
  const vat = Math.round((sub * vatPct) / 100);
  return { sub, vat, total: sub + vat };
}

/** A credit that includes VAT, split into the amount before VAT and the VAT (they always add back to the credit). */
export function creditSplit(gross: number, vatPct: number) {
  const net = Math.round(gross / (1 + vatPct / 100));
  return { net, vat: gross - net, total: gross };
}

/** Nepal's fiscal year runs from Shrawan 1 (about 17 July) to the end of Asar, named by the Bikram Sambat years it
 *  spans: 17 July 2026 to 16 July 2027 is "2083-84". Shrawan 1 can fall on the 16th or 17th: the table below holds
 *  the year it differs, and must be checked against the official calendar before each new fiscal year. */
const SHRAWAN_1: Record<number, string> = { 2025: "07-17", 2026: "07-17", 2027: "07-17", 2028: "07-16" };
export function fiscalYearOf(d: Date) {
  // In Nepal time (P3-BE-4 fix): 00:30 on Shrawan 1 in Nepal is 18:45 UTC the day before and already belongs to the new year.
  d = new Date(d.getTime() + (5 * 60 + 45) * 60_000);
  const y = d.getUTCFullYear();
  const start = Date.UTC(y, Number((SHRAWAN_1[y] ?? "07-17").slice(0, 2)) - 1, Number((SHRAWAN_1[y] ?? "07-17").slice(3)));
  const bs = (d.getTime() >= start ? y : y - 1) + 57;
  return `${bs}-${String((bs + 1) % 100).padStart(2, "0")}`;
}

/** INV-2083-84-0001 */
export const docNo = (prefix: string, fy: string, n: number) => `${prefix}-${fy}-${String(n).padStart(4, "0")}`;
