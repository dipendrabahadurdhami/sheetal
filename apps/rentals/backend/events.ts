// The events Rentals publishes: names and payloads, as listed in app.manifest.ts (events.publishes).
// Where it fits: the services publish them inside the write's transaction (BaseService.wrote / action); other apps may subscribe through their own manifest.
// How it works: one function per event builds its small JSON payload (ids, strings and PAISA amounts; never rupees, never secrets). The tables hold whole rupees,
// so each amount goes through Money.rupees() on the way out. The names are constants so a typo cannot publish an event the manifest does not list.
// Rules: payload fields are exactly the manifest's; change a payload only by adding a version (v: 2) in the manifest first.

import { Money } from "@sheetal/platform/core/money";
import type { BillRow, LeaseRow, OwnerRow, PaymentRow, RepairRow, StatementRow, UnitRow } from "./types.js";

export const RENT_EVENTS = {
  ownerCreated: "rentals.owner.created", ownerUpdated: "rentals.owner.updated", ownerDeleted: "rentals.owner.deleted",
  unitCreated: "rentals.unit.created", unitUpdated: "rentals.unit.updated", unitDeleted: "rentals.unit.deleted",
  leaseCreated: "rentals.lease.created", leaseUpdated: "rentals.lease.updated", leaseEnded: "rentals.lease.ended", depositReturned: "rentals.lease.deposit_returned",
  billCreated: "rentals.bill.created", billUpdated: "rentals.bill.updated", lateFeeAdded: "rentals.bill.late_fee_added", lateFeeWaived: "rentals.bill.late_fee_waived",
  paymentRecorded: "rentals.payment.recorded", paymentRemoved: "rentals.payment.removed", paymentConfirmed: "rentals.payment.confirmed", paymentRejected: "rentals.payment.rejected",
  repairCreated: "rentals.repair.created", repairUpdated: "rentals.repair.updated",
  statementSaved: "rentals.statement.saved", statementDeleted: "rentals.statement.deleted",
} as const;

/** Whole rupees from a table -> paisa for an event. */
export const paisa = (rupees: number): number => Money.rupees(rupees).paisa;
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export const ownerPayload = (o: OwnerRow) => ({ ownerId: o.id, branchId: o.branchId });
export const unitPayload = (u: UnitRow) => ({ unitId: u.id, ownerId: u.ownerId, branchId: u.branchId, rentPaisa: paisa(u.rent) });
export const leaseCreatedPayload = (l: LeaseRow) => ({ leaseId: l.id, unitId: l.unitId, branchId: l.branchId, rentPaisa: paisa(l.rent), depositPaisa: paisa(l.deposit), startOn: day(l.startOn), endOn: day(l.endOn) });
export const leaseUpdatedPayload = (l: LeaseRow, before: LeaseRow) => ({ leaseId: l.id, branchId: l.branchId, rentPaisa: paisa(l.rent), previousRentPaisa: paisa(before.rent), endOn: day(l.endOn) });
export const leaseEndedPayload = (l: LeaseRow) => ({ leaseId: l.id, unitId: l.unitId, branchId: l.branchId, endedOn: day(l.endedOn), depositReturnedPaisa: l.depositReturned === null ? null : paisa(l.depositReturned) });
export const depositPayload = (l: LeaseRow) => ({ leaseId: l.id, branchId: l.branchId, depositReturnedPaisa: paisa(l.depositReturned ?? 0), depositPaisa: paisa(l.deposit) });
export const billCreatedPayload = (b: { id: string; leaseId: string; month: string; amount: number; branchId: string }) => ({ billId: b.id, leaseId: b.leaseId, month: b.month, amountPaisa: paisa(b.amount), branchId: b.branchId });
export const billUpdatedPayload = (b: BillRow, before: BillRow) => ({ billId: b.id, leaseId: b.leaseId, branchId: b.branchId, amountPaisa: paisa(b.amount), previousAmountPaisa: paisa(before.amount) });
export const lateFeePayload = (b: { id: string; leaseId: string; branchId: string }, lateFee: number) => ({ billId: b.id, leaseId: b.leaseId, branchId: b.branchId, lateFeePaisa: paisa(lateFee) });
export const paymentPayload = (p: PaymentRow) => ({ paymentId: p.id, billId: p.billId, branchId: p.branchId, amountPaisa: paisa(p.amount), method: p.method });
export const paymentRejectedPayload = (p: PaymentRow) => ({ paymentId: p.id, billId: p.billId, branchId: p.branchId, amountPaisa: paisa(p.amount) });
export const repairPayload = (r: RepairRow) => ({ repairId: r.id, unitId: r.unitId, branchId: r.branchId, costPaisa: paisa(r.cost), status: r.status });
export const statementPayload = (s: StatementRow) => ({ statementId: s.id, ownerId: s.ownerId, branchId: s.branchId, month: s.month, collectedPaisa: paisa(s.collected), feePaisa: paisa(s.fee), repairsPaisa: paisa(s.repairs), payablePaisa: paisa(s.payable) });
