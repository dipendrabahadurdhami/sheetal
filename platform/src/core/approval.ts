// The two small types BaseService needs for maker-checker approvals (ACCESS.md section 9): what an action asks, and the gate that decides.
// Where it fits: BaseService.action({ approval }) (core/service.ts) calls `deps.approvals.intercept()`; the real gate is ApprovalService
// (platform/src/approvals/service.ts). Kept here, with no database code, so the kernel core does not import the approvals module.
// How it works: an action that moves money or changes people names itself (`action`, the same text as in the manifest's `approvals` list), says what
// it is about, and hands over the validated input it will run with (`payload`). The gate answers null ("run it now": no rule, rule off, amount under the
// limit, or nobody else could approve) or { approvalId } ("stored, a second person must decide"). In that case the service throws
// ApprovalRequested, which the error handler turns into the 202 answer { message: "Sent for approval.", data: { approvalId } }.
// Rules: an action that runs again after approval carries `ctx.approval` and is never held a second time.

import { AppError } from "./errors.js";
import type { BusinessContext } from "./context.js";
import type { Money } from "./money.js";

/** What an action tells the gate (ACCESS.md section 9.4 step 2). */
export interface ApprovalSpec {
  /** The manifest's approvals[].action, e.g. "expenses.expense.confirm". */
  action: string;
  /** For rules with a limit: below it the action runs straight away. Without an amount, a rule that has a limit holds the action. */
  amount?: Money;
  /** What it is about ("expense") and, when it is one record, its id: a second request for the same record is refused while one is waiting. */
  resource?: string;
  resourceId?: string | null;
  /** The branch of the record: who may approve, and who is told. */
  branchId?: string | null;
  /** The validated input the registered executor will run with after approval. Plain JSON (no dates, no BigInt). */
  payload?: unknown;
  /** A line from the maker shown to the checker. */
  note?: string;
}

export interface ApprovalGate {
  /** null = run the action now; { approvalId } = it was stored and waits for a second person. */
  intercept(ctx: BusinessContext, spec: ApprovalSpec): Promise<{ approvalId: string } | null>;
}

/** Thrown by BaseService.action() after the request is stored. HTTP answer: 202 { message, code: "approval_requested", data: { approvalId } }. */
export class ApprovalRequested extends AppError {
  constructor(readonly approvalId: string) {
    super(202, "approval_requested", "Sent for approval.", undefined, { approvalId });
  }
}
