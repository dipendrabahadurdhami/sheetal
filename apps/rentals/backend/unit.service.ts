// The rules of rental units (a flat, room, shop... an owner lets through the agency).
// Where it fits: the controller calls these; they call the repositories. Every write runs in ONE transaction: the row, the audit line (the old action strings) and the event.
// How it works: a unit belongs to an owner and takes the owner's branch. Add and change check that the owner is in the person's branches and that a linked listing is the
// business's own. A unit that is let stays let until its lease ends: a change only moves it between vacant and under repair. Remove refuses a unit with any lease or repair
// on record (history is kept) and is a real delete (see unit.repository.ts).
// Rules: permission, then input, then the owner, then the branch, then the listing (the old order). The rent of a running lease does not change when the unit's rent does.

import { badRequest } from "@sheetal/platform/core/errors";
import type { BusinessContext, DataScope } from "@sheetal/platform/core/context";
import type { WriteKind } from "@sheetal/platform/core/service";
import { RENT_EVENTS, unitPayload } from "./events.js";
import { baseDeps, RentalService, type RentalDeps, type Repos } from "./rental.service.js";
import { UnitSchema, versionIn } from "./schemas.js";
import type { UnitChange, UnitCreate } from "./unit.repository.js";
import type { UnitRow } from "./types.js";

export class UnitService extends RentalService<UnitRow, UnitCreate, UnitChange> {
  constructor(x: RentalDeps, repos: Repos) {
    super(baseDeps<UnitRow, UnitCreate, UnitChange>({
      resource: "unit", repo: repos.units, bus: x.bus,
      schemas: { create: UnitSchema as never, update: UnitSchema as never },   // both go through this class's own create / update below
      audit: { entity: "rental", label: (u) => `${u.property} · ${u.name}`, actions: { created: "rental.unit_added", updated: "rental.unit_changed", deleted: "rental.unit_removed" } },
      events: { created: RENT_EVENTS.unitCreated, updated: RENT_EVENTS.unitUpdated, deleted: RENT_EVENTS.unitDeleted },
    }), repos, x);
  }

  protected override eventPayload(row: UnitRow, _kind: WriteKind): object { return unitPayload(row); }

  /** A linked listing must be one of the business's own; none given = no link. */
  private async listingFor(ctx: BusinessContext, id?: number | null): Promise<number | null> {
    if (!id) return null;
    const found = await this.repos.units.ownListing(ctx, id);
    if (found === null) throw badRequest("Choose one of your own listings.");
    return found;
  }

  override async create(ctx: BusinessContext, raw: unknown): Promise<UnitRow> {
    this.refuseReadOnly(ctx);
    this.requireApp(ctx);
    const scope: DataScope = ctx.permissions.require(this.deps.permissions.create);
    const b = this.parse(UnitSchema, raw);
    return this.inTransaction(ctx, async (tx) => {
      const o = await this.repos.owners.get(tx, b.ownerId, scope);
      const row = await this.deps.repo.create(tx, {
        branchId: o.branchId, ownerId: o.id, property: b.property, name: b.name, kind: b.kind, rent: b.rent, status: b.status ?? "vacant", listingId: await this.listingFor(tx, b.listingId),
      });
      await this.wrote(tx, row, "created");
      return row;
    });
  }

  override async update(ctx: BusinessContext, id: string, raw: unknown): Promise<UnitRow> {
    this.refuseReadOnly(ctx);
    this.requireApp(ctx);
    const scope: DataScope = ctx.permissions.require(this.deps.permissions.update);
    const version = versionIn(raw);
    const b = this.parse(UnitSchema, raw);
    return this.inTransaction(ctx, async (tx) => {
      const u = await this.deps.repo.get(tx, id, scope);
      const o = await this.repos.owners.get(tx, b.ownerId, scope);
      if (o.branchId !== u.branchId) throw badRequest("Choose an owner of the same branch.");
      // A let unit stays let until its lease ends; the status only changes between vacant and under repair.
      const status = u.status === "let" ? "let" : b.status ?? u.status;
      const row = await this.deps.repo.update(tx, u.id, { ownerId: o.id, property: b.property, name: b.name, kind: b.kind, rent: b.rent, status, listingId: await this.listingFor(tx, b.listingId) }, scope, version);
      await this.wrote(tx, row, "updated", u);
      return row;
    });
  }

  /** Remove a unit with no lease and no repair on record (a real delete: see unit.repository.ts). */
  override async remove(ctx: BusinessContext, id: string, version?: number): Promise<void> { await this.discard(ctx, id, version); }

  /** The same, answering with the unit that was removed (the screen says "Flat 3A removed."). */
  async discard(ctx: BusinessContext, id: string, version?: number): Promise<UnitRow> {
    this.refuseReadOnly(ctx);
    this.requireApp(ctx);
    const scope = ctx.permissions.require(this.deps.permissions.delete);
    return this.inTransaction(ctx, async (tx) => {
      const u = await this.deps.repo.get(tx, id, scope);
      this.sameVersion(u, version, "This unit");
      const [leases, repairs] = await Promise.all([this.repos.leases.countOfUnit(tx, u.id), this.repos.repairs.countOfUnit(tx, u.id)]);
      if (leases + repairs) throw badRequest(`${u.name} has leases or repairs on record, so it is kept.`);
      await this.repos.units.remove(tx, u.id, scope);
      await this.wrote(tx, u, "deleted");
      return u;
    });
  }
}
