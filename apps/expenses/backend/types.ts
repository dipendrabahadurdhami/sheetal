// The two table rows of Expenses as the repositories hand them out.
// Where it fits: the type parameter of the repositories and services; the fields are the Prisma columns (backend-core/prisma/schema.prisma, models Expense and RecurringExpense).
// How it works: both extend BranchEntity (id, version, createdBy/updatedBy, deletedAt/deletedBy, tenantId, branchId). `amountPaisa` is BigInt? because rows older than
// the paisa backfill have NULL there; read an amount only through money.ts.
// Rules: types only; no code.

import type { BranchEntity } from "@sheetal/platform/core/repository";

export interface ExpenseRow extends BranchEntity {
  seq: number; status: string; spentOn: Date; category: string; amount: number; amountPaisa: bigint | null;
  vendor: string | null; note: string | null; method: string; receiptFile: string | null; recurringId: string | null; forMonth: string | null;
  confirmedBy: string | null; confirmedAt: Date | null;
}

export interface RecurringExpenseRow extends BranchEntity {
  status: string; category: string; amount: number; amountPaisa: bigint | null; vendor: string | null; note: string | null; method: string; dayOfMonth: number; startMonth: string;
}
