// The only code that reads and writes the rent_bills table (one bill per lease and month).
// Where it fits: BillService, PaymentService, OverviewService and the bill generator (bills.ts) call it.
// How it works: a RentalRepository on model "rentBill". Named methods, all compare-and-set so a double click or two people at once change a bill once:
// `createIfMissing` (the unique key is lease + month), `addPaid` / `removePaid` (move `paid` only if it is still what the caller saw, or still has room),
// `lateCandidates` + `addLateFee` (the late-fee pass reads bills of every business, like the job always did). A bill is never deleted.
// Rules: `paid` only ever changes through addPaid / removePaid, which refuse to go below zero or above what is owed. The amount changes only while paid is 0
// (BillService uses transition with { paid: 0 }).

import type { BusinessContext, DataScope, Tx } from "@sheetal/platform/core/context";
import type { Db } from "@sheetal/platform/db/client";
import { dayOf } from "@sheetal/backend-core/domain/money";
import { RentalRepository, rawOf } from "./rental.repository.js";
import type { BillRow, Change, NewRow } from "./types.js";

export type BillCreate = NewRow<BillRow, "lateFee" | "lateWaived" | "paid">;
export type BillChange = Change<BillRow>;

export interface LateCandidate { id: string; tenantId: string; branchId: string; leaseId: string; amount: number; paid: number; dueOn: Date; lease: { lateFeeBp: number; lateAfterDays: number } }

export class BillRepository extends RentalRepository<BillRow, BillCreate, BillChange> {
  constructor() {
    super({
      model: "rentBill", ownerField: null, label: "This bill",
      filterable: { branchId: ["eq", "in"], leaseId: ["eq", "in"], month: ["eq", "in"] },
      sortable: ["month", "seq", "dueOn", "createdAt"],
      defaultSort: [{ field: "month", dir: "desc" }, { field: "seq", dir: "desc" }],   // the order the page has today
      legacyMaxRows: 3000,                                                              // the page showed up to 3000 bills
    }, "Bill not found.");
  }

  /** Bills by id, inside the person's scope (the waiting online payments name their bill). */
  async byIds(ctx: BusinessContext, scope: DataScope, ids: readonly string[]): Promise<BillRow[]> {
    if (!ids.length) return [];
    const where = { AND: [await this.scopeWhere(ctx, scope), { id: { in: [...ids] } }] };
    return (await this.raw(ctx).findMany({ where })) as BillRow[];
  }

  /** Adds `amount` to `paid` only if the bill is in scope AND `paid` is still `paidIs` (a payment recorded by staff), or still at most `paidAtMost` (a confirmed online
   *  payment, so it never pays more than is owed). Returns whether it was added. */
  addPaid(ctx: BusinessContext, id: string, scope: DataScope, amount: number, guard: { paidIs: number } | { paidAtMost: number }): Promise<boolean> {
    return this.guardedUpdate(ctx, id, scope, "paidIs" in guard ? { paid: guard.paidIs } : { paid: { lte: guard.paidAtMost } }, { paid: { increment: amount } });
  }
  /** Takes `amount` off `paid` only if there is that much paid (removing a confirmed payment). */
  removePaid(ctx: BusinessContext, id: string, scope: DataScope, amount: number): Promise<boolean> {
    return this.guardedUpdate(ctx, id, scope, { paid: { gte: amount } }, { paid: { decrement: amount } });
  }

  /** One bill per lease and month (unique key). Returns the new bill's id, or null when that month already has one. Takes the database or a transaction because the
   *  generator has no request. */
  async createIfMissing(db: Db | Tx, b: { tenantId: string; branchId: string; leaseId: string; month: string; dueOn: string; amount: number; createdBy?: string | null }): Promise<string | null> {
    const raw = rawOf(db, "rentBill");
    const made = await raw.createMany({
      data: [{ tenantId: b.tenantId, branchId: b.branchId, leaseId: b.leaseId, month: b.month, dueOn: dayOf(b.dueOn), amount: b.amount, createdBy: b.createdBy ?? null, updatedBy: b.createdBy ?? null, version: 1 }],
      skipDuplicates: true,
    });
    if (!made.count) return null;
    return ((await raw.findFirst({ where: { leaseId: b.leaseId, month: b.month }, select: { id: true } })) as { id: string } | null)?.id ?? null;
  }

  /** Unpaid, not-yet-fined bills past their due date, with their lease's late-fee terms (up to 5000, as before). tenantId limits it to one business. */
  async lateCandidates(db: Db, o: { today: string; tenantId?: string }): Promise<LateCandidate[]> {
    return db.rentBill.findMany({
      where: { ...(o.tenantId ? { tenantId: o.tenantId } : {}), lateFee: 0, lateWaived: false, deletedAt: null, dueOn: { lt: dayOf(o.today) } },
      select: { id: true, tenantId: true, branchId: true, leaseId: true, amount: true, paid: true, dueOn: true, lease: { select: { lateFeeBp: true, lateAfterDays: true } } },
      take: 5000,
    });
  }

  /** Adds the late fee only if nothing changed meanwhile (a payment, a waiver or another run). Returns whether it was added. */
  async addLateFee(db: Db | Tx, id: string, fee: number, paid: number): Promise<boolean> {
    const done = await rawOf(db, "rentBill").updateMany({ where: { id, lateFee: 0, lateWaived: false, paid, deletedAt: null }, data: { lateFee: fee, version: { increment: 1 } } });
    return done.count > 0;
  }
}
