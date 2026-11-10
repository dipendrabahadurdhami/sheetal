// Test fixture: a repository, service and controller for the real Expense table, used by the kernel tests only.
// Where it fits: platform/test/*.test.ts. It shows the smallest working app on the kernel; the real Expenses app (P1-BE-5) is separate.
// Rules: tests only. Not shipped; nothing outside platform/test imports it.

import { inject } from "vitest";
import { z } from "zod";
import { createDb, type Db } from "../src/db/client.js";
import { BaseController } from "../src/core/controller.js";
import type { BusinessContext } from "../src/core/context.js";
import { OutboxEventBus } from "../src/core/events.js";
import { BaseRepository, type BusinessEntity } from "../src/core/repository.js";
import { BaseService } from "../src/core/service.js";

declare module "vitest" {
  export interface ProvidedContext { databaseUrl: string }
}

export interface ExpenseRow extends BusinessEntity {
  branchId: string; status: string; category: string; amount: number; vendor: string | null; note: string | null;
  spentOn: Date; seq: number; amountPaisa: bigint | null;
}
export type ExpenseCreate = { spentOn: Date; category: string; amount: number; vendor?: string; note?: string; branchId?: string };
export type ExpenseUpdate = { status?: string; category?: string; amount?: number; vendor?: string | null; note?: string | null };

export const testDb = (): Db => createDb(inject("databaseUrl"))!;

export class ExpenseRepo extends BaseRepository<ExpenseRow, ExpenseCreate, ExpenseUpdate> {
  constructor() {
    super({
      model: "expense", ownerField: "createdBy", label: "This expense",
      filterable: { branchId: ["eq", "in"], status: ["eq", "ne"], category: ["eq", "in"], spentOn: ["gte", "lte", "between"] },
      sortable: ["spentOn", "seq", "amount", "createdAt"], defaultSort: [{ field: "spentOn", dir: "desc" }, { field: "seq", dir: "desc" }],
      searchable: ["vendor", "note"],
    });
  }
}

/** The same repository with the bug the isolation test must catch: it forgets the business. */
export class LeakyExpenseRepo extends ExpenseRepo {
  protected override async scopeWhere(_ctx: BusinessContext, _scope: "own" | "branch" | "all", o: { includeDeleted?: boolean } = {}) {
    return o.includeDeleted ? {} : { deletedAt: null };
  }
}

export const CreateExpense = z.object({
  spentOn: z.coerce.date(), category: z.string().min(1), amount: z.number().int().min(0),
  vendor: z.string().optional(), note: z.string().optional(), branchId: z.string().optional(),
}).strict();
export const UpdateExpense = z.object({
  category: z.string().min(1).optional(), amount: z.number().int().min(0).optional(),
  vendor: z.string().nullable().optional(), note: z.string().nullable().optional(), version: z.number().int().optional(),
}).transform(({ version: _v, ...rest }) => rest);

export class ExpenseService extends BaseService<ExpenseRow, ExpenseCreate, ExpenseUpdate> {
  constructor(bus = new OutboxEventBus(), repo = new ExpenseRepo()) {
    super({
      app: "expenses", resource: "expense", repo,
      permissions: { read: "expenses.expense.read", create: "expenses.expense.create", update: "expenses.expense.update", delete: "expenses.expense.delete" },
      schemas: { create: CreateExpense as never, update: UpdateExpense as never },
      audit: { entity: "expense", label: (r) => `EX-${r.seq} Rs. ${r.amount}` },
      bus,
    });
  }
  protected override async beforeDelete(_ctx: BusinessContext, row: ExpenseRow): Promise<void> {
    if (row.status === "draft") throw new Error("A draft is skipped, not deleted.");
  }
  /** An action that is not create/update/delete, to exercise action(). */
  confirm(ctx: BusinessContext, id: string) {
    return this.action(ctx, {
      name: "confirm", permission: "expenses.expense.confirm",
      run: async (c, scope) => {
        const ok = await this.deps.repo.transition(c, id, { status: "draft" }, { status: "confirmed" } as never, scope);
        return { id, ok };
      },
      audit: (r) => ({ action: "expense.confirmed", target: r.id }),
      event: (r) => ({ name: "expenses.expense.confirmed", payload: { id: r.id } }),
    });
  }
}

export class ExpenseController extends BaseController<ExpenseRow, ExpenseCreate, ExpenseUpdate> {}
