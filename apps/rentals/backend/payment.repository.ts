// The only code that reads and writes the rent_payments table (money received against a bill).
// Where it fits: PaymentService and OverviewService call it. The website writes the online payments (domain code in rentpay.ts); this repository only reads and decides them.
// How it works: a RentalRepository on model "rentPayment". A payment is "confirmed" (counts on the bill), "pending" (sent online, waiting to be checked) or "rejected".
// Named methods: `ofBill` (a bill's payments, oldest first) and `decide` (the compare-and-set that confirms or rejects a waiting payment once).
// Rules: `remove` is a soft delete (P2-W6), after the service takes its amount off the bill; the website's "my rent" page, the admin's rent-payment list, online-payment
// decisions and the owner statement all skip deleted payments. The audit line keeps the record.
// A pending payment never counts until it is confirmed.

import type { BusinessContext, DataScope } from "@sheetal/platform/core/context";
import { RentalRepository } from "./rental.repository.js";
import type { Change, NewRow, PaymentRow } from "./types.js";

export type PaymentCreate = NewRow<PaymentRow, "status" | "source" | "collectedBy" | "proofFile" | "userId" | "reviewedBy" | "reviewedAt" | "reviewNote">;
export type PaymentChange = Change<PaymentRow>;

export class PaymentRepository extends RentalRepository<PaymentRow, PaymentCreate, PaymentChange> {
  constructor() {
    super({
      model: "rentPayment", ownerField: null, label: "This payment",
      filterable: { branchId: ["eq", "in"], billId: ["eq", "in"], status: ["eq", "in"], collectedBy: ["eq"] },
      sortable: ["paidOn", "createdAt"],
      defaultSort: [{ field: "createdAt", dir: "asc" }],
      maxPerPage: 500,                                       // the page showed up to 500 waiting payments
      legacyMaxRows: 5000,
    }, "Payment not found.");
  }

  /** A bill's payments, oldest first (as the bill's detail shows them). */
  async ofBill(ctx: BusinessContext, scope: DataScope, billId: string): Promise<PaymentRow[]> {
    return (await this.list(ctx, scope, { filters: [{ field: "billId", op: "eq", value: billId }], sort: [{ field: "paidOn", dir: "asc" }] })).rows;
  }

  /** Confirms or rejects a payment only if it is still waiting. Returns whether this call decided it. */
  decide(ctx: BusinessContext, id: string, scope: DataScope, to: { status: "confirmed" | "rejected"; reviewedBy: string | null; reviewedAt: Date; reviewNote?: string }): Promise<boolean> {
    return this.transition(ctx, id, { status: "pending" }, to, scope);
  }

  /** Real delete (see the header). */
  remove(ctx: BusinessContext, id: string, scope: DataScope): Promise<void> { return this.softDeleteRow(ctx, id, scope); }
}
