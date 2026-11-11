// The rules of expenses and recurring expenses (KERNEL.md 10.3).
// Where it fits: the controllers call these; they call the repositories. Every write runs in ONE transaction: the row, the audit line (same action strings and
// target text as before) and the event (names from the manifest).
// How it works: ExpenseService = the standard operations (create, update) plus remove() (a draft made by a recurring expense is skipped, anything else is
// soft-deleted), confirm, the receipt, the list page and profit. RecurringExpenseService = create, update, pause, resume, stop. Permissions are the new names
// (expenses.expense.read …); a role that still holds the old names (expenses.view / expenses.manage) passes through the alias layer with the same abilities.
// Rules: the order of the checks is the old one (permission, input, row found, category rule). `version` is optional: a stale one answers 409, a missing one
// saves as today (last write wins) until the new page sends it (P1-FE-2). Amounts are written in rupees AND paisa; the API shows whole rupees.

import { badRequest, notFound, versionConflict } from "@sheetal/platform/core/errors";
import { actorIdOf, type BusinessContext, type DataScope } from "@sheetal/platform/core/context";
import type { EventBus } from "@sheetal/platform/core/events";
import { BaseService, type WriteKind } from "@sheetal/platform/core/service";
import { readPrivateFile, savePrivateFile } from "@sheetal/backend-core/lib/files";
import { dayOf } from "@sheetal/backend-core/domain/money";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import { EXPENSE_METHODS, expenseCategories, expenseNo } from "./categories.js";
import { confirmedPayload, deletedPayload, EXPENSE_EVENTS, skippedPayload, updatedPayload } from "./events.js";
import { ExpenseRepository, RecurringExpenseRepository } from "./expense.repository.js";
import { amountColumns, rupeesOf } from "./money.js";
import { present } from "./presenter.js";
import { monthSpan, monthsBetween, profitRows } from "./profit.js";
import {
  ConfirmBody, CreateExpenseSchema, CreateRecurringSchema, ListQuery, ProfitQuery, ReceiptBody, UpdateExpenseSchema, UpdateRecurringSchema, versionIn,
  type ExpenseChange, type ExpenseCreate, type RecurringChange, type RecurringCreate,
} from "./schemas.js";
import type { ExpenseRow, RecurringExpenseRow } from "./types.js";

export interface ExpenseServiceDeps {
  bus: EventBus;
  /** MEDIA_DIR of the app config (where private receipts are kept). */
  mediaDir(): string | undefined;
  /** Adds the due drafts of one business (the page does it when it opens; creating a recurring expense does it at once). */
  generateDue(tenantId: string): Promise<unknown>;
}

const no = (e: { seq: number }) => expenseNo(e.seq);
const label = (e: ExpenseRow) => `${no(e)} Rs. ${rupeesOf(e)}`;

/** Per-action flags for the screen: each is "does this person hold the permission". (The data scope is not a flag: the list is already limited to it.) */
export function expenseFlags(ctx: Pick<BusinessContext, "permissions">) {
  const can = (p: string) => ctx.permissions.can(p);
  return {
    create: can("expenses.expense.create"), update: can("expenses.expense.update"), delete: can("expenses.expense.delete"), confirm: can("expenses.expense.confirm"),
    receipt: can("expenses.expense.update"), profit: can("expenses.profit.read"),
    recurringRead: can("expenses.recurring.read"), recurringCreate: can("expenses.recurring.create"), recurringUpdate: can("expenses.recurring.update"), recurringStop: can("expenses.recurring.stop"),
  };
}

/** The category must be one of the business's list; "Other" needs a short note. */
async function checkCategory(ctx: BusinessContext, category: string, note?: string | null) {
  if (!(await expenseCategories(ctx.db)).some((c) => c.id === category)) throw badRequest("Choose a category from the list.");
  if (category === "other" && (note ?? "").trim().length < 3) throw badRequest("Say what \"Other\" is for, in a few words.");
}

export class ExpenseService extends BaseService<ExpenseRow, ExpenseCreate, ExpenseChange> {
  constructor(private readonly x: ExpenseServiceDeps) {
    super({
      app: "expenses", resource: "expense", repo: new ExpenseRepository(),
      permissions: { read: "expenses.expense.read", create: "expenses.expense.create", update: "expenses.expense.update", delete: "expenses.expense.delete" },
      schemas: { create: CreateExpenseSchema, update: UpdateExpenseSchema },
      audit: {
        entity: "expense", label,
        updateLabel: (before, after) => `${no(before)} Rs. ${rupeesOf(before)} → ${rupeesOf(after)}`,
        actions: { created: "expense.added", updated: "expense.changed", deleted: "expense.deleted" },
      },
      events: { created: EXPENSE_EVENTS.confirmed, updated: EXPENSE_EVENTS.updated, deleted: EXPENSE_EVENTS.deleted },
      bus: x.bus,
      requireVersion: false,   // Phase 1: the page does not send `version` yet; a stale one still gets 409 (P1-FE-2 makes it send it)
    });
  }

  protected override async beforeCreate(ctx: BusinessContext, data: ExpenseCreate): Promise<ExpenseCreate> {
    await checkCategory(ctx, data.category, data.note);
    return { ...data, status: "confirmed", confirmedBy: actorIdOf(ctx), confirmedAt: ctx.now };
  }
  protected override async beforeUpdate(ctx: BusinessContext, current: ExpenseRow, data: ExpenseChange): Promise<ExpenseChange> {
    if (current.status === "skipped") throw notFound("Expense not found.");   // a skipped draft is out of the way, as before
    await checkCategory(ctx, data.category ?? current.category, data.note);
    return data;
  }
  protected override eventPayload(row: ExpenseRow, kind: WriteKind, before?: ExpenseRow): object {
    return kind === "created" ? confirmedPayload(row) : kind === "updated" ? updatedPayload(row, before) : deletedPayload(row);
  }

  // ───── The list page: rows, the draft count, the category list ─────

  async overview(ctx: BusinessContext, rawQuery: unknown) {
    this.requireApp(ctx);
    const scope = ctx.permissions.require("expenses.expense.read", "Your role can't see expenses.");
    const q = ListQuery.parse(rawQuery);
    await this.x.generateDue(ctx.business.id);
    const filters = [
      q.status === "all" ? { field: "status", op: "in" as const, value: ["confirmed", "draft"] } : { field: "status", op: "eq" as const, value: q.status },
      ...(q.month ? [{ field: "spentOn", op: "between" as const, value: [dayOf(monthSpan(q.month).first), dayOf(monthSpan(q.month).last)] }] : []),
      ...(q.category ? [{ field: "category", op: "eq" as const, value: q.category }] : []),
    ];
    const [page, drafts, categories] = await Promise.all([
      this.deps.repo.list(ctx, scope, { page: q.page, per: q.per, filters }),
      this.deps.repo.count(ctx, scope, [{ field: "status", op: "eq", value: "draft" }]),
      expenseCategories(ctx.db),
    ]);
    const names = new Map(ctx.branches.mine.map((b) => [b.id, b.name]));
    return {
      canManage: ctx.permissions.can("expenses.expense.create"), categories, methods: EXPENSE_METHODS, drafts, rows: page.rows.map((e) => present(e, names)),
      /** What this person may do, per action, so the screen stops guessing from the role (P1-BE-7). The controller puts it in `meta.can`. */
      can: expenseFlags(ctx),
      /** Only when the caller asked for a page (page/per): the old call has no meta. */
      meta: q.page === undefined && q.per === undefined ? undefined : page.meta,
    };
  }

  // ───── Delete: a recurring draft is skipped, anything else is soft-deleted ─────

  override async remove(ctx: BusinessContext, id: string, version?: number): Promise<void> { await this.discard(ctx, id, version); }

  async discard(ctx: BusinessContext, id: string, version?: number): Promise<{ no: string; skipped: boolean }> {
    this.refuseReadOnly(ctx);
    this.requireApp(ctx);
    const scope = ctx.permissions.require(this.deps.permissions.delete, "Your role can't add or change expenses.");
    return this.inTransaction(ctx, async (tx) => {
      const current = await this.deps.repo.get(tx, id, scope);
      if (current.status === "skipped") throw notFound("Expense not found.");
      if (current.recurringId) {
        // Not deleted: "skipped" keeps the month from being added twice.
        const done = await this.deps.repo.transition(tx, id, { status: current.status, ...(version === undefined ? {} : { version }) }, { status: "skipped" }, scope);
        if (!done) throw versionConflict("This expense");
        await this.writeAudit(tx, "expense.skipped", label(current));
        await this.deps.bus.publish(tx, EXPENSE_EVENTS.skipped, skippedPayload(current), 1, { branchId: current.branchId });
        return { no: no(current), skipped: true };
      }
      await this.deps.repo.softDelete(tx, id, scope, version);
      await this.wrote(tx, current, "deleted");
      return { no: no(current), skipped: false };
    });
  }

  // ───── Confirm a draft (the amount and more can be changed first) ─────

  confirm(ctx: BusinessContext, id: string, raw: unknown): Promise<ExpenseRow> {
    return this.action<ExpenseRow>(ctx, {
      name: "confirm", permission: "expenses.expense.confirm",
      audit: (r) => ({ action: "expense.confirmed", target: label(r) }),
      event: (r) => ({ name: EXPENSE_EVENTS.confirmed, payload: confirmedPayload(r) }),
      run: async (tx, scope) => {
        const b = ConfirmBody.parse(raw ?? {});
        const version = versionIn(raw);
        const e = await this.deps.repo.get(tx, id, scope);
        if (e.status === "skipped") throw notFound("Expense not found.");
        if (e.status !== "draft") throw badRequest("Only a draft can be confirmed.");
        if (version !== undefined && version !== e.version) throw versionConflict("This expense");
        const rupees = b.amount ?? rupeesOf(e);
        const next = {
          spentOn: b.date ? dayOf(b.date) : e.spentOn, category: b.category ?? e.category, ...amountColumns(rupees),
          vendor: b.vendor === undefined ? e.vendor : b.vendor || null, note: b.note === undefined ? e.note : b.note || null, method: b.method ?? e.method,
        };
        await checkCategory(tx, next.category, next.note);
        // Taken only if it is still a draft (and still this version), so two people confirming at once confirm it once.
        const took = await this.deps.repo.transition(tx, id, { status: "draft", version: e.version }, { ...next, status: "confirmed", confirmedBy: actorIdOf(tx), confirmedAt: tx.now }, scope);
        if (!took) throw badRequest("Someone already confirmed this expense.");
        return this.deps.repo.get(tx, id, scope);
      },
    });
  }

  // ───── Receipt: a photo or PDF, kept private ─────

  async attachReceipt(ctx: BusinessContext, id: string, raw: unknown): Promise<void> {
    this.refuseReadOnly(ctx);
    this.requireApp(ctx);
    const scope = ctx.permissions.require("expenses.expense.update", "Your role can't add or change expenses.");
    const e = await this.visible(ctx, id, scope);
    const b = ReceiptBody.parse(raw);
    const receiptFile = await savePrivateFile(this.x.mediaDir(), "expenses", Buffer.from(b.data, "base64"));
    await this.deps.repo.update(ctx, e.id, { receiptFile }, scope);
  }

  async readReceipt(ctx: BusinessContext, id: string): Promise<{ type: string; data: string }> {
    this.requireApp(ctx);
    const scope = ctx.permissions.require("expenses.expense.read", "Your role can't see expenses.");
    const e = await this.visible(ctx, id, scope);
    const f = e.receiptFile ? await readPrivateFile(this.x.mediaDir(), "expenses", e.receiptFile) : null;
    if (!f) throw notFound("This expense has no receipt.");
    return { type: f.type, data: f.data.toString("base64") };
  }

  async removeReceipt(ctx: BusinessContext, id: string): Promise<void> {
    this.refuseReadOnly(ctx);
    this.requireApp(ctx);
    const scope = ctx.permissions.require("expenses.expense.update", "Your role can't add or change expenses.");
    const e = await this.visible(ctx, id, scope);
    await this.deps.repo.update(ctx, e.id, { receiptFile: null }, scope);
  }

  private async visible(ctx: BusinessContext, id: string, scope: DataScope): Promise<ExpenseRow> {
    const e = await this.deps.repo.get(ctx, id, scope);
    if (e.status === "skipped") throw notFound("Expense not found.");
    return e;
  }

  // ───── Profit by month and branch ─────

  async profit(ctx: BusinessContext, rawQuery: unknown) {
    this.requireApp(ctx);
    const scope = ctx.permissions.require("expenses.profit.read", "Your role can't see expenses.");
    const now = nepalDay().slice(0, 7);
    const q = ProfitQuery.parse(rawQuery);
    const to = q.to ?? now;
    // The last 12 months unless asked otherwise.
    let [fy, fm] = to.split("-").map(Number) as [number, number];
    fm -= 11; if (fm < 1) { fm += 12; fy--; }
    const from = q.from ?? `${fy}-${String(fm).padStart(2, "0")}`;
    if (from > to) throw badRequest("The first month is after the last month.");
    if (monthsBetween(from, to).length > 36) throw badRequest("Choose up to 36 months.");
    const rows = await profitRows(ctx.db, { tenantId: ctx.business.id, branchIds: ctx.branches.idsFor(scope) as string[] | null, branchNames: new Map(ctx.branches.mine.map((b) => [b.id, b.name])), from, to });
    const sum = (k: "direct" | "vat" | "payouts" | "commission" | "expenses" | "profit") => rows.reduce((s, r) => s + r[k], 0);
    return { from, to, rows, totals: { direct: sum("direct"), vat: sum("vat"), payouts: sum("payouts"), commission: sum("commission"), expenses: sum("expenses"), profit: sum("profit") } };
  }
}

// ═════════════════════════ Recurring expenses ═════════════════════════

const ACTIONS = {
  pause: { from: ["active"], to: "paused", permission: "expenses.recurring.update", said: "Paused. No drafts are made until you resume it." },
  resume: { from: ["paused"], to: "active", permission: "expenses.recurring.update", said: "Resumed." },
  stop: { from: ["active", "paused"], to: "stopped", permission: "expenses.recurring.stop", said: "Stopped. Its past expenses stay in your records." },
} as const;
export type RecurringAction = keyof typeof ACTIONS;

const recurringLabel = (r: RecurringExpenseRow) => `${r.category} Rs. ${rupeesOf(r)}`;

export class RecurringExpenseService extends BaseService<RecurringExpenseRow, RecurringCreate, RecurringChange> {
  constructor(private readonly x: Pick<ExpenseServiceDeps, "bus" | "generateDue">) {
    super({
      app: "expenses", resource: "recurring", repo: new RecurringExpenseRepository(),
      // `delete` is only the type's fourth slot: there is no delete route; a recurring expense is stopped, never removed.
      permissions: { read: "expenses.recurring.read", create: "expenses.recurring.create", update: "expenses.recurring.update", delete: "expenses.recurring.stop" },
      schemas: { create: CreateRecurringSchema, update: UpdateRecurringSchema },
      audit: {
        entity: "expense", label: (r) => `${r.category} Rs. ${rupeesOf(r)} on day ${r.dayOfMonth}`,
        updateLabel: (before, after) => `${before.category} Rs. ${rupeesOf(before)} → ${rupeesOf(after)}`,
        actions: { created: "expense.recurring_added", updated: "expense.recurring_changed" },
      },
      events: { created: null, updated: null, deleted: null, restored: null },   // the manifest lists only recurring.draft_created
      bus: x.bus,
      requireVersion: false,
    });
  }

  protected override async beforeCreate(ctx: BusinessContext, data: RecurringCreate): Promise<RecurringCreate> {
    await checkCategory(ctx, data.category, data.note);
    return data;
  }
  protected override async beforeUpdate(ctx: BusinessContext, current: RecurringExpenseRow, data: RecurringChange): Promise<RecurringChange> {
    if (current.status === "stopped") throw badRequest("A stopped recurring expense can't be changed.");
    await checkCategory(ctx, data.category ?? current.category, data.note);
    return data;
  }

  /** The list (all of them, as the page reads it). */
  async all(ctx: BusinessContext): Promise<RecurringExpenseRow[]> { return (await this.list(ctx, {})).rows; }

  /** Creating one makes this month's draft at once if its day has come. */
  override async create(ctx: BusinessContext, raw: unknown): Promise<RecurringExpenseRow> {
    const row = await super.create(ctx, raw);
    await this.x.generateDue(ctx.business.id);
    return row;
  }

  /** pause / resume / stop: a compare-and-set on the status, so two people acting at once act once. */
  async act(ctx: BusinessContext, id: string, which: RecurringAction, raw: unknown): Promise<string> {
    const a = ACTIONS[which];
    await this.action<RecurringExpenseRow>(ctx, {
      name: which, permission: a.permission,
      audit: (r) => ({ action: `expense.recurring_${a.to}`, target: recurringLabel(r) }),
      run: async (tx, scope) => {
        const r = await this.deps.repo.get(tx, id, scope);
        const version = versionIn(raw);
        if (version !== undefined && version !== r.version) throw versionConflict("This recurring expense");
        let took = false;
        for (const from of a.from) {
          if (took) break;
          took = await this.deps.repo.transition(tx, id, { status: from, version: r.version }, { status: a.to }, scope);
        }
        if (!took) throw badRequest(r.status === "stopped" ? "It is already stopped." : `It can't be ${a.to === "active" ? "resumed" : a.to} now.`);
        return r;
      },
    });
    if (a.to === "active") await this.x.generateDue(ctx.business.id);
    return a.said;
  }
}
