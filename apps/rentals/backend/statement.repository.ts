// The only code that reads and writes the owner_statements table, and the maths of what a statement says.
// Where it fits: StatementService calls it. Profit (apps/expenses) reads saved statements for the management fee.
// How it works: a RentalRepository on model "ownerStatement". `numbersFor` works out a month for some owners: rent collected (confirmed payments made that month for their
// units), the management fee, repairs done that month, and what is owed to the owner. `saveFor` saves those numbers (one statement per owner and month; saving again updates it).
// Rules: statement = collected - fee - repairs. Pending and rejected payments never count. `remove` is a soft delete (P2-W6): saving the same owner and month
// again brings the row back with new numbers (the upsert clears deletedAt), and profit skips deleted statements, so a removed statement stops counting. The statementsFor() function keeps its old name and shape for the old import path.

import { actorIdOf, type BusinessContext, type DataScope, type Tx } from "@sheetal/platform/core/context";
import type { Db } from "@sheetal/platform/db/client";
import { dayOf } from "@sheetal/backend-core/domain/money";
import { feeOf, lastDayOf } from "./rentals.js";
import { RentalRepository } from "./rental.repository.js";
import type { Change, NewRow, OwnerRow, StatementRow } from "./types.js";

export type StatementCreate = NewRow<StatementRow>;
export type StatementChange = Change<StatementRow>;
export interface StatementLine { ownerId: string; collected: number; fee: number; repairs: number; payable: number }

/** The statement numbers of these owners for a month: rent collected (payments made that month for their units), the management fee, repairs done that month for their
 *  units, and what is owed to each owner. */
export async function statementsFor(db: Db | Tx, o: { tenantId: string; month: string; owners: { id: string; feeBp: number }[] }): Promise<Map<string, StatementLine>> {
  const first = dayOf(`${o.month}-01`), last = dayOf(lastDayOf(o.month));
  const ids = o.owners.map((x) => x.id);
  const [payments, repairs] = await Promise.all([
    db.rentPayment.findMany({ where: { tenantId: o.tenantId, status: "confirmed", deletedAt: null, paidOn: { gte: first, lte: last }, bill: { lease: { unit: { ownerId: { in: ids } } } } }, select: { amount: true, bill: { select: { lease: { select: { unit: { select: { ownerId: true } } } } } } }, take: 50_000 }),
    db.rentRepair.findMany({ where: { tenantId: o.tenantId, status: "done", deletedAt: null, doneOn: { gte: first, lte: last }, unit: { ownerId: { in: ids } } }, select: { cost: true, unit: { select: { ownerId: true } } }, take: 50_000 }),
  ]);
  const out = new Map<string, StatementLine>(o.owners.map((x) => [x.id, { ownerId: x.id, collected: 0, fee: 0, repairs: 0, payable: 0 }]));
  for (const p of payments) out.get(p.bill.lease.unit.ownerId)!.collected += p.amount;
  for (const r of repairs) out.get(r.unit.ownerId)!.repairs += r.cost;
  for (const x of o.owners) { const s = out.get(x.id)!; s.fee = feeOf(s.collected, x.feeBp); s.payable = s.collected - s.fee - s.repairs; }
  return out;
}

export class StatementRepository extends RentalRepository<StatementRow, StatementCreate, StatementChange> {
  constructor() {
    super({
      model: "ownerStatement", ownerField: null, label: "This statement",
      filterable: { branchId: ["eq", "in"], ownerId: ["eq", "in"], month: ["eq", "in"] },
      sortable: ["month", "createdAt"],
      defaultSort: [{ field: "month", dir: "desc" }],
      legacyMaxRows: 5000,
    }, "Statement not found.");
  }

  /** The numbers of some owners for a month, for this business. */
  numbersFor(ctx: BusinessContext, owners: readonly OwnerRow[], month: string): Promise<Map<string, StatementLine>> {
    return statementsFor(ctx.tx ?? ctx.db, { tenantId: ctx.business.id, month, owners: owners.map((o) => ({ id: o.id, feeBp: o.feeBp })) });
  }

  /** The saved statements of these owners for a month, inside the person's scope. */
  async savedFor(ctx: BusinessContext, scope: DataScope, ownerIds: readonly string[], month: string): Promise<StatementRow[]> {
    if (!ownerIds.length) return [];
    return (await this.list(ctx, scope, { filters: [{ field: "month", op: "eq", value: month }, { field: "ownerId", op: "in", value: [...ownerIds] }] })).rows;
  }

  /** Saves a month's numbers for an owner: creates the statement, or updates the one already saved (unique on owner + month). */
  async saveFor(ctx: BusinessContext, owner: OwnerRow, month: string, n: Pick<StatementLine, "collected" | "fee" | "repairs" | "payable">): Promise<StatementRow> {
    const me = actorIdOf(ctx);
    const row = await this.raw(ctx).upsert({
      where: { ownerId_month: { ownerId: owner.id, month } },
      create: { tenantId: ctx.business.id, branchId: owner.branchId, ownerId: owner.id, month, ...n, createdBy: me, updatedBy: me, version: 1 },
      update: { ...n, updatedBy: me, version: { increment: 1 }, deletedAt: null, deletedBy: null },
    });
    return row as StatementRow;
  }

  /** Real delete (see the header). */
  remove(ctx: BusinessContext, id: string, scope: DataScope): Promise<void> { return this.softDeleteRow(ctx, id, scope); }
}
