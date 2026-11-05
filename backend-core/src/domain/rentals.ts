// Rentals: homes and shops an agency manages for owners (landlords), their leases, monthly rent bills, rent payments,
// repairs and owner statements.
// Where it fits: the business API's rentals module (business/backend/src/modules/rentals) uses it; runRentBills() is
// run by a background job and when the Rentals page opens.
// How it works: an active lease gets one bill per month (amount = the lease's rent, due on its due day). A bill that
// is still not fully paid some days after its due date gets a late fee once, on the unpaid balance. Payments are
// recorded by staff against a bill. An owner statement for a month = rent collected for the owner's units − the
// agency's management fee − repairs done for those units; saving it counts the fee in the agency's profit.
// Rules: rent belongs to the owner, so it is never the agency's income; only the management fee is. A deposit is
// held and returned, never income. Whole rupees; months are YYYY-MM and days are Nepal dates (nepalDay()).

import type { Db } from "../lib/db.js";
import { dayOf, ymd } from "./money.js";

export const RENT_METHODS = ["cash", "bank", "esewa", "khalti", "fonepay", "cheque", "other"] as const;
export const UNIT_KINDS = ["Flat", "Room", "1 BHK", "2 BHK", "3 BHK", "House", "Shop", "Office", "Other"] as const;
export const MAX_RENT = 100_000_000;

const pad4 = (n: number) => String(n).padStart(4, "0");
/** LS-0007: the lease code (later shown to renters for paying online). */
export const leaseNo = (seq: number) => `LS-${pad4(seq)}`;
export const billNo = (seq: number) => `RB-${pad4(seq)}`;
export const repairNo = (seq: number) => `WO-${pad4(seq)}`;

/** What is still owed on a bill, late fee included. */
export const balanceOf = (b: { amount: number; lateFee: number; paid: number }) => Math.max(0, b.amount + b.lateFee - b.paid);

/** paid, overdue (past the due day and not fully paid), partial or due. */
export function billStatus(b: { amount: number; lateFee: number; paid: number; dueOn: Date }, today: string) {
  if (b.paid >= b.amount + b.lateFee) return "paid";
  if (ymd(b.dueOn) < today) return "overdue";
  return b.paid > 0 ? "partial" : "due";
}

export const addDays = (day: string, n: number) => { const d = dayOf(day); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
/** The last day of a month (YYYY-MM) as YYYY-MM-DD. */
export const lastDayOf = (month: string) => { const [y, m] = month.split("-").map(Number) as [number, number]; return ymd(new Date(Date.UTC(y, m, 0))); };
/** The due date of a month's bill: the lease's due day (1 to 28). */
export const dueDateOf = (month: string, dueDay: number) => `${month}-${String(Math.min(28, Math.max(1, dueDay))).padStart(2, "0")}`;
/** A late fee: a share of the unpaid rent, in hundredths of a percent (200 = 2%). */
export const lateFeeOf = (unpaid: number, bp: number) => Math.round((Math.max(0, unpaid) * bp) / 10_000);
/** The management fee on rent collected, in hundredths of a percent (800 = 8%). */
export const feeOf = (collected: number, bp: number) => Math.round((collected * bp) / 10_000);

/** Whether a lease runs in a month (it started on or before the month's last day and ends on or after its first). */
export const leaseCovers = (l: { startOn: Date; endOn: Date }, month: string) => ymd(l.startOn) <= lastDayOf(month) && ymd(l.endOn) >= `${month}-01`;

/** Makes this month's bill for every active lease that runs this month, and adds the late fees that are due.
 *  Safe to run again and again: one bill per lease and month, and a late fee is added once. tenantId limits it to one
 *  business. */
export async function runRentBills(db: Db, o: { today: string; tenantId?: string }): Promise<{ bills: number; lateFees: number }> {
  const month = o.today.slice(0, 7);
  const one = o.tenantId ? { tenantId: o.tenantId } : {};
  const leases = await db.rentLease.findMany({
    where: { ...one, status: "active", startOn: { lte: dayOf(lastDayOf(month)) }, endOn: { gte: dayOf(`${month}-01`) } },
    select: { id: true, tenantId: true, branchId: true, rent: true, dueDay: true },
  });
  let bills = 0;
  if (leases.length) {
    const made = await db.rentBill.createMany({
      data: leases.map((l) => ({ tenantId: l.tenantId, branchId: l.branchId, leaseId: l.id, month, dueOn: dayOf(dueDateOf(month, l.dueDay)), amount: l.rent })),
      skipDuplicates: true,
    });
    bills = made.count;
  }
  // Late fees: once, on what is unpaid, when the bill is still not fully paid the given days after its due date.
  const late = await db.rentBill.findMany({
    where: { ...one, lateFee: 0, lateWaived: false, dueOn: { lt: dayOf(o.today) } },
    select: { id: true, amount: true, paid: true, dueOn: true, lease: { select: { lateFeeBp: true, lateAfterDays: true } } },
    take: 5000,
  });
  let lateFees = 0;
  for (const b of late) {
    if (b.paid >= b.amount || b.lease.lateFeeBp <= 0) continue;
    if (addDays(ymd(b.dueOn), b.lease.lateAfterDays) >= o.today) continue;
    const fee = lateFeeOf(b.amount - b.paid, b.lease.lateFeeBp);
    if (fee <= 0) continue;
    // Only if nothing changed meanwhile (a payment, a waiver or another run).
    const done = await db.rentBill.updateMany({ where: { id: b.id, lateFee: 0, lateWaived: false, paid: b.paid }, data: { lateFee: fee } });
    lateFees += done.count;
  }
  return { bills, lateFees };
}

export interface StatementLine { ownerId: string; collected: number; fee: number; repairs: number; payable: number }

/** The statement numbers of these owners for a month: rent collected (payments made that month for their units),
 *  the management fee, repairs done that month for their units, and what is owed to each owner. */
export async function statementsFor(db: Db, o: { tenantId: string; month: string; owners: { id: string; feeBp: number }[] }): Promise<Map<string, StatementLine>> {
  const first = dayOf(`${o.month}-01`), last = dayOf(lastDayOf(o.month));
  const ids = o.owners.map((x) => x.id);
  const [payments, repairs] = await Promise.all([
    db.rentPayment.findMany({ where: { tenantId: o.tenantId, status: "confirmed", paidOn: { gte: first, lte: last }, bill: { lease: { unit: { ownerId: { in: ids } } } } }, select: { amount: true, bill: { select: { lease: { select: { unit: { select: { ownerId: true } } } } } } }, take: 50_000 }),
    db.rentRepair.findMany({ where: { tenantId: o.tenantId, status: "done", doneOn: { gte: first, lte: last }, unit: { ownerId: { in: ids } } }, select: { cost: true, unit: { select: { ownerId: true } } }, take: 50_000 }),
  ]);
  const out = new Map<string, StatementLine>(o.owners.map((x) => [x.id, { ownerId: x.id, collected: 0, fee: 0, repairs: 0, payable: 0 }]));
  for (const p of payments) out.get(p.bill.lease.unit.ownerId)!.collected += p.amount;
  for (const r of repairs) out.get(r.unit.ownerId)!.repairs += r.cost;
  for (const x of o.owners) { const s = out.get(x.id)!; s.fee = feeOf(s.collected, x.feeBp); s.payable = s.collected - s.fee - s.repairs; }
  return out;
}
