// How units and reservations are shown: the same JSON the Projects and Collections pages read today, plus `version`.
// Where it fits: ProjectService answers with these. Moved unchanged from business/backend/src/modules/projects/routes.ts (P2-W3).
// How it works: a hold that has passed its time counts as available (live()). A reservation's payment plan is matched against what was paid, oldest step first.
// Rules: money leaves as plain numbers (whole rupees); nothing here reads the database.

import type { ReservationFull, UnitRow } from "./types.js";

export const n = (v: bigint | number | null | undefined) => (v == null ? null : Number(v));
/** A hold that has passed its time counts as available. */
export const live = (u: Pick<UnitRow, "status" | "holdUntil">, now = new Date()) => (u.status === "held" && u.holdUntil && u.holdUntil < now ? "available" : u.status);
export const reservationNo = (seq: number) => `RS-${String(seq).padStart(4, "0")}`;

export const unitJson = (u: UnitRow) => ({ id: u.id, listingId: u.listingId, block: u.block, no: u.no, type: u.type, sizeSqft: u.sizeSqft, price: n(u.price), status: live(u), holdUntil: live(u) === "held" ? u.holdUntil : null, version: u.version });

export function paidOf(r: Pick<ReservationFull, "collections">): number { return r.collections.reduce((s, c) => s + Number(c.amount), 0); }

/** The plan steps with what each has received (oldest first), whether it is done, and whether it is overdue. */
export function planSteps(plan: unknown, paid: number, today = new Date().toISOString().slice(0, 10)) {
  const steps = (plan as { label: string; due: string; amount: number }[] | null) ?? [];
  let left = paid;
  return steps.map((p) => { const covered = Math.min(left, p.amount); left -= covered; return { ...p, paid: covered, done: covered >= p.amount, overdue: covered < p.amount && p.due < today }; });
}

export function reservationJson(r: ReservationFull) {
  const paid = paidOf(r);
  return {
    id: r.id, code: reservationNo(r.seq), status: r.status, buyer: r.buyerName, phone: r.phone, email: r.email, price: n(r.price), paid, due: Number(r.price) - paid,
    unit: unitJson(r.unit), plan: planSteps(r.plan, paid), collections: r.collections.map((c) => ({ id: c.id, amount: n(c.amount), method: c.method, ref: c.ref, note: c.note, at: c.createdAt })),
    createdAt: r.createdAt, version: r.version,
  };
}
