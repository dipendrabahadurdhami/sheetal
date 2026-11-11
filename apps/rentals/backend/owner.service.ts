// The rules of owners (landlords), and the Rentals page that is built around them.
// Where it fits: the controller calls these; they call the repositories. Every write runs in ONE transaction: the row, the audit line (the old action strings) and the event.
// How it works: add and change are the standard operations; remove refuses while the owner still owns a unit and is a real delete (see owner.repository.ts). `overview` is the
// Rentals page: it makes the due bills first, then reads the owners, units, leases, bills, repairs and waiting online payments the screen shows, all inside the person's branches.
// Rules: permission, then input, then the row (the old order); the fee is stored in hundredths of a percent. A new fee counts from the next statement you save.

import { badRequest } from "@sheetal/platform/core/errors";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { WriteKind } from "@sheetal/platform/core/service";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import { ownerPayload, RENT_EVENTS } from "./events.js";
import type { OwnerChange, OwnerCreate } from "./owner.repository.js";
import { presentPage } from "./presenter.js";
import { baseDeps, RentalService, type RentalDeps, type Repos } from "./rental.service.js";
import { RENT_METHODS, UNIT_KINDS } from "./rentals.js";
import { CreateOwnerSchema, UpdateOwnerSchema } from "./schemas.js";
import type { OwnerRow } from "./types.js";

export class OwnerService extends RentalService<OwnerRow, OwnerCreate, OwnerChange> {
  constructor(x: RentalDeps, repos: Repos) {
    super(baseDeps<OwnerRow, OwnerCreate, OwnerChange>({
      resource: "owner", repo: repos.owners, bus: x.bus,
      schemas: { create: CreateOwnerSchema, update: UpdateOwnerSchema },
      audit: { entity: "rental", label: (o) => o.name, actions: { created: "rental.owner_added", updated: "rental.owner_changed", deleted: "rental.owner_removed" } },
      events: { created: RENT_EVENTS.ownerCreated, updated: RENT_EVENTS.ownerUpdated, deleted: RENT_EVENTS.ownerDeleted },
    }), repos, x);
  }

  protected override eventPayload(row: OwnerRow, _kind: WriteKind): object { return ownerPayload(row); }

  /** Remove an owner who owns no unit (a real delete: see owner.repository.ts). */
  override async remove(ctx: BusinessContext, id: string, version?: number): Promise<void> { await this.discard(ctx, id, version); }

  /** The same, answering with the owner that was removed (the screen says "Ram Thapa removed."). */
  async discard(ctx: BusinessContext, id: string, version?: number): Promise<OwnerRow> {
    this.refuseReadOnly(ctx);
    this.requireApp(ctx);
    const scope = ctx.permissions.require(this.deps.permissions.delete);
    return this.inTransaction(ctx, async (tx) => {
      const o = await this.deps.repo.get(tx, id, scope);
      this.sameVersion(o, version, "This owner");
      if (await this.repos.units.countOfOwner(tx, o.id)) throw badRequest(`${o.name} owns units you manage. Remove or move them first.`);
      await this.repos.owners.remove(tx, o.id, scope);
      await this.wrote(tx, o, "deleted");
      return o;
    });
  }

  // ───── The Rentals page: everything at once (a business manages tens or hundreds of units, not thousands) ─────

  async overview(ctx: BusinessContext) {
    this.requireApp(ctx);
    const scope = ctx.permissions.require(this.deps.permissions.read);
    await this.x.generateBills(ctx.business.id);
    const r = this.repos;
    const [owners, units, leases, bills, repairs] = await Promise.all([
      r.owners.list(ctx, scope), r.units.list(ctx, scope), r.leases.list(ctx, scope), r.bills.list(ctx, scope), r.repairs.list(ctx, scope),
    ]);
    const [pending, listings] = await Promise.all([
      r.payments.list(ctx, scope, { per: 500, filters: [{ field: "status", op: "eq", value: "pending" }], sort: [{ field: "createdAt", dir: "asc" }] }),
      r.units.listingsOf(ctx),
    ]);
    const pendingBills = await r.bills.byIds(ctx, scope, [...new Set(pending.rows.map((p) => p.billId))]);
    return presentPage({
      today: nepalDay(), canManage: ctx.permissions.can(this.deps.permissions.update), methods: RENT_METHODS, kinds: UNIT_KINDS,
      owners: owners.rows, units: units.rows, leases: leases.rows, bills: bills.rows, repairs: repairs.rows, pending: pending.rows, pendingBills, listings,
      branchNames: new Map(ctx.branches.mine.map((b) => [b.id, b.name])),
      can: { create: ctx.permissions.can(this.deps.permissions.create), update: ctx.permissions.can(this.deps.permissions.update), delete: ctx.permissions.can(this.deps.permissions.delete) },
    });
  }
}
