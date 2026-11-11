// The only code that reads and writes the rent_owners table (a property owner / landlord).
// Where it fits: OwnerService, StatementService and OverviewService call it; nothing else in the app touches the rentOwner delegate.
// How it works: a RentalRepository on model "rentOwner", limited to the business and the branches in view, hidden when deletedAt is set.
// Rules: `remove` is a REAL delete, not a soft one: an owner can only be removed when it owns no unit, and other code that cannot be changed in this task (the
// branch-closing check in Workspace → Branches) counts owners without looking at deletedAt, so a soft-deleted owner would block closing a branch for ever.
// Switch to soft delete when those readers filter deletedAt (wave 2).

import type { BusinessContext, DataScope } from "@sheetal/platform/core/context";
import { RentalRepository } from "./rental.repository.js";
import type { Change, NewRow, OwnerRow } from "./types.js";

export type OwnerCreate = NewRow<OwnerRow>;
export type OwnerChange = Change<OwnerRow>;

export class OwnerRepository extends RentalRepository<OwnerRow, OwnerCreate, OwnerChange> {
  constructor() {
    super({
      model: "rentOwner", ownerField: null, label: "This owner",
      filterable: { branchId: ["eq", "in"] },
      sortable: ["name", "createdAt"],
      defaultSort: [{ field: "name", dir: "asc" }],        // the order the page has today
      legacyMaxRows: 5000,                                 // the page read every owner; a business has a few hundred
    }, "Owner not found.");
  }

  /** Real delete (see the header). The service has already checked that the owner owns no unit. */
  remove(ctx: BusinessContext, id: string, scope: DataScope): Promise<void> { return this.deleteRow(ctx, id, scope); }
}
