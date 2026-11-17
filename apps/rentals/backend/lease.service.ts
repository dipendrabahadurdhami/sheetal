// The rules of leases: start one, change it, end it, return the deposit, and make a bill the job missed.
// Where it fits: the controller calls these; they call the repositories. Every write runs in ONE transaction: the row(s), the audit line (the old action strings) and the event.
// How it works: a lease takes its unit's branch. Starting one takes the unit only if it is still free (a compare-and-set), so two leases can't start on one unit; ending one frees
// the unit again. A lease is never deleted: it ends and stays as history. Changing a running lease changes the rent from the NEXT bill; bills already made keep their amount.
// Rules: the order of the checks is the old one (permission, input, row found, rule). A deposit is held and returned, never income, and no more than was held can be returned.
// Bills for coming months are made when the month starts. A stale `version` answers 409; none saves as today.

import { badRequest } from "@sheetal/platform/core/errors";
import { requireRoom } from "@sheetal/platform/billing/room";
import { actorIdOf, type BusinessContext, type DataScope } from "@sheetal/platform/core/context";
import { dayOf, ymd } from "@sheetal/backend-core/domain/money";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import { billCreatedPayload, depositPayload, leaseCreatedPayload, leaseEndedPayload, leaseUpdatedPayload, RENT_EVENTS } from "./events.js";
import type { LeaseChange, LeaseCreate } from "./lease.repository.js";
import { baseDeps, RentalService, type RentalDeps, type Repos } from "./rental.service.js";
import { dueDateOf, leaseCovers, leaseNo } from "./rentals.js";
import { BillMonthBody, DepositBody, LeaseBody, LeaseChangeBody, LeaseEndBody, leaseTerms, orNullText, versionIn } from "./schemas.js";
import type { LeaseRow } from "./types.js";

const MSG = { ended: "This lease has ended.", beforeStart: "The lease ends before it starts." } as const;

export class LeaseService extends RentalService<LeaseRow, LeaseCreate, LeaseChange> {
  constructor(x: RentalDeps, repos: Repos) {
    super(baseDeps<LeaseRow, LeaseCreate, LeaseChange>({
      resource: "lease", repo: repos.leases, bus: x.bus,
      schemas: { create: LeaseBody as never, update: LeaseChangeBody as never },   // every write goes through the actions below
      audit: { entity: "rental", label: (l) => leaseNo(l.seq) },
    }), repos, x);
  }

  /** The lease must exist in the person's branches and still be running. */
  private async running(tx: BusinessContext, id: string, scope: DataScope): Promise<LeaseRow> {
    const l = await this.repos.leases.get(tx, id, scope);
    if (l.status !== "active") throw badRequest(MSG.ended);
    return l;
  }

  // ───── Start a lease ─────

  async start(ctx: BusinessContext, raw: unknown): Promise<LeaseRow> {
    let unitName = "";
    const lease = await this.action<LeaseRow>(ctx, {
      name: "start", permission: this.deps.permissions.create,
      audit: (l) => ({ action: "rental.lease_added", target: `${leaseNo(l.seq)} ${unitName} Rs. ${l.rent}` }),
      event: (l) => ({ name: RENT_EVENTS.leaseCreated, payload: leaseCreatedPayload(l) }),
      run: async (tx, scope) => {
        const b = this.parse(LeaseBody, raw);
        if (b.end < b.start) throw badRequest(MSG.beforeStart);
        // On app subscriptions: the Rentals edition's limit on leases that are running (free 5).
        await requireRoom(tx, "rentals", "leases", () => tx.db.rentLease.count({ where: { tenantId: tx.business.id, deletedAt: null, status: "active" } }));
        const u = await this.repos.units.get(tx, b.unitId, scope);
        unitName = u.name;
        // The unit is taken only if it is still free, so two leases can't start on one unit.
        if (!(await this.repos.units.takeIfFree(tx, u.id, scope)) || (await this.repos.leases.countActiveOfUnit(tx, u.id))) throw badRequest(`${u.name} already has a tenant. End that lease first.`);
        return this.repos.leases.create(tx, { branchId: u.branchId, unitId: u.id, startOn: dayOf(b.start), endOn: dayOf(b.end), deposit: b.deposit, ...leaseTerms(b) });
      },
    });
    await this.x.generateBills(ctx.business.id);   // the first bill is made at once if the lease already runs this month
    return lease;
  }

  // ───── Change a running lease ─────

  change(ctx: BusinessContext, id: string, raw: unknown): Promise<LeaseRow> {
    let before: LeaseRow | null = null;
    let end = "";
    return this.action<LeaseRow>(ctx, {
      name: "change", permission: this.deps.permissions.update,
      audit: (l) => ({ action: "rental.lease_changed", target: `${leaseNo(l.seq)} Rs. ${before!.rent} → ${l.rent}, ends ${end}` }),
      event: (l) => ({ name: RENT_EVENTS.leaseUpdated, payload: leaseUpdatedPayload(l, before!) }),
      run: async (tx, scope) => {
        const b = this.parse(LeaseChangeBody, raw);
        const version = versionIn(raw);
        const l = await this.running(tx, id, scope);
        if (b.end < ymd(l.startOn)) throw badRequest(MSG.beforeStart);
        before = l; end = b.end;
        return this.repos.leases.update(tx, l.id, { ...leaseTerms(b), endOn: dayOf(b.end) }, scope, version);
      },
    });
  }

  // ───── End a lease (and, if asked, return the deposit) ─────

  endLease(ctx: BusinessContext, id: string, raw: unknown): Promise<LeaseRow> {
    let returned: number | null = null;
    return this.action<LeaseRow>(ctx, {
      name: "end", permission: this.deps.permissions.update,
      audit: (l) => ({ action: "rental.lease_ended", target: `${leaseNo(l.seq)}${returned != null ? `, deposit Rs. ${returned} returned` : ""}` }),
      event: (l) => ({ name: RENT_EVENTS.leaseEnded, payload: leaseEndedPayload(l) }),
      run: async (tx, scope) => {
        const b = this.parse(LeaseEndBody, raw);
        const version = versionIn(raw);
        const l = await this.running(tx, id, scope);
        if (b.depositReturned != null && b.depositReturned > l.deposit) throw badRequest(`The deposit was Rs. ${l.deposit}; you can't return more.`);
        this.sameVersion(l, version, "This lease");
        returned = b.depositReturned ?? null;
        const deposit = b.depositReturned != null ? { depositStatus: "returned", depositReturned: b.depositReturned, depositNote: orNullText(b.depositNote) } : {};
        // Taken only if it is still running, so two people ending it end it once.
        if (!(await this.repos.leases.transition(tx, l.id, { status: "active" }, { status: "ended", endedOn: dayOf(b.endedOn), ...deposit }, scope))) throw badRequest(MSG.ended);
        await this.repos.units.update(tx, l.unitId, { status: "vacant" }, scope);
        return this.repos.leases.get(tx, l.id, scope);
      },
    });
  }

  // ───── Return the deposit (the lease may still be running or already ended) ─────

  returnDeposit(ctx: BusinessContext, id: string, raw: unknown): Promise<LeaseRow> {
    return this.action<LeaseRow>(ctx, {
      name: "deposit", permission: this.deps.permissions.update,
      audit: (l) => ({ action: "rental.deposit_returned", target: `${leaseNo(l.seq)} Rs. ${l.depositReturned} of ${l.deposit}` }),
      event: (l) => ({ name: RENT_EVENTS.depositReturned, payload: depositPayload(l) }),
      run: async (tx, scope) => {
        const b = this.parse(DepositBody, raw);
        const version = versionIn(raw);
        const l = await this.repos.leases.get(tx, id, scope);
        if (l.depositStatus === "returned") throw badRequest("The deposit is already returned.");
        if (b.returned > l.deposit) throw badRequest(`The deposit was Rs. ${l.deposit}; you can't return more.`);
        return this.repos.leases.update(tx, l.id, { depositStatus: "returned", depositReturned: b.returned, depositNote: orNullText(b.note) }, scope, version);
      },
    });
  }

  // ───── A bill for a month the job missed (a lease entered late, or the server was off) ─────

  addMissedBill(ctx: BusinessContext, id: string, raw: unknown): Promise<{ month: string }> {
    let no = "";
    return this.action<{ month: string; billId: string; leaseId: string; amount: number; branchId: string }>(ctx, {
      name: "add-bill", permission: this.deps.permissions.create,
      audit: (r) => ({ action: "rental.bill_added", target: `${no} ${r.month}` }),
      event: (r) => ({ name: RENT_EVENTS.billCreated, payload: billCreatedPayload({ id: r.billId, leaseId: r.leaseId, month: r.month, amount: r.amount, branchId: r.branchId }) }),
      run: async (tx, scope) => {
        const b = this.parse(BillMonthBody, raw);
        const l = await this.repos.leases.get(tx, id, scope);
        no = leaseNo(l.seq);
        if (!leaseCovers(l, b.month)) throw badRequest("The lease doesn't run in that month.");
        if (b.month > nepalDay().slice(0, 7)) throw badRequest("Bills for coming months are made when the month starts.");
        const billId = await this.repos.bills.createIfMissing(tx.tx!, { tenantId: l.tenantId, branchId: l.branchId, leaseId: l.id, month: b.month, dueOn: dueDateOf(b.month, l.dueDay), amount: l.rent, createdBy: actorIdOf(tx) });
        if (!billId) throw badRequest("That month already has a bill.");
        return { month: b.month, billId, leaseId: l.id, amount: l.rent, branchId: l.branchId };
      },
    });
  }
}
