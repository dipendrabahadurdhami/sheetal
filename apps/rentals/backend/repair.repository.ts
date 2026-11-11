// The only code that reads and writes the rent_repairs table (work done on a unit; a finished repair's cost comes off the owner's statement).
// Where it fits: RepairService, UnitService and OverviewService call it.
// How it works: a RentalRepository on model "rentRepair". A repair is never deleted (there is no route for it), so there is no remove here. `countOfUnit` tells whether a
// unit has any repair on record.
// Rules: a repair counts on a statement only when its status is "done" and its doneOn falls in the statement's month.

import type { BusinessContext } from "@sheetal/platform/core/context";
import { RentalRepository } from "./rental.repository.js";
import type { Change, NewRow, RepairRow } from "./types.js";

export type RepairCreate = NewRow<RepairRow, "doneOn">;
export type RepairChange = Change<RepairRow>;

export class RepairRepository extends RentalRepository<RepairRow, RepairCreate, RepairChange> {
  constructor() {
    super({
      model: "rentRepair", ownerField: null, label: "This repair",
      filterable: { branchId: ["eq", "in"], unitId: ["eq", "in"], status: ["eq", "in"] },
      sortable: ["createdAt", "seq", "doneOn"],
      defaultSort: [{ field: "createdAt", dir: "desc" }],   // the order the page has today
      legacyMaxRows: 1000,                                  // the page showed up to 1000 repairs
    }, "Repair not found.");
  }

  countOfUnit(ctx: BusinessContext, unitId: string): Promise<number> {
    return this.raw(ctx).count({ where: { tenantId: ctx.business.id, unitId, deletedAt: null } });
  }
}
