// Makes this month's rent bills and the late fees that are due: the background job, and the page when it opens.
// Where it fits: moved here from backend-core/src/domain/rentals.ts (P2-W1-S1); that file re-exports runRentBills. jobs.ts runs it every 6 hours; the Rentals page and
// a new lease run it for their own business.
// How it works: finds the active leases that run this month, adds ONE bill per lease and month (BillRepository.createIfMissing), then adds a late fee once to every bill
// that is still not fully paid the lease's set days after its due date. Safe to run again and again: one bill per lease and month, and a late fee is added once. When
// `events` is given, each new bill / late fee and its event ("rentals.bill.created" / "rentals.bill.late_fee_added") are written in ONE transaction of that business (a
// system context, no person); without it (an old caller, a test) the rows are added with no event.
// Rules: returns { bills, lateFees } (how many were added); tenantId limits it to one business. A failing business does not stop the others: the first error is thrown
// after all were tried, and the next run picks up where this one stopped (nothing is added twice).

import type { BusinessContext } from "@sheetal/platform/core/context";
import type { EventBus } from "@sheetal/platform/core/events";
import type { Db } from "@sheetal/platform/db/client";
import { BillRepository } from "./bill.repository.js";
import { billCreatedPayload, lateFeePayload, RENT_EVENTS } from "./events.js";
import { LeaseRepository, type RunningLease } from "./lease.repository.js";
import { addDays, dueDateOf, lateFeeOf } from "./rentals.js";
import { ymd } from "@sheetal/backend-core/domain/money";

/** What publishing an event needs: the bus, and a context of the business (acting as the system). */
export interface BillEvents { bus: EventBus; contextFor(tenantId: string): Promise<BusinessContext> }

export async function runRentBills(db: Db, o: { today: string; tenantId?: string; events?: BillEvents }): Promise<{ bills: number; lateFees: number }> {
  const month = o.today.slice(0, 7);
  const billsRepo = new BillRepository();
  const failures: unknown[] = [];
  const contexts = new Map<string, Promise<BusinessContext>>();
  const ctxOf = (events: BillEvents, tenantId: string) => { if (!contexts.has(tenantId)) contexts.set(tenantId, events.contextFor(tenantId)); return contexts.get(tenantId)!; };

  // ── This month's bill for every running lease, one business at a time ──
  const leases = await new LeaseRepository().runningIn(db, { month, tenantId: o.tenantId });
  const byBusiness = new Map<string, RunningLease[]>();
  for (const l of leases) byBusiness.set(l.tenantId, [...(byBusiness.get(l.tenantId) ?? []), l]);
  let bills = 0;
  for (const [tenantId, list] of byBusiness) {
    const make = async (tx: Parameters<BillRepository["createIfMissing"]>[0], publish: ((l: RunningLease, id: string) => Promise<void>) | null) => {
      let made = 0;
      for (const l of list) {
        const id = await billsRepo.createIfMissing(tx, { tenantId, branchId: l.branchId, leaseId: l.id, month, dueOn: dueDateOf(month, l.dueDay), amount: l.rent });
        if (!id) continue;
        made++;
        if (publish) await publish(l, id);
      }
      return made;
    };
    try {
      if (o.events) {
        const events = o.events;
        const ctx = await ctxOf(events, tenantId);
        bills += await ctx.transaction((tx) => make(tx.tx!, (l, id) => events.bus.publish(tx, RENT_EVENTS.billCreated, billCreatedPayload({ id, leaseId: l.id, month, amount: l.rent, branchId: l.branchId }), 1, { branchId: l.branchId })));
      } else {
        bills += await make(db, null);
      }
    } catch (e) { failures.push(e); }
  }

  // ── Late fees: once, on what is unpaid, when the bill is still not fully paid the given days after its due date ──
  let lateFees = 0;
  for (const b of await billsRepo.lateCandidates(db, { today: o.today, tenantId: o.tenantId })) {
    if (b.paid >= b.amount || b.lease.lateFeeBp <= 0) continue;
    if (addDays(ymd(b.dueOn), b.lease.lateAfterDays) >= o.today) continue;
    const fee = lateFeeOf(b.amount - b.paid, b.lease.lateFeeBp);
    if (fee <= 0) continue;
    try {
      if (o.events) {
        const events = o.events;
        const ctx = await ctxOf(events, b.tenantId);
        lateFees += await ctx.transaction(async (tx) => {
          // Only if nothing changed meanwhile (a payment, a waiver or another run).
          if (!(await billsRepo.addLateFee(tx.tx!, b.id, fee, b.paid))) return 0;
          await events.bus.publish(tx, RENT_EVENTS.lateFeeAdded, lateFeePayload(b, fee), 1, { branchId: b.branchId });
          return 1;
        });
      } else {
        lateFees += (await billsRepo.addLateFee(db, b.id, fee, b.paid)) ? 1 : 0;
      }
    } catch (e) { failures.push(e); }
  }

  if (failures.length) throw failures[0];
  return { bills, lateFees };
}
