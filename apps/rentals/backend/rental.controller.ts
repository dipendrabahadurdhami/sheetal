// The HTTP side of Rentals: the routes, exactly as the Rentals page calls them (KERNEL.md 10.4).
// Where it fits: rentalRoutes() (routes.ts) registers this controller; each handler builds the context, calls ONE service method and shapes the answer.
// How it works: one controller serves everything under /rentals (the page, owners, units, leases, bills, payments, repairs, statements). Every path, verb and answer is the old
// one: change is PUT, create answers 200, answers look like { message, data }, the page like { data: { owners, units, ... } }. A delete may carry `?version=` (optional).
// Rules: no business logic and no Prisma here. The standard routes of BaseController are switched off (standardRoutes: []) because the answers have their own shape; the
// routes below are the whole API of the app. A route does nothing until app.ts registers rentalRoutes (it does, with { prefix: "/v1", contextOf }).

import type { FastifyInstance, FastifyRequest } from "fastify";
import { BaseController } from "@sheetal/platform/core/controller";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { BillService, PaymentService } from "./bill.service.js";
import type { LeaseService } from "./lease.service.js";
import type { OwnerService } from "./owner.service.js";
import type { OwnerChange, OwnerCreate } from "./owner.repository.js";
import type { RepairService } from "./repair.service.js";
import { leaseNo } from "./rentals.js";
import type { StatementService } from "./statement.service.js";
import type { UnitService } from "./unit.service.js";
import type { OwnerRow } from "./types.js";

type ContextOf = (req: FastifyRequest) => Promise<BusinessContext>;
type IdParams = { Params: { id: string } };

export interface RentalServices {
  owners: OwnerService; units: UnitService; leases: LeaseService; bills: BillService; payments: PaymentService; repairs: RepairService; statements: StatementService;
}

export class RentalController extends BaseController<OwnerRow, OwnerCreate, OwnerChange> {
  constructor(private readonly s: RentalServices, contextOf: ContextOf) {
    super(s.owners, { basePath: "/rentals", standardRoutes: [], contextOf, createStatus: 200, updateMethod: "PUT" });
  }

  /** An id longer than 40 characters is cut, so it is "not found" (404) as before, not a 400. */
  protected override idOf(req: FastifyRequest): string { return ((req.params as { id?: string }).id ?? "").slice(0, 40); }

  protected override routes(app: FastifyInstance): void {
    const base = this.cfg.basePath;
    const s = this.s;

    // ───── The page: everything at once ─────
    app.get(base, async (req) => ({ data: await s.owners.overview(await this.ctxOf(req)) }));

    // ───── Owners ─────
    app.post(`${base}/owners`, async (req) => {
      const o = await s.owners.create(await this.ctxOf(req), req.body);
      return { message: `${o.name} added.`, data: { id: o.id } };
    });
    app.put<IdParams>(`${base}/owners/:id`, async (req) => {
      await s.owners.update(await this.ctxOf(req), this.idOf(req), req.body);
      return { message: "Owner saved. A new fee counts from the next statement you save." };
    });
    app.delete<IdParams>(`${base}/owners/:id`, async (req) => {
      const o = await s.owners.discard(await this.ctxOf(req), this.idOf(req), this.versionQuery(req));
      return { message: `${o.name} removed.` };
    });

    // ───── Units ─────
    app.post(`${base}/units`, async (req) => {
      const u = await s.units.create(await this.ctxOf(req), req.body);
      return { message: `${u.name} added.`, data: { id: u.id } };
    });
    app.put<IdParams>(`${base}/units/:id`, async (req) => {
      await s.units.update(await this.ctxOf(req), this.idOf(req), req.body);
      return { message: "Unit saved. The rent of a running lease doesn't change; change it on the lease." };
    });
    app.delete<IdParams>(`${base}/units/:id`, async (req) => {
      const u = await s.units.discard(await this.ctxOf(req), this.idOf(req), this.versionQuery(req));
      return { message: `${u.name} removed.` };
    });

    // ───── Leases ─────
    app.post(`${base}/leases`, async (req) => {
      const l = await s.leases.start(await this.ctxOf(req), req.body);
      return { message: `Lease ${leaseNo(l.seq)} made. Rent bills are made every month on their own.`, data: { id: l.id, no: leaseNo(l.seq) } };
    });
    app.put<IdParams>(`${base}/leases/:id`, async (req) => {
      await s.leases.change(await this.ctxOf(req), this.idOf(req), req.body);
      return { message: "Lease saved. A new rent counts from the next bill; bills already made keep their amount." };
    });
    app.post<IdParams>(`${base}/leases/:id/end`, async (req) => {
      const l = await s.leases.endLease(await this.ctxOf(req), this.idOf(req), req.body);
      return { message: `${leaseNo(l.seq)} ended. The unit is vacant.` };
    });
    app.post<IdParams>(`${base}/leases/:id/deposit`, async (req) => {
      await s.leases.returnDeposit(await this.ctxOf(req), this.idOf(req), req.body);
      return { message: "Deposit marked as returned." };
    });
    app.post<IdParams>(`${base}/leases/:id/bills`, async (req) => {
      const r = await s.leases.addMissedBill(await this.ctxOf(req), this.idOf(req), req.body);
      return { message: `Bill for ${r.month} made.` };
    });

    // ───── Bills and payments ─────
    app.get<IdParams>(`${base}/bills/:id`, async (req) => ({ data: await s.bills.payments(await this.ctxOf(req), this.idOf(req)) }));
    app.put<IdParams>(`${base}/bills/:id`, async (req) => {
      await s.bills.changeAmount(await this.ctxOf(req), this.idOf(req), req.body);
      return { message: "Bill saved." };
    });
    app.post<IdParams>(`${base}/bills/:id/waive`, async (req) => {
      await s.bills.waiveLateFee(await this.ctxOf(req), this.idOf(req), req.body);
      return { message: "Late fee waived." };
    });
    app.post<IdParams>(`${base}/bills/:id/payments`, async (req) => {
      const r = await s.payments.record(await this.ctxOf(req), this.idOf(req), req.body);
      return { message: r.left === r.amount ? `${r.no} is fully paid.` : `Rs. ${r.amount} recorded. Rs. ${r.left - r.amount} is still owed.` };
    });
    app.delete<IdParams>(`${base}/payments/:id`, async (req) => {
      await s.payments.remove(await this.ctxOf(req), this.idOf(req), this.versionQuery(req));
      return { message: "Payment removed. Saved owner statements for that month don't change; save them again." };
    });

    // ───── Online payments ─────
    app.post<IdParams>(`${base}/payments/:id/confirm`, async (req) => {
      const r = await s.payments.confirm(await this.ctxOf(req), this.idOf(req), req.body);
      return { message: `Confirmed. Rs. ${r.amount} is added to ${r.no}.` };
    });
    app.post<IdParams>(`${base}/payments/:id/reject`, async (req) => {
      await s.payments.reject(await this.ctxOf(req), this.idOf(req), req.body);
      return { message: "Rejected. The tenant sees why in My rentals." };
    });
    app.get<IdParams>(`${base}/payments/:id/proof`, async (req) => ({ data: await s.payments.proof(await this.ctxOf(req), this.idOf(req)) }));

    // ───── Repairs ─────
    app.post(`${base}/repairs`, async (req) => {
      const r = await s.repairs.log(await this.ctxOf(req), req.body);
      return { message: "Repair logged.", data: { id: r.id } };
    });
    app.put<IdParams>(`${base}/repairs/:id`, async (req) => {
      const r = await s.repairs.change(await this.ctxOf(req), this.idOf(req), req.body);
      return { message: r.status === "done" ? "Marked done. The cost comes off the owner's statement for that month." : "Repair saved." };
    });

    // ───── Owner statements ─────
    app.get(`${base}/statements`, async (req) => ({ data: await s.statements.month(await this.ctxOf(req), req.query) }));
    app.post(`${base}/statements`, async (req) => {
      const r = await s.statements.save(await this.ctxOf(req), req.body);
      return { message: `Statement saved. Your fee of Rs. ${r.fee} now counts in your profit.` };
    });
    app.delete<IdParams>(`${base}/statements/:id`, async (req) => {
      await s.statements.discard(await this.ctxOf(req), this.idOf(req), this.versionQuery(req));
      return { message: "Statement removed. Its fee no longer counts in your profit." };
    });
  }
}
