// Bills at hotels and restaurants in Nepal: 10% service charge on the amount after discount, then 13% VAT on
// that plus the service charge. Whole rupees. (shared/src core POS screens use the same rule.)

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
