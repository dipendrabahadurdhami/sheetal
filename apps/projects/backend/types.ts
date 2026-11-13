// The Projects rows as the repositories hand them out: Unit, Reservation and Collection (a payment on a reservation), with the kernel columns.
// Where it fits: the type parameters of the repositories and the services. Money is whole rupees in BigInt columns, as before.
// Rules: types only. None of these tables has a branch: a row follows the branch of its project listing (see repositories.ts).

import type { BusinessEntity } from "@sheetal/platform/core/repository";

export interface UnitRow extends BusinessEntity {
  listingId: number; block: string; no: string; type: string; sizeSqft: number | null; price: bigint; status: string; holdUntil: Date | null;
}
export interface CollectionRow extends BusinessEntity {
  reservationId: string; amount: bigint; method: string; ref: string | null; note: string | null; byUserId: string | null;
}
export interface ReservationRow extends BusinessEntity {
  seq: number; unitId: string; buyerName: string; phone: string | null; email: string | null; price: bigint; plan: unknown; notes: string | null; status: string;
}
export type ReservationFull = ReservationRow & { unit: UnitRow; collections: CollectionRow[] };
