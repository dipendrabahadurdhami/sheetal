// The only code that reads and writes the expenses and recurring_expenses tables (KERNEL.md 10.2).
// Where it fits: ExpenseService and RecurringExpenseService call these; nothing else in the app touches the two Prisma delegates.
// How it works: both extend BaseRepository, so every query is limited to the business, hides deleted rows and follows the branch scope. A normal expense is
// deleted by setting deletedAt (soft delete); a draft made by a recurring expense is "skipped" instead (a status), which keeps the month from being added twice.
// Two named methods exist because they are not normal creates/reads: createDraftIfMissing (the job's insert, one draft per recurring expense and month) and
// dueTemplates (the job reads the templates of EVERY business, so it is the one read here that is not limited to one business; it only runs from the job).
// Rules: a missing or out-of-scope row answers "Expense not found." (the same 404 as before); no hard delete.

import type { Tx, BusinessContext, DataScope } from "@sheetal/platform/core/context";
import { notFound } from "@sheetal/platform/core/errors";
import { BaseRepository } from "@sheetal/platform/core/repository";
import type { Db } from "@sheetal/platform/db/client";
import { dayOf } from "@sheetal/backend-core/domain/money";
import { paisaOfRow } from "./money.js";
import type { ExpenseChange, ExpenseCreate, RecurringChange, RecurringCreate } from "./schemas.js";
import type { ExpenseRow, RecurringExpenseRow } from "./types.js";

export class ExpenseRepository extends BaseRepository<ExpenseRow, ExpenseCreate, ExpenseChange> {
  constructor() {
    super({
      model: "expense", ownerField: "createdBy", label: "This expense",
      filterable: { status: ["eq", "in"], spentOn: ["gte", "lte", "between"], category: ["eq", "in"], branchId: ["eq", "in"] },
      sortable: ["spentOn", "seq", "createdAt"],
      defaultSort: [{ field: "spentOn", dir: "desc" }, { field: "seq", dir: "desc" }],   // the order the page has today
      legacyMaxRows: 2000,                                                              // GET /expenses without page/per: up to 2000 rows, as the page expects
    });
  }

  override async get(ctx: BusinessContext, id: string, scope: DataScope, opts: { includeDeleted?: boolean } = {}): Promise<ExpenseRow> {
    const row = await this.find(ctx, id.slice(0, 40), scope, opts);
    if (!row) throw notFound("Expense not found.");
    return row;
  }

  /** The job's insert: one draft per recurring expense and month (unique on recurringId + forMonth, so a skipped or deleted draft still blocks a second one).
   *  Returns the new draft's id, or null when this month already has one. Takes the database (or a transaction) because the job has no request. */
  async createDraftIfMissing(db: Db | Tx, t: RecurringExpenseRow, month: string): Promise<string | null> {
    const made = await db.expense.createMany({
      data: [{
        tenantId: t.tenantId, branchId: t.branchId, status: "draft", spentOn: dayOf(`${month}-${String(t.dayOfMonth).padStart(2, "0")}`), category: t.category,
        amount: t.amount, amountPaisa: BigInt(paisaOfRow(t)), vendor: t.vendor, note: t.note, method: t.method, recurringId: t.id, forMonth: month,
        createdBy: t.createdBy, version: 1,
      }],
      skipDuplicates: true,
    });
    if (!made.count) return null;
    return (await db.expense.findFirst({ where: { recurringId: t.id, forMonth: month }, select: { id: true } }))?.id ?? null;
  }
}

export class RecurringExpenseRepository extends BaseRepository<RecurringExpenseRow, RecurringCreate, RecurringChange> {
  constructor() {
    super({
      model: "recurringExpense", ownerField: "createdBy", label: "This recurring expense",
      filterable: { status: ["eq", "in"], branchId: ["eq", "in"] },
      sortable: ["status", "createdAt"],
      defaultSort: [{ field: "status", dir: "asc" }, { field: "createdAt", dir: "desc" }],   // the order the page has today
      legacyMaxRows: 5000,                                                                   // the old list had no limit; templates are few
    });
  }

  override async get(ctx: BusinessContext, id: string, scope: DataScope, opts: { includeDeleted?: boolean } = {}): Promise<RecurringExpenseRow> {
    const row = await this.find(ctx, id.slice(0, 40), scope, opts);
    if (!row) throw notFound("Recurring expense not found.");
    return row;
  }

  /** Active, not deleted recurring expenses whose day has come this month. tenantId limits it to one business (the page asks for its own). */
  dueTemplates(db: Db, o: { month: string; dueDay: number; tenantId?: string }): Promise<RecurringExpenseRow[]> {
    return db.recurringExpense.findMany({
      where: { status: "active", deletedAt: null, startMonth: { lte: o.month }, dayOfMonth: { lte: o.dueDay }, ...(o.tenantId ? { tenantId: o.tenantId } : {}) },
    }) as Promise<RecurringExpenseRow[]>;
  }
}
