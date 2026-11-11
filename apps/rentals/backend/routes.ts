// Rentals: owners (landlords), units, leases, monthly rent bills, rent payments, repairs and owner statements.
// Where it fits: Business → Rentals (LiveRentals.jsx), for agencies that manage homes and shops for owners. business/backend/src/app.ts registers rentalRoutes with
// { prefix: "/v1", contextOf: businessContextOf }; business/backend/src/modules/rentals/routes.ts is a one-line shim over this file.
// How it works: an owner has units; a unit has at most one active lease; every active lease gets one rent bill a month (a background job, and the page when it opens, make
// them, and add a late fee once when a bill is still unpaid the set days after its due date). Staff record payments against a bill. Repairs belong to a unit and, when done,
// come off the owner's statement. An owner statement for a month is rent collected - management fee - repairs; saving it counts the fee in the agency's profit (Business →
// Expenses → Profit). The code is split by job: *.repository.ts (tables), *.service.ts (rules), rental.controller.ts (HTTP), presenter.ts (answers), bills.ts (the generator).
// Rules: rentals.rental.read / create / update / delete (a role that still holds rentals.view or rentals.manage passes through the alias layer); everything belongs to a branch
// and people only see their branches'; a payment can't be more than what is owed; online payments count once confirmed (see rentpay.ts); a bill's amount can only change before
// anything is paid; rent is the owner's money, never the agency's income, and a deposit is held and returned, never income.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import type { BusinessContext } from "@sheetal/platform/core/context";
import { BillService, PaymentService } from "./bill.service.js";
import { runRentBills } from "./bills.js";
import { billEventsOf, busOf, dbOf, mediaDirOf } from "./host.js";
import { LeaseService } from "./lease.service.js";
import { OwnerService } from "./owner.service.js";
import { RentalController } from "./rental.controller.js";
import { newRepos, type RentalDeps } from "./rental.service.js";
import { RepairService } from "./repair.service.js";
import { phaseOneContext } from "./scope.js";
import { StatementService } from "./statement.service.js";
import { UnitService } from "./unit.service.js";

export interface RentalRoutesOptions {
  /** Builds the context of a request (business/backend/src/modules/access.ts businessContextOf). Passed in because an app does not import an API. */
  contextOf: (req: FastifyRequest) => Promise<BusinessContext>;
}

export async function rentalRoutes(app: FastifyInstance, opts: RentalRoutesOptions) {
  const deps: RentalDeps = {
    bus: busOf(app),
    mediaDir: () => mediaDirOf(app),
    generateBills: (tenantId) => runRentBills(dbOf(app), { today: nepalDay(), tenantId, events: billEventsOf(app) }),
  };
  const repos = newRepos();
  const contextOf = async (req: FastifyRequest) => phaseOneContext(await opts.contextOf(req));
  new RentalController({
    owners: new OwnerService(deps, repos), units: new UnitService(deps, repos), leases: new LeaseService(deps, repos), bills: new BillService(deps, repos),
    payments: new PaymentService(deps, repos), repairs: new RepairService(deps, repos), statements: new StatementService(deps, repos),
  }, contextOf).register(app);
}
