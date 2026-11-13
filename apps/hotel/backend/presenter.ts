// How a booking is shown (the same JSON the Front desk, Bookings and Calendar pages read today, plus `version`) and the room bill sums.
// Where it fits: HotelService answers with these. Moved unchanged from business/backend/src/modules/hotel/routes.ts (P2-W4).
// Rules: nothing here reads the database. The room bill is the folio lines with the 10% service charge and 13% VAT on top (hotelBill), minus payments.

import type { Booking, FolioLine, GuestPayment, Room } from "@prisma/client";
import { hotelBill, nightsBetween, ymd } from "@sheetal/backend-core/domain/money";

export type Full = Booking & { room: Room | null; folio: FolioLine[]; payments: GuestPayment[]; branch?: { name: string } | null; version: number };

export const bookingCode = (b: Pick<Booking, "seq">) => `BK-${String(b.seq).padStart(4, "0")}`;
/** The room bill: folio lines (service charge and VAT on top), what was paid, and what is left. */
export function folioOf(b: Pick<Full, "folio" | "payments">) {
  const charges = b.folio.filter((l) => l.kind !== "discount").reduce((s, l) => s + l.amount, 0);
  const discount = -b.folio.filter((l) => l.kind === "discount").reduce((s, l) => s + l.amount, 0);
  const bill = hotelBill(charges, discount);
  const paid = b.payments.reduce((s, p) => s + p.amount, 0);
  return { ...bill, paid, due: bill.total - paid };
}
export const bookingJson = (b: Full) => ({
  id: b.id, code: bookingCode(b), status: b.status, source: b.source, guest: b.guestName, phone: b.phone, email: b.email, adults: b.adults, children: b.children,
  from: ymd(b.checkIn), to: ymd(b.checkOut), nights: nightsBetween(b.checkIn, b.checkOut), rate: b.rate, amount: b.rate * nightsBetween(b.checkIn, b.checkOut),
  type: b.roomType, roomId: b.roomId, room: b.room?.no ?? null, idChecked: b.idChecked, notes: b.notes, branchId: b.branchId, branch: b.branch?.name ?? null,
  folio: b.folio.map((l) => ({ id: l.id, kind: l.kind, what: l.what, qty: l.qty, amount: l.amount, at: l.createdAt })),
  payments: b.payments.map((p) => ({ id: p.id, method: p.method, amount: p.amount, ref: p.ref, at: p.createdAt })), bill: folioOf(b), version: b.version,
});
/** Most rooms of a type taken on any single night in [from, to). */
export const peak = (taken: { roomType: string; checkIn: Date; checkOut: Date }[], type: string, from: Date, to: Date) => {
  let most = 0;
  for (let d = from.getTime(); d < to.getTime(); d += 864e5) most = Math.max(most, taken.filter((t) => t.roomType === type && t.checkIn.getTime() <= d && t.checkOut.getTime() > d).length);
  return most;
};
