// Tests for the Expenses descriptions: columns, form rules ("Other" needs a note, amount, receipt), buttons and permissions, and the version round-trip.
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@sheetal/sdk/client";

vi.mock("@sheetal/ui/primitives", () => ({ Badge: ({ children }) => children }));

import { buildBody, validateFields, visibleFields } from "../../../../packages/ui/src/crud/formRules.js";
import { reactToFailure, removeRecord, runRowAction, submitRecord } from "../../../../packages/ui/src/crud/saveFlow.js";
import { expenseColumns, expenseFields, expenseResource, expenseStats } from "./expense.jsx";
import { recurringColumns, recurringFields, recurringResource } from "./recurring.jsx";
import { METHOD, MAX_AMOUNT, monthLabel } from "./common.js";

const good = { branchId: "", category: "rent", amount: "15000", date: "2026-11-04", method: "cash", vendor: "", note: "", receipt: null };
const check = (fields, over, ctx = {}) => validateFields(visibleFields(fields, { ...good, ...over }, ctx), { ...good, ...over });
const file = (size, type = "application/pdf") => ({ name: "r.pdf", size, type });

describe("expense form", () => {
  it("accepts a normal expense", () => expect(check(expenseFields, {})).toEqual({}));
  it("Other needs a note of 3 or more letters", () => {
    expect(check(expenseFields, { category: "other", note: "" }).note).toBeTruthy();
    expect(check(expenseFields, { category: "other", note: "ab " }).note).toBeTruthy();
    expect(check(expenseFields, { category: "other", note: "Tea" })).toEqual({});
    expect(check(expenseFields, { category: "rent", note: "" })).toEqual({});
  });
  it("the Note label changes to the question once the category is Other", () => {
    const note = expenseFields.find((f) => f.key === "note");
    expect(note.label).toBe("Note");
    expect(note.labelWhen).toEqual({ when: { key: "category", eq: "other" }, label: "What is it for?" });
  });
  it("amount is whole rupees from 1 to 2,000,000,000", () => {
    expect(check(expenseFields, { amount: "" }).amount).toBeTruthy();
    expect(check(expenseFields, { amount: "0" }).amount).toBeTruthy();
    expect(check(expenseFields, { amount: "1" })).toEqual({});
    expect(check(expenseFields, { amount: String(MAX_AMOUNT) })).toEqual({});
    expect(check(expenseFields, { amount: String(MAX_AMOUNT + 1) }).amount).toBeTruthy();
    expect(expenseFields.find((f) => f.key === "amount").type).toBe("money"); // digits only, so no decimals can be typed
  });
  it("receipt: photo or PDF, up to 8 MB", () => {
    expect(check(expenseFields, { receipt: file(8 * 1024 * 1024) })).toEqual({});
    expect(check(expenseFields, { receipt: file(8 * 1024 * 1024 + 1) }).receipt).toBeTruthy();
    expect(check(expenseFields, { receipt: file(100, "text/plain") }).receipt).toBeTruthy();
    expect(check(expenseFields, { receipt: file(100, "image/png") })).toEqual({});
    expect(check(expenseFields, { receipt: { existing: true } })).toEqual({});
  });
  it("the branch drop-down shows only when there are branches to choose from, and is then required", () => {
    expect(visibleFields(expenseFields, good, {}).some((f) => f.key === "branchId")).toBe(false);
    const ctx = { branches: [{ id: "b1", label: "Main" }, { id: "b2", label: "Second" }] };
    expect(visibleFields(expenseFields, good, ctx).some((f) => f.key === "branchId")).toBe(true);
    expect(check(expenseFields, {}, ctx).branchId).toBeTruthy();
    expect(check(expenseFields, { branchId: "b2" }, ctx)).toEqual({});
  });
  it("the request body has trimmed text, null for an empty vendor and no file", () => {
    const body = buildBody(expenseFields, { ...good, vendor: "  Ram  ", note: "", receipt: file(10) });
    expect(body).toEqual({ category: "rent", amount: 15000, date: "2026-11-04", method: "cash", vendor: "Ram", note: null });
  });
  it("categories are listed in English, payment methods are the old seven", () => {
    expect(expenseFields.find((f) => f.key === "category").options).toEqual({ from: "categories", label: "en" });
    expect(Object.keys(METHOD)).toEqual(["cash", "bank", "fonepay", "esewa", "khalti", "card", "other"]);
  });
});

describe("expense list", () => {
  const rows = [{ id: "1", branchId: "b1", status: "confirmed", amount: 100 }, { id: "2", branchId: "b1", status: "draft", amount: 50 }, { id: "3", branchId: "b1", status: "draft", amount: 25 }];
  it("columns: Date, Expense, Paid by, Amount, Status", () => {
    expect(expenseColumns(rows, {}).map((c) => c.label)).toEqual(["Date", "Expense", "Paid by", "Amount", "Status"]);
  });
  it("the third column becomes Branch when the list holds several branches", () => {
    expect(expenseColumns([...rows, { id: "4", branchId: "b2" }], {})[2].label).toBe("Branch");
  });
  it("stats and the draft count", () => {
    const [done, waiting] = expenseStats({}, rows);
    expect(done).toMatchObject({ label: "Confirmed in this list", value: "Rs. 100", note: "1 expenses" });
    expect(waiting).toMatchObject({ label: "To confirm", value: "Rs. 75", note: "2 from recurring expenses", tone: "action" });
    expect(expenseStats({}, [])[1]).toMatchObject({ note: "Nothing waiting", tone: undefined });
  });
  it("filters become the same address as before; empty ones are left out", () => {
    const p = expenseResource.list.params;
    expect(p({ month: "", category: "", status: "" })).toEqual({ status: "all", month: "", category: "" });
    expect(p({ month: "2026-10", category: "rent", status: "draft" })).toEqual({ status: "draft", month: "2026-10", category: "rent" });
  });
});

describe("buttons and permissions", () => {
  const acts = expenseResource.rowActions;
  const draft = { id: "d", no: "EX-0001", status: "draft", recurringId: "r1", hasReceipt: true };
  const confirmed = { id: "c", no: "EX-0002", status: "confirmed", recurringId: null, hasReceipt: false };
  const shown = (r) => acts.filter((a) => !a.when || a.when(r)).map((a) => a.id);
  it("a draft: Receipt, Confirm, Skip; a confirmed expense: Change, Delete", () => {
    expect(shown(draft)).toEqual(["receipt", "remove"]);
    expect(expenseResource.modes.confirm.when(draft)).toBe(true);
    expect(expenseResource.modes.confirm.when(confirmed)).toBe(false);
    expect(shown(confirmed)).toEqual(["edit", "remove"]);
  });
  it("every button that changes something needs the manage permission; Receipt needs none", () => {
    for (const a of acts) expect(a.perm).toBe(a.id === "receipt" ? undefined : "manage");
    expect(expenseResource.perms).toEqual({ create: "manage", update: "manage", delete: "manage" });
  });
  it("a draft from a recurring expense is Skipped, a typed one is Deleted, with the old wording", () => {
    const rm = expenseResource.remove;
    expect(rm.confirmLabel(draft)).toBe("Skip");
    expect(rm.confirmLabel(confirmed)).toBe("Delete");
    expect(rm.text(draft)).toBe("Skip EX-0001? It won't be added again this month.");
    expect(rm.text(confirmed)).toBe("Delete EX-0002? This can't be undone.");
  });
  it("only a confirmed expense can be changed from the view panel", () => {
    expect(expenseResource.view.canEdit(draft)).toBe(false);
    expect(expenseResource.view.canEdit(confirmed)).toBe(true);
  });
});

describe("version round-trip on Expenses", () => {
  const row = { id: "e1", version: 7 };
  const api = () => vi.fn(async () => ({ message: "EX-0001 saved.", data: { id: "e1" } }));
  it("change, confirm and delete all send version 7", async () => {
    const a = api();
    await submitRecord(expenseResource, { row, mode: null }, { amount: 5 }, a);
    await submitRecord(expenseResource, { row, mode: "confirm" }, { amount: 6 }, a);
    await removeRecord(expenseResource, row, a);
    expect(a.mock.calls).toEqual([["PUT", "/expenses/e1", { amount: 5, version: 7 }], ["POST", "/expenses/e1/confirm", { amount: 6, version: 7 }], ["DELETE", "/expenses/e1?version=7"]]);
  });
  it("adding sends no version", async () => {
    const a = api();
    await submitRecord(expenseResource, { row: null, mode: null }, { amount: 5 }, a);
    expect(a).toHaveBeenCalledWith("POST", "/expenses", { amount: 5 });
  });
  it("a stale save (409) shows the conflict and reloads, with one request only", async () => {
    const a = vi.fn(async () => { throw new ApiError(409, "Changed.", undefined, "version_conflict"); });
    const ui = { conflict: vi.fn(), reload: vi.fn(), fields: vi.fn(), message: vi.fn() };
    await removeRecord(expenseResource, row, a).catch((e) => reactToFailure(e, ui));
    expect([ui.conflict.mock.calls.length, ui.reload.mock.calls.length, a.mock.calls.length]).toEqual([1, 1, 1]);
  });
});

describe("recurring", () => {
  const row = { id: "r1", version: 2, status: "active" };
  const shown = (r) => recurringResource.rowActions.filter((a) => !a.when || a.when(r)).map((a) => a.id);
  it("active: Change, Pause, Stop; paused: Change, Resume, Stop; stopped: nothing", () => {
    expect(shown(row)).toEqual(["edit", "pause", "stop"]);
    expect(shown({ ...row, status: "paused" })).toEqual(["edit", "resume", "stop"]);
    expect(shown({ ...row, status: "stopped" })).toEqual([]);
  });
  it("pause, resume and stop post the version; stop asks first", async () => {
    const a = vi.fn(async () => ({ message: "Paused." }));
    for (const id of ["pause", "resume", "stop"]) await runRowAction(recurringResource, { id }, row, a);
    expect(a.mock.calls).toEqual([["POST", "/expenses/recurring/r1/pause", { version: 2 }], ["POST", "/expenses/recurring/r1/resume", { version: 2 }], ["POST", "/expenses/recurring/r1/stop", { version: 2 }]]);
    expect(recurringResource.rowActions.find((x) => x.id === "stop").confirm).toBe("Stop this recurring expense for good? Its past expenses stay in your records.");
  });
  it("day of the month is 1 to 28 and the body has no date", () => {
    const v = { category: "rent", amount: "9000", dayOfMonth: "29", method: "bank", vendor: "", note: "", branchId: "" };
    const run = (over) => validateFields(visibleFields(recurringFields, { ...v, ...over }, {}), { ...v, ...over });
    expect(run({}).dayOfMonth).toBeTruthy();
    expect(run({ dayOfMonth: "0" }).dayOfMonth).toBeTruthy();
    expect(run({ dayOfMonth: "28" })).toEqual({});
    expect(buildBody(recurringFields, { ...v, dayOfMonth: "5" })).toEqual({ category: "rent", amount: 9000, dayOfMonth: 5, method: "bank", vendor: null, note: null });
  });
  it("columns and the month name", () => {
    expect(recurringColumns([], {}, { categories: [] }).map((c) => c.label)).toEqual(["Expense", "Day", "Amount", "Status"]);
    expect(monthLabel("2026-11")).toBe("Nov 2026");
    expect(recurringColumns([], {}, {})[1].render({ dayOfMonth: 5, startMonth: "2026-11" })).toBe("Day 5 · from Nov 2026");
  });
});
