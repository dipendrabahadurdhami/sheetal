// Tests of the parts of Expenses that need no database: money columns, the screen's input rules, the profit helpers, events and the Phase 1 scope cap.
// Where it fits: runs with the app's own tests: npm run test -w @sheetal/app-expenses (no PostgreSQL needed).
// How it works: plain functions in, plain values out. The database-backed checks are in business/backend/test/expenses.test.ts (the old 13) and expenses-kernel.test.ts.
// Rules: a change to a message or a number here is a change the screen will show; update the old page's expectations first.
import { describe, expect, it } from "vitest";
import { forbidden } from "@sheetal/platform/core/errors";
import type { PermissionSet } from "@sheetal/platform/core/context";
import { expenseNo } from "../categories.js";
import { confirmedPayload, deletedPayload, skippedPayload, updatedPayload } from "../events.js";
import { amountColumns, paisaOf, paisaOfRow, rupeesOf } from "../money.js";
import { present, presentRecurring } from "../presenter.js";
import { monthSpan, monthsBetween, paymentSplit } from "../profit.js";
import { cappedPermissions } from "../scope.js";
import { CreateExpenseSchema, CreateRecurringSchema, UpdateExpenseSchema, UpdateRecurringSchema, versionIn } from "../schemas.js";
import type { ExpenseRow, RecurringExpenseRow } from "../types.js";

const base = { tenantId: "t1", branchId: "b1", version: 3, createdAt: new Date("2026-11-01"), updatedAt: new Date("2026-11-01"), createdBy: "u1", updatedBy: "u1", deletedAt: null, deletedBy: null };
const expense = (over: Partial<ExpenseRow> = {}): ExpenseRow => ({
  ...base, id: "e1", seq: 7, status: "confirmed", spentOn: new Date("2026-10-10T00:00:00Z"), category: "rent", amount: 1_500, amountPaisa: 150_000n, vendor: null, note: null, method: "bank",
  receiptFile: null, recurringId: null, forMonth: null, confirmedBy: "u1", confirmedAt: new Date("2026-10-10"), ...over,
});

describe("money columns", () => {
  it("writes rupees and paisa together", () => {
    expect(amountColumns(1_200)).toEqual({ amount: 1_200, amountPaisa: 120_000n });
    expect(paisaOf(2_000_000_000)).toBe(200_000_000_000n);   // the largest allowed expense is far below 2^53 paisa
  });
  it("reads paisa, and falls back to rupees for a row the backfill has not reached", () => {
    expect(paisaOfRow({ amount: 5, amountPaisa: 777_00n })).toBe(77_700);
    expect(paisaOfRow({ amount: 5, amountPaisa: null })).toBe(500);
    expect(rupeesOf({ amount: 5, amountPaisa: null })).toBe(5);
    expect(rupeesOf({ amount: 5, amountPaisa: 700n })).toBe(7);
  });
});

describe("the screen's input", () => {
  const ok = { date: "2026-10-10", category: "rent", amount: 20_000, method: "bank", branchId: "b1" };
  it("turns a new expense into both amount columns and a Date, blank text into null", () => {
    expect(CreateExpenseSchema.parse({ ...ok, vendor: "", note: "  " })).toEqual({
      branchId: "b1", spentOn: new Date("2026-10-10T00:00:00Z"), category: "rent", amount: 20_000, amountPaisa: 2_000_000n, vendor: null, note: null, method: "bank",
    });
  });
  it("keeps the old messages and limits", () => {
    const msg = (s: { safeParse(v: unknown): { success: boolean; error?: { issues: { message: string }[] } } }, v: unknown) => s.safeParse(v).error?.issues[0]?.message;
    expect(msg(CreateExpenseSchema, { ...ok, amount: 0 })).toBe("The amount must be more than zero.");
    expect(msg(CreateExpenseSchema, { ...ok, amount: 10.5 })).toBe("Use whole rupees.");
    expect(msg(CreateExpenseSchema, { ...ok, date: "2026-02-30" })).toBe("That date doesn't exist.");
    expect(msg(CreateExpenseSchema, { ...ok, date: "soon" })).toBe("Use a date like 2026-11-04.");
    expect(msg(CreateExpenseSchema, { ...ok, method: "gold" })).toBeTruthy();
    expect(msg(CreateRecurringSchema, { category: "rent", amount: 100, dayOfMonth: 31, method: "cash" })).toBe("Choose a day from 1 to 28.");
  });
  it("ignores a branchId and an unknown key on change, and does not move the branch", () => {
    const out = UpdateExpenseSchema.parse({ ...ok, branchId: "elsewhere", version: 2, extra: true });
    expect(out).not.toHaveProperty("branchId");
    expect(out).not.toHaveProperty("version");
    expect(UpdateRecurringSchema.parse({ category: "rent", amount: 100, dayOfMonth: 3, method: "cash", branchId: "x", startMonth: "2026-01" })).not.toHaveProperty("startMonth");
  });
  it("defaults the first month of a recurring expense to this month", () => {
    expect(CreateRecurringSchema.parse({ category: "rent", amount: 100, dayOfMonth: 3 }).startMonth).toMatch(/^\d{4}-\d{2}$/);
    expect(CreateRecurringSchema.parse({ category: "rent", amount: 100, dayOfMonth: 3, startMonth: "2026-01" }).startMonth).toBe("2026-01");
  });
  it("reads the optional version: absent is fine, a bad one is refused", () => {
    expect(versionIn({})).toBeUndefined();
    expect(versionIn(undefined)).toBeUndefined();
    expect(versionIn({ version: 4 })).toBe(4);
    expect(versionIn({ version: "4" })).toBe(4);
    for (const bad of [0, -1, 1.5, "x", true]) expect(() => versionIn({ version: bad })).toThrowError(/out of date/);
  });
});

describe("what the screen gets back", () => {
  const names = new Map([["b1", "Head office"]]);
  it("is the old row, in whole rupees, plus the version", () => {
    expect(present(expense({ vendor: "Landlord" }), names)).toEqual({
      id: "e1", no: "EX-0007", status: "confirmed", date: "2026-10-10", category: "rent", amount: 1_500, vendor: "Landlord", note: "", method: "bank",
      branchId: "b1", branch: "Head office", hasReceipt: false, recurringId: null, forMonth: null, version: 3,
    });
    expect(JSON.stringify(present(expense(), names))).not.toMatch(/Paisa|[0-9]n\b/);   // a BigInt would throw in JSON.stringify anyway
  });
  it("shows a recurring expense the same way", () => {
    const r: RecurringExpenseRow = { ...base, id: "r1", status: "active", category: "rent", amount: 40_000, amountPaisa: 4_000_000n, vendor: null, note: null, method: "bank", dayOfMonth: 1, startMonth: "2026-11" };
    expect(presentRecurring(r, names)).toMatchObject({ id: "r1", amount: 40_000, vendor: "", dayOfMonth: 1, branch: "Head office", version: 3 });
  });
  it("numbers expenses EX-0007", () => { expect(expenseNo(7)).toBe("EX-0007"); expect(expenseNo(12345)).toBe("EX-12345"); });
});

describe("events", () => {
  it("carry ids and paisa as the manifest lists them", () => {
    const e = expense();
    expect(confirmedPayload(e)).toEqual({ expenseId: "e1", branchId: "b1", category: "rent", amountPaisa: 150_000, spentOn: "2026-10-10", method: "bank" });
    expect(updatedPayload(e, expense({ amountPaisa: 100_000n, amount: 1_000 }))).toEqual({ expenseId: "e1", branchId: "b1", amountPaisa: 150_000, previousAmountPaisa: 100_000 });
    expect(deletedPayload(e)).toEqual({ expenseId: "e1", branchId: "b1", amountPaisa: 150_000 });
    expect(skippedPayload(expense({ recurringId: "r1", forMonth: "2026-10" }))).toEqual({ expenseId: "e1", recurringId: "r1", forMonth: "2026-10" });
    JSON.stringify(confirmedPayload(e));   // plain numbers: no BigInt to break the outbox
  });
});

describe("profit helpers (moved unchanged)", () => {
  it("splits a payment in the invoice's own ratio", () => {
    expect(paymentSplit(3_000, { subtotal: 6_500, total: 7_345 })).toEqual({ net: 2_655, vat: 345 });
    expect(paymentSplit(500, { subtotal: 0, total: 0 })).toEqual({ net: 500, vat: 0 });
  });
  it("finds a month's days and a range of months", () => {
    expect(monthSpan("2026-02")).toEqual({ first: "2026-02-01", last: "2026-02-28" });
    expect(monthSpan("2028-02").last).toBe("2028-02-29");
    expect(monthsBetween("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });
});

describe("the Phase 1 scope cap", () => {
  const perms = (scope: "own" | "branch" | "all" | null): PermissionSet => ({
    can: () => scope !== null, scopeOf: () => scope,
    require: (_p, m) => { if (!scope) throw forbidden(m); return scope; }, canAny: () => scope !== null,
  });
  it("narrows 'all' to 'branch' and leaves 'own' alone", () => {
    expect(cappedPermissions(perms("all")).require("expenses.expense.read")).toBe("branch");
    expect(cappedPermissions(perms("branch")).scopeOf("expenses.expense.read")).toBe("branch");
    expect(cappedPermissions(perms("own")).require("expenses.expense.read")).toBe("own");
    expect(cappedPermissions(perms(null)).scopeOf("expenses.expense.read")).toBeNull();
  });
  it("refuses with the old words", () => {
    expect(() => cappedPermissions(perms(null)).require("expenses.expense.read")).toThrowError("Your role can't see expenses.");
    expect(() => cappedPermissions(perms(null)).require("expenses.expense.create")).toThrowError("Your role can't add or change expenses.");
    expect(() => cappedPermissions(perms(null)).require("expenses.profit.read", "own words")).toThrowError("own words");
  });
});
