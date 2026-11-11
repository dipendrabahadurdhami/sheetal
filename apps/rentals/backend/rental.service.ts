// What every Rentals service shares: the permission names, the repositories, the dependencies, and the small checks every change makes.
// Where it fits: the seven services (owner / unit / lease / bill+payment / repair / statement) extend RentalService; routes.ts builds the Repos bag once and hands it to all of them.
// How it works: RentalService is a BaseService (permission and scope, one transaction with the row + audit line + event, read-only support sessions refused first)
// plus `sameVersion` (a stale `version` in the body answers 409 version_conflict; a missing one saves as today, last write wins, until the new screens send it in wave 2).
// Rules: the permission names are the new ones (rentals.rental.read / create / update / delete); a role that still holds rentals.view / rentals.manage passes through the alias layer
// with the same abilities (view = read; manage = all four). Inside a transaction callback never call ctx.permissions: take the `scope` the action gives you (the capped one).

import { versionConflict } from "@sheetal/platform/core/errors";
import type { EventBus } from "@sheetal/platform/core/events";
import { BaseService, type ServiceDeps } from "@sheetal/platform/core/service";
import type { BranchEntity } from "@sheetal/platform/core/repository";
import { BillRepository } from "./bill.repository.js";
import { LeaseRepository } from "./lease.repository.js";
import { OwnerRepository } from "./owner.repository.js";
import { PaymentRepository } from "./payment.repository.js";
import { RepairRepository } from "./repair.repository.js";
import { StatementRepository } from "./statement.repository.js";
import { UnitRepository } from "./unit.repository.js";

export const RENTAL_PERMISSIONS = {
  read: "rentals.rental.read", create: "rentals.rental.create", update: "rentals.rental.update", delete: "rentals.rental.delete",
} as const;

export interface RentalDeps {
  bus: EventBus;
  /** MEDIA_DIR of the app config (where private payment screenshots are kept). */
  mediaDir(): string | undefined;
  /** Makes the due rent bills and late fees of one business (the page does it when it opens; a new lease does it at once). */
  generateBills(tenantId: string): Promise<unknown>;
}

/** The seven repositories, one of each, shared by the services of one request handler set. */
export interface Repos {
  owners: OwnerRepository; units: UnitRepository; leases: LeaseRepository; bills: BillRepository;
  payments: PaymentRepository; repairs: RepairRepository; statements: StatementRepository;
}
export const newRepos = (): Repos => ({
  owners: new OwnerRepository(), units: new UnitRepository(), leases: new LeaseRepository(), bills: new BillRepository(),
  payments: new PaymentRepository(), repairs: new RepairRepository(), statements: new StatementRepository(),
});

export abstract class RentalService<T extends BranchEntity, C extends object, U extends object> extends BaseService<T, C, U> {
  constructor(deps: ServiceDeps<T, C, U>, protected readonly repos: Repos, protected readonly x: RentalDeps) { super(deps); }

  /** A stale version answers 409 ("This lease was changed by someone else. Reload and try again."). No version = today's last-write-wins. */
  protected sameVersion(row: { version: number }, asked: number | undefined, what: string): void {
    if (asked !== undefined && asked !== row.version) throw versionConflict(what);
  }
}

/** The service-level defaults every Rentals service uses. */
export const baseDeps = <T extends BranchEntity, C extends object, U extends object>(
  d: Pick<ServiceDeps<T, C, U>, "resource" | "repo" | "schemas" | "audit" | "events"> & { bus: EventBus },
): ServiceDeps<T, C, U> => ({ app: "rentals", permissions: RENTAL_PERMISSIONS, requireVersion: false, ...d });
