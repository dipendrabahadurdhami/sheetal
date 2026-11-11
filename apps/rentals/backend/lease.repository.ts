// The only code that reads and writes the rent_leases table.
// Where it fits: LeaseService, UnitService, BillService, OverviewService and the bill generator call it.
// How it works: a RentalRepository on model "rentLease". A lease is never deleted (it ends, and stays as history), so there is no remove here. Named methods:
// `countOfUnit` / `countActiveOfUnit` (a unit with any lease is kept; a unit has at most one active lease) and `runningIn` (the bill generator reads the running
// leases of EVERY business, so it is the one read here that is not limited to one business; it only runs from the job and the page, with tenantId).
// Rules: ending a lease is a compare-and-set on status "active" (transition), so two people ending it end it once.

import type { BusinessContext } from "@sheetal/platform/core/context";
import type { Db } from "@sheetal/platform/db/client";
import { dayOf } from "@sheetal/backend-core/domain/money";
import { lastDayOf } from "./rentals.js";
import { RentalRepository } from "./rental.repository.js";
import type { Change, LeaseRow, NewRow } from "./types.js";

export type LeaseCreate = NewRow<LeaseRow, "endedOn" | "depositStatus" | "depositReturned" | "depositNote" | "userId" | "status">;
export type LeaseChange = Change<LeaseRow>;
export interface RunningLease { id: string; tenantId: string; branchId: string; rent: number; dueDay: number }

export class LeaseRepository extends RentalRepository<LeaseRow, LeaseCreate, LeaseChange> {
  constructor() {
    super({
      model: "rentLease", ownerField: null, label: "This lease",
      filterable: { branchId: ["eq", "in"], unitId: ["eq", "in"], status: ["eq", "in"] },
      sortable: ["status", "endOn", "startOn", "createdAt"],
      defaultSort: [{ field: "status", dir: "asc" }, { field: "endOn", dir: "asc" }],   // the order the page has today
      legacyMaxRows: 2000,                                                                // the page showed up to 2000 leases
    }, "Lease not found.");
  }

  countOfUnit(ctx: BusinessContext, unitId: string): Promise<number> {
    return this.raw(ctx).count({ where: { tenantId: ctx.business.id, unitId, deletedAt: null } });
  }
  countActiveOfUnit(ctx: BusinessContext, unitId: string): Promise<number> {
    return this.raw(ctx).count({ where: { tenantId: ctx.business.id, unitId, status: "active", deletedAt: null } });
  }

  /** Active, not deleted leases that run in this month. tenantId limits it to one business (the page asks for its own). */
  async runningIn(db: Db, o: { month: string; tenantId?: string }): Promise<RunningLease[]> {
    return db.rentLease.findMany({
      where: { ...(o.tenantId ? { tenantId: o.tenantId } : {}), status: "active", deletedAt: null, startOn: { lte: dayOf(lastDayOf(o.month)) }, endOn: { gte: dayOf(`${o.month}-01`) } },
      select: { id: true, tenantId: true, branchId: true, rent: true, dueDay: true },
    });
  }
}
