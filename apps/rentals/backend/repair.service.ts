// The rules of repairs (work done on a unit).
// Where it fits: the controller calls these; they call the repositories. Every write runs in ONE transaction: the row, the audit line (the old action strings) and the event.
// How it works: a repair belongs to a unit and takes its branch. It is open, assigned or done; when it is marked done (with a date, today if none), its cost comes off the owner's
// statement for that month. A repair is never deleted.
// Rules: permission, then input, then the unit (the old order). A repair marked done keeps its first done date unless a new one is given.

import type { BusinessContext } from "@sheetal/platform/core/context";
import { dayOf, ymd } from "@sheetal/backend-core/domain/money";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import { RENT_EVENTS, repairPayload } from "./events.js";
import type { RepairChange, RepairCreate } from "./repair.repository.js";
import { baseDeps, RentalService, type RentalDeps, type Repos } from "./rental.service.js";
import { repairNo } from "./rentals.js";
import { NewRepairBody, RepairBody, orNullText, versionIn } from "./schemas.js";
import type { RepairRow } from "./types.js";

export class RepairService extends RentalService<RepairRow, RepairCreate, RepairChange> {
  constructor(x: RentalDeps, repos: Repos) {
    super(baseDeps<RepairRow, RepairCreate, RepairChange>({
      resource: "repair", repo: repos.repairs, bus: x.bus,
      schemas: { create: NewRepairBody as never, update: RepairBody as never },   // every write goes through the actions below
      audit: { entity: "rental", label: (r) => `${repairNo(r.seq)} ${r.title}` },
    }), repos, x);
  }

  log(ctx: BusinessContext, raw: unknown): Promise<RepairRow> {
    return this.action<RepairRow>(ctx, {
      name: "log", permission: this.deps.permissions.create,
      audit: (r) => ({ action: "rental.repair_added", target: `${repairNo(r.seq)} ${r.title}` }),
      event: (r) => ({ name: RENT_EVENTS.repairCreated, payload: repairPayload(r) }),
      run: async (tx, scope) => {
        const b = this.parse(NewRepairBody, raw);
        const u = await this.repos.units.get(tx, b.unitId, scope);
        return this.repos.repairs.create(tx, {
          branchId: u.branchId, unitId: u.id, title: b.title, priority: b.priority, vendor: orNullText(b.vendor), cost: b.cost, status: b.status,
          doneOn: b.status === "done" ? dayOf(b.doneOn ?? nepalDay()) : null,
        });
      },
    });
  }

  change(ctx: BusinessContext, id: string, raw: unknown): Promise<RepairRow> {
    return this.action<RepairRow>(ctx, {
      name: "change", permission: this.deps.permissions.update,
      audit: (r) => ({ action: "rental.repair_changed", target: `${repairNo(r.seq)} ${r.status} Rs. ${r.cost}` }),
      event: (r) => ({ name: RENT_EVENTS.repairUpdated, payload: repairPayload(r) }),
      run: async (tx, scope) => {
        const b = this.parse(RepairBody, raw);
        const version = versionIn(raw);
        const r = await this.repos.repairs.get(tx, id, scope);
        const doneOn = b.status === "done" ? dayOf(b.doneOn ?? (r.doneOn ? ymd(r.doneOn) : nepalDay())) : null;
        return this.repos.repairs.update(tx, r.id, { title: b.title, priority: b.priority, vendor: orNullText(b.vendor), cost: b.cost, status: b.status, doneOn }, scope, version);
      },
    });
  }
}
