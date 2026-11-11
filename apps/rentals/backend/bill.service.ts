// The rules of rent bills and the payments made against them.
// Where it fits: the controller calls these; they call the repositories. Every write runs in ONE transaction: the row(s), the audit line (the old action strings) and the event.
// How it works: BillService = a bill's payments, change the amount, waive the late fee. PaymentService = record a payment, remove one, confirm or reject an online payment
// waiting to be checked, open its screenshot. Every change of what a bill has paid is a compare-and-set on `paid` (BillRepository.addPaid / removePaid), so a double click
// or two people at once change it once.
// Rules (they must not change): a payment can't be more than what is owed; a bill's amount changes only before anything is paid; rent is the owner's money, never the agency's
// income; an online payment counts only once confirmed, never twice, and never above what is owed; a payment Sheetal received is confirmed by Sheetal, not by the business.

import { badRequest, forbidden, notFound } from "@sheetal/platform/core/errors";
import { actorIdOf, type BusinessContext, type DataScope } from "@sheetal/platform/core/context";
import { readPrivateFile } from "@sheetal/backend-core/lib/files";
import { dayOf, ymd } from "@sheetal/backend-core/domain/money";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import type { BillChange, BillCreate } from "./bill.repository.js";
import { billUpdatedPayload, lateFeePayload, paymentPayload, paymentRejectedPayload, RENT_EVENTS } from "./events.js";
import type { PaymentChange, PaymentCreate } from "./payment.repository.js";
import { presentPayments } from "./presenter.js";
import { baseDeps, RentalService, type RentalDeps, type Repos } from "./rental.service.js";
import { balanceOf, billNo } from "./rentals.js";
import { BillAmountBody, PaymentBody, RejectBody, orNullText, versionIn } from "./schemas.js";
import type { BillRow, PaymentRow } from "./types.js";

const day = (d: Date) => ymd(d);

export class BillService extends RentalService<BillRow, BillCreate, BillChange> {
  constructor(x: RentalDeps, repos: Repos) {
    super(baseDeps<BillRow, BillCreate, BillChange>({
      resource: "bill", repo: repos.bills, bus: x.bus,
      schemas: { create: BillAmountBody as never, update: BillAmountBody as never },   // every write goes through the actions below
      audit: { entity: "rental", label: (b) => billNo(b.seq) },
    }), repos, x);
  }

  /** A bill's payments (GET /rentals/bills/:id). */
  async payments(ctx: BusinessContext, id: string) {
    this.requireApp(ctx);
    const scope = ctx.permissions.require(this.deps.permissions.read);
    const b = await this.repos.bills.get(ctx, id, scope);
    return presentPayments(await this.repos.payments.ofBill(ctx, scope, b.id));
  }

  /** Change a bill's amount: only while nothing is paid on it. */
  changeAmount(ctx: BusinessContext, id: string, raw: unknown): Promise<BillRow> {
    let before: BillRow | null = null;
    return this.action<BillRow>(ctx, {
      name: "change-amount", permission: this.deps.permissions.update,
      audit: (b) => ({ action: "rental.bill_changed", target: `${billNo(b.seq)} Rs. ${before!.amount} → ${b.amount}` }),
      event: (b) => ({ name: RENT_EVENTS.billUpdated, payload: billUpdatedPayload(b, before!) }),
      run: async (tx, scope) => {
        const body = this.parse(BillAmountBody, raw);
        const version = versionIn(raw);
        const b = await this.repos.bills.get(tx, id, scope);
        this.sameVersion(b, version, "This bill");
        before = b;
        if (!(await this.repos.bills.transition(tx, b.id, { paid: 0 }, { amount: body.amount }, scope))) throw badRequest("Something is already paid on this bill, so its amount stays.");
        return this.repos.bills.get(tx, b.id, scope);
      },
    });
  }

  /** Waive the late fee, if none of it is paid yet. It is not added back. */
  waiveLateFee(ctx: BusinessContext, id: string, raw: unknown): Promise<BillRow> {
    let waived = 0;
    return this.action<BillRow>(ctx, {
      name: "waive", permission: this.deps.permissions.update,
      audit: (b) => ({ action: "rental.late_fee_waived", target: `${billNo(b.seq)} Rs. ${waived}` }),
      event: (b) => ({ name: RENT_EVENTS.lateFeeWaived, payload: lateFeePayload(b, waived) }),
      run: async (tx, scope) => {
        const version = versionIn(raw);
        const b = await this.repos.bills.get(tx, id, scope);
        if (!b.lateFee) throw badRequest("This bill has no late fee.");
        if (b.paid > b.amount) throw badRequest("Part of the late fee is already paid, so it can't be waived.");
        this.sameVersion(b, version, "This bill");
        waived = b.lateFee;
        if (!(await this.repos.bills.transition(tx, b.id, { lateFee: b.lateFee, paid: b.paid }, { lateFee: 0, lateWaived: true }, scope))) throw badRequest("The bill changed. Open it again.");
        return this.repos.bills.get(tx, b.id, scope);
      },
    });
  }
}

export class PaymentService extends RentalService<PaymentRow, PaymentCreate, PaymentChange> {
  constructor(x: RentalDeps, repos: Repos) {
    super(baseDeps<PaymentRow, PaymentCreate, PaymentChange>({
      resource: "payment", repo: repos.payments, bus: x.bus,
      schemas: { create: PaymentBody as never, update: PaymentBody as never },   // every write goes through the actions below
      audit: { entity: "rental", label: (p) => `Rs. ${p.amount}` },
    }), repos, x);
  }

  // ───── Record a payment made to the business (cash, bank...) ─────

  async record(ctx: BusinessContext, billId: string, raw: unknown): Promise<{ payment: PaymentRow; no: string; amount: number; left: number }> {
    let bill: BillRow | null = null;
    let left = 0;
    return this.action<PaymentRow>(ctx, {
      name: "record", permission: this.deps.permissions.create,
      audit: (p) => ({ action: "rental.payment_added", target: `${billNo(bill!.seq)} Rs. ${p.amount} ${p.method}` }),
      event: (p) => ({ name: RENT_EVENTS.paymentRecorded, payload: paymentPayload(p) }),
      run: async (tx, scope) => {
        const p = this.parse(PaymentBody, raw);
        const b = await this.repos.bills.get(tx, billId, scope);
        left = balanceOf(b);
        if (!left) throw badRequest("This bill is fully paid.");
        if (p.amount > left) throw badRequest(`That is more than what is owed (Rs. ${left}).`);
        if (p.paidOn > nepalDay()) throw badRequest("The payment date is in the future.");
        // Counted only if nothing was paid on the bill meanwhile, so a double click can't pay it twice.
        if (!(await this.repos.bills.addPaid(tx, b.id, scope, p.amount, { paidIs: b.paid }))) throw badRequest("The bill changed. Open it again.");
        bill = b;
        return this.repos.payments.create(tx, { branchId: b.branchId, billId: b.id, amount: p.amount, method: p.method, paidOn: dayOf(p.paidOn), ref: orNullText(p.ref), note: orNullText(p.note) });
      },
    }).then((payment) => ({ payment, no: billNo(bill!.seq), amount: payment.amount, left }));
  }

  // ───── Remove a confirmed payment (its amount comes off the bill) ─────

  override remove(ctx: BusinessContext, id: string, version?: number): Promise<void> {
    return this.action<PaymentRow>(ctx, {
      name: "remove", permission: this.deps.permissions.delete,
      audit: (p) => ({ action: "rental.payment_removed", target: `Rs. ${p.amount} on ${day(p.paidOn)}` }),
      event: (p) => ({ name: RENT_EVENTS.paymentRemoved, payload: paymentPayload(p) }),
      run: async (tx, scope) => {
        const p = await this.repos.payments.get(tx, id, scope);
        if (p.status !== "confirmed") throw badRequest("Only a confirmed payment can be removed. Reject a waiting one instead.");
        if (p.collectedBy === "sheetal") throw badRequest("Sheetal Property received this payment. Ask Sheetal to undo it.");
        this.sameVersion(p, version, "This payment");
        if (!(await this.repos.bills.removePaid(tx, p.billId, scope, p.amount))) throw badRequest("The bill changed. Open it again.");
        await this.repos.payments.remove(tx, p.id, scope);
        return p;
      },
    }).then(() => undefined);
  }

  // ───── Online payments: the business confirms what was paid to its own account; Sheetal confirms the rest ─────

  /** The waiting payment, which must be one the business received (Sheetal checks and confirms the ones paid to Sheetal). */
  private async onlineOf(tx: BusinessContext, id: string, scope: DataScope): Promise<PaymentRow> {
    const p = await this.repos.payments.get(tx, id, scope);
    if (p.collectedBy === "sheetal") throw forbidden("This was paid to Sheetal Property, so Sheetal checks and confirms it.");
    return p;
  }

  confirm(ctx: BusinessContext, id: string, raw: unknown): Promise<{ no: string; amount: number }> {
    let no = "";
    return this.action<PaymentRow>(ctx, {
      name: "confirm", permission: this.deps.permissions.update,
      audit: (p) => ({ action: "rental.payment_confirmed", target: `${no} Rs. ${p.amount} online` }),
      event: (p) => ({ name: RENT_EVENTS.paymentConfirmed, payload: paymentPayload(p) }),
      run: async (tx, scope) => {
        const version = versionIn(raw);
        const p = await this.onlineOf(tx, id, scope);
        if (p.status !== "pending") throw badRequest(p.status === "confirmed" ? "This payment is already confirmed." : "This payment was rejected.");
        this.sameVersion(p, version, "This payment");
        const b = await this.repos.bills.get(tx, p.billId, scope);
        no = billNo(b.seq);
        if (!(await this.repos.payments.decide(tx, p.id, scope, { status: "confirmed", reviewedBy: actorIdOf(tx), reviewedAt: tx.now }))) throw badRequest("Someone already decided on this payment.");
        // Counted on the bill only if that doesn't pay more than is owed (a failure here undoes the confirmation above: one transaction).
        if (!(await this.repos.bills.addPaid(tx, b.id, scope, p.amount, { paidAtMost: b.amount + b.lateFee - p.amount }))) throw badRequest("This would pay more than is owed on the bill. Reject it, or ask the tenant.");
        return this.repos.payments.get(tx, p.id, scope);
      },
    }).then((p) => ({ no, amount: p.amount }));
  }

  reject(ctx: BusinessContext, id: string, raw: unknown): Promise<void> {
    let note = "";
    return this.action<PaymentRow>(ctx, {
      name: "reject", permission: this.deps.permissions.update,
      audit: () => ({ action: "rental.payment_rejected", target: note }),
      event: (p) => ({ name: RENT_EVENTS.paymentRejected, payload: paymentRejectedPayload(p) }),
      run: async (tx, scope) => {
        const b = this.parse(RejectBody, raw);
        const version = versionIn(raw);
        const p = await this.onlineOf(tx, id, scope);
        this.sameVersion(p, version, "This payment");
        note = b.note;
        if (!(await this.repos.payments.decide(tx, p.id, scope, { status: "rejected", reviewedBy: actorIdOf(tx), reviewedAt: tx.now, reviewNote: b.note }))) throw badRequest("Only a waiting payment can be rejected.");
        return this.repos.payments.get(tx, p.id, scope);
      },
    }).then(() => undefined);
  }

  /** The tenant's screenshot of an online payment (a private file). */
  async proof(ctx: BusinessContext, id: string): Promise<{ type: string; data: string }> {
    this.requireApp(ctx);
    const scope = ctx.permissions.require(this.deps.permissions.read);
    const p = await this.repos.payments.get(ctx, id, scope);
    const f = p.proofFile ? await readPrivateFile(this.x.mediaDir(), "proofs", p.proofFile) : null;
    if (!f) throw notFound("No screenshot was sent with this payment.");
    return { type: f.type, data: f.data.toString("base64") };
  }
}
