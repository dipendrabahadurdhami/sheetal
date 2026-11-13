// The only code that reads and writes the rent_units table (a flat, room, shop... that an owner lets through the agency).
// Where it fits: UnitService, LeaseService, RepairService and OverviewService call it.
// How it works: a RentalRepository on model "rentUnit". Named methods: `takeIfFree` (the compare-and-set that stops two leases starting on one unit),
// `countOfOwner`, and two read-only queries on the listings table (`ownListing`, `listingsOf`), which belongs to the Listings app (listed in this app's manifest under reads).
// Rules: `remove` is a soft delete (P2-W6); a unit with any lease or repair is never removed; the branch-closing check skips deleted units. A unit is let to one lease at a time.

import type { BusinessContext, DataScope } from "@sheetal/platform/core/context";
import { RentalRepository } from "./rental.repository.js";
import type { Change, NewRow, UnitRow } from "./types.js";

export type UnitCreate = NewRow<UnitRow, "listingId">;
export type UnitChange = Change<UnitRow>;
export interface ListingBrief { id: number; code: string | null; title: string }

export class UnitRepository extends RentalRepository<UnitRow, UnitCreate, UnitChange> {
  constructor() {
    super({
      model: "rentUnit", ownerField: null, label: "This unit",
      filterable: { branchId: ["eq", "in"], ownerId: ["eq", "in"], status: ["eq", "in"] },
      sortable: ["property", "name", "createdAt"],
      defaultSort: [{ field: "property", dir: "asc" }, { field: "name", dir: "asc" }],   // the order the page has today
      legacyMaxRows: 5000,
    }, "Unit not found.");
  }

  /** Sets a unit to "let" only if it is still free, so two leases can't start on one unit. Returns whether it was taken. */
  takeIfFree(ctx: BusinessContext, id: string, scope: DataScope): Promise<boolean> {
    return this.guardedUpdate(ctx, id, scope, { status: { not: "let" } }, { status: "let" });
  }

  countOfOwner(ctx: BusinessContext, ownerId: string): Promise<number> {
    return this.raw(ctx).count({ where: { tenantId: ctx.business.id, ownerId, deletedAt: null } });
  }

  /** The id of one of this business's own listings (not removed), or null: a unit may only point at its own listings. */
  async ownListing(ctx: BusinessContext, id: number): Promise<number | null> {
    const l = await (ctx.tx ?? ctx.db).listing.findFirst({ where: { id, tenantId: ctx.business.id, status: { not: "removed" } }, select: { id: true } });
    return l?.id ?? null;
  }

  /** The business's listings (newest first, up to 1000) for the "link to a listing" list and the property code on each unit. */
  listingsOf(ctx: BusinessContext): Promise<ListingBrief[]> {
    return (ctx.tx ?? ctx.db).listing.findMany({ where: { tenantId: ctx.business.id, status: { not: "removed" } }, orderBy: { id: "desc" }, take: 1000, select: { id: true, code: true, title: true } });
  }

  /** Real delete (see the header). The service has already checked that the unit has no lease and no repair. */
  remove(ctx: BusinessContext, id: string, scope: DataScope): Promise<void> { return this.softDeleteRow(ctx, id, scope); }
}
