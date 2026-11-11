// How the Rentals page, a bill's payments and the owner statements look to the screen.
// Where it fits: the services build the answers with these; moved from the old routes file (P2-W1-S1). The JSON is the one the page already reads.
// How it works: money is whole rupees, dates are YYYY-MM-DD, empty text is "", a fee is shown in percent (feeBp / 100). Three fields are new and harmless: `version` on each
// row (the new screens send it back when saving, so a stale save is refused with 409) and `can` (what the person may do; the old `canManage` stays).
// Rules: no business logic. Never put a BigInt in the answer: JSON cannot carry it (these tables have no paisa columns yet, so none can arrive).

import { balanceOf, billNo, billStatus, leaseNo, repairNo } from "./rentals.js";
import type { StatementLine } from "./statement.repository.js";
import type { BillRow, LeaseRow, OwnerRow, PaymentRow, RepairRow, StatementRow, UnitRow } from "./types.js";
import type { ListingBrief } from "./unit.repository.js";

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export interface PageInput {
  today: string; canManage: boolean; methods: readonly string[]; kinds: readonly string[];
  owners: OwnerRow[]; units: UnitRow[]; leases: LeaseRow[]; bills: BillRow[]; repairs: RepairRow[]; pending: PaymentRow[]; pendingBills: BillRow[]; listings: ListingBrief[];
  branchNames: Map<string, string>;
  can: { create: boolean; update: boolean; delete: boolean };
}

export function presentPage(i: PageInput) {
  const br = i.branchNames;
  const owner = new Map(i.owners.map((o) => [o.id, o]));
  const unit = new Map(i.units.map((u) => [u.id, u]));
  const lease = new Map(i.leases.map((l) => [l.id, l]));
  const billOf = new Map(i.pendingBills.map((b) => [b.id, b]));
  const codes = new Map(i.listings.map((l) => [l.id, l.code]));
  const unitLabel = (id: string) => { const u = unit.get(id); return u ? `${u.property} · ${u.name}` : ""; };
  const active = new Map(i.leases.filter((l) => l.status === "active").map((l) => [l.unitId, l]));
  return {
    canManage: i.canManage, can: i.can, today: i.today, methods: i.methods, kinds: i.kinds,
    listings: i.listings.map((l) => ({ id: l.id, code: l.code, title: l.title })),
    pending: i.pending.map((p) => {
      const b = billOf.get(p.billId); const l = b ? lease.get(b.leaseId) : undefined;
      return { id: p.id, billId: p.billId, bill: b ? billNo(b.seq) : "", month: b?.month ?? "", renter: l?.renter ?? "", unit: l ? unitLabel(l.unitId) : "", amount: p.amount, method: p.method, ref: p.ref ?? "", paidOn: day(p.paidOn), to: p.collectedBy, hasProof: !!p.proofFile };
    }),
    owners: i.owners.map((o) => ({ id: o.id, name: o.name, phone: o.phone ?? "", email: o.email ?? "", feePct: o.feeBp / 100, bank: o.bank ?? "", note: o.note ?? "", branchId: o.branchId, branch: br.get(o.branchId) ?? "", units: i.units.filter((u) => u.ownerId === o.id).length, version: o.version })),
    units: i.units.map((u) => {
      const l = active.get(u.id);
      return {
        id: u.id, listingId: u.listingId, listing: u.listingId ? codes.get(u.listingId) ?? "" : "", ownerId: u.ownerId, owner: owner.get(u.ownerId)?.name ?? "", property: u.property, name: u.name, kind: u.kind, rent: u.rent, status: u.status,
        branchId: u.branchId, branch: br.get(u.branchId) ?? "", lease: l ? { id: l.id, no: leaseNo(l.seq), renter: l.renter, end: day(l.endOn) } : null,
        used: i.leases.some((x) => x.unitId === u.id) || i.repairs.some((r) => r.unitId === u.id), version: u.version,
      };
    }),
    leases: i.leases.map((l) => ({
      id: l.id, no: leaseNo(l.seq), unitId: l.unitId, unit: unitLabel(l.unitId), renter: l.renter, phone: l.phone ?? "", email: l.email ?? "", start: day(l.startOn), end: day(l.endOn),
      rent: l.rent, deposit: l.deposit, dueDay: l.dueDay, lateFeePct: l.lateFeeBp / 100, lateAfterDays: l.lateAfterDays, status: l.status, endedOn: day(l.endedOn),
      depositStatus: l.depositStatus, depositReturned: l.depositReturned, depositNote: l.depositNote ?? "", branch: br.get(l.branchId) ?? "", version: l.version,
    })),
    bills: i.bills.map((b) => {
      const l = lease.get(b.leaseId);
      return {
        id: b.id, no: billNo(b.seq), leaseId: b.leaseId, leaseNo: l ? leaseNo(l.seq) : "", renter: l?.renter ?? "", unit: l ? unitLabel(l.unitId) : "", month: b.month, due: day(b.dueOn),
        amount: b.amount, lateFee: b.lateFee, lateWaived: b.lateWaived, paid: b.paid, balance: balanceOf(b), status: billStatus(b, i.today), branch: br.get(b.branchId) ?? "", version: b.version,
      };
    }),
    repairs: i.repairs.map((r) => ({
      id: r.id, no: repairNo(r.seq), unitId: r.unitId, unit: unitLabel(r.unitId), owner: owner.get(unit.get(r.unitId)?.ownerId ?? "")?.name ?? "", title: r.title, priority: r.priority,
      vendor: r.vendor ?? "", cost: r.cost, status: r.status, doneOn: day(r.doneOn), created: day(r.createdAt), version: r.version,
    })),
  };
}

/** The payments of one bill, as the bill's detail shows them. */
export const presentPayments = (rows: PaymentRow[]) => ({
  payments: rows.map((p) => ({ id: p.id, amount: p.amount, method: p.method, paidOn: day(p.paidOn), ref: p.ref ?? "", note: p.note ?? "", status: p.status, online: p.source === "online", to: p.collectedBy, version: p.version })),
});

/** One month of owner statements: the numbers worked out now, and the statement saved (if any) with whether it still matches. */
export function presentStatements(i: { month: string; canManage: boolean; owners: OwnerRow[]; lines: Map<string, StatementLine>; saved: StatementRow[] }) {
  const kept = new Map(i.saved.map((s) => [s.ownerId, s]));
  return {
    month: i.month, canManage: i.canManage,
    rows: i.owners.map((o) => {
      const s = i.lines.get(o.id)!; const k = kept.get(o.id);
      return {
        ...s, owner: o.name, bank: o.bank ?? "", feePct: o.feeBp / 100,
        saved: k ? { id: k.id, collected: k.collected, fee: k.fee, repairs: k.repairs, payable: k.payable, at: k.updatedAt.toISOString(), current: k.collected === s.collected && k.fee === s.fee && k.repairs === s.repairs, version: k.version } : null,
      };
    }),
  };
}
