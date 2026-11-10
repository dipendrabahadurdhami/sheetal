// Tests for the FormBuilder rules (requiredWhen, visibleWhen, readOnlyWhen), the quick checks and the request body.
import { describe, expect, it } from "vitest";
import { buildBody, defaultValues, digits, evalRule, fieldState, firstInvalidKey, isEmpty, validateFields, visibleFields } from "./formRules.js";

const fields = [
  { key: "category", type: "select", label: "Category", required: true },
  { key: "note", type: "textarea", label: "Note", requiredWhen: { key: "category", eq: "other" }, maxLength: 20 },
  { key: "amount", type: "money", label: "Amount", required: true, min: 1, max: 1000000 },
  { key: "mode", type: "text", label: "Mode" },
  { key: "dayOfMonth", type: "int", label: "Day", visibleWhen: { key: "mode", in: ["recurring"] }, min: 1, max: 28 },
  { key: "ref", type: "text", label: "Ref", visibleWhen: { key: "category", notEmpty: true }, required: true },
  { key: "locked", type: "text", label: "Locked", readOnlyWhen: { key: "mode", eq: "recurring" }, required: true },
  { key: "branchId", type: "branch", label: "Branch" },
  { key: "paid", type: "toggle", label: "Paid" },
  { key: "receipt", type: "file", label: "Receipt", maxMB: 8, accept: "image/jpeg,application/pdf" },
];

describe("rules", () => {
  it("eq compares as text, so 5 equals '5'", () => {
    expect(evalRule({ key: "a", eq: 5 }, { a: "5" })).toBe(true);
    expect(evalRule({ key: "a", eq: "x" }, { a: "y" })).toBe(false);
  });
  it("in checks a list", () => {
    expect(evalRule({ key: "a", in: ["x", "y"] }, { a: "y" })).toBe(true);
    expect(evalRule({ key: "a", in: ["x", "y"] }, { a: "z" })).toBe(false);
    expect(evalRule({ key: "a", in: ["x"] }, {})).toBe(false);
  });
  it("notEmpty treats '', spaces, null and [] as empty but not false or 0", () => {
    for (const v of ["", "  ", null, undefined, []]) expect(evalRule({ key: "a", notEmpty: true }, { a: v })).toBe(false);
    for (const v of [false, 0, "x"]) expect(evalRule({ key: "a", notEmpty: true }, { a: v })).toBe(true);
    expect(evalRule({ key: "a", notEmpty: false }, { a: "" })).toBe(true);
    expect(isEmpty(false)).toBe(false);
  });
  it("no rule is true; an unknown rule shape is false (a typo hides, it does not show)", () => {
    expect(evalRule(undefined, {})).toBe(true);
    expect(evalRule({ key: "a" }, { a: 1 })).toBe(false);
  });
});

describe("requiredWhen / visibleWhen / readOnlyWhen", () => {
  it("the note is optional until the category is 'other'", () => {
    const note = fields[1];
    expect(fieldState(note, { category: "rent" }).required).toBe(false);
    expect(fieldState(note, { category: "other" }).required).toBe(true);
  });
  it("a field with visibleWhen only shows when the rule holds", () => {
    expect(visibleFields(fields, { mode: "create" }).map((f) => f.key)).not.toContain("dayOfMonth");
    expect(visibleFields(fields, { mode: "recurring" }).map((f) => f.key)).toContain("dayOfMonth");
  });
  it("a branch field has no place when there are no choices", () => {
    expect(visibleFields(fields, {}, {}).map((f) => f.key)).not.toContain("branchId");
    expect(visibleFields(fields, {}, { branches: [{ id: "b1", label: "Thamel" }] }).map((f) => f.key)).toContain("branchId");
  });
  it("readOnlyWhen is reported", () => {
    expect(fieldState(fields[6], { mode: "recurring" }).readOnly).toBe(true);
    expect(fieldState(fields[6], { mode: "x" }).readOnly).toBe(false);
  });
});

describe("validateFields (quick checks, the server decides)", () => {
  const ok = { category: "rent", amount: "1500", ref: "R-1", locked: "x", mode: "create" };
  it("passes a complete form", () => { expect(validateFields(fields, ok)).toEqual({}); });
  it("asks for required fields", () => {
    const e = validateFields(fields, { ...ok, category: "", amount: "" });
    expect(Object.keys(e).sort()).toEqual(["amount", "category"]);
  });
  it("requires the note only for 'other'", () => {
    expect(validateFields(fields, { ...ok, category: "other", note: "" }).note).toBeTruthy();
    expect(validateFields(fields, { ...ok, category: "other", note: "Roof leak repair" }).note).toBeUndefined();
    expect(validateFields(fields, { ...ok, category: "rent", note: "" }).note).toBeUndefined();
  });
  it("skips hidden and read-only fields", () => {
    const e = validateFields(fields, { category: "rent", amount: "10", mode: "recurring", dayOfMonth: "" });
    expect(e.dayOfMonth).toBeUndefined(); // shown here, but not required
    expect(e.locked).toBeUndefined();     // read-only now
    expect(validateFields(fields, { ...ok, category: "" }).ref).toBeUndefined(); // hidden while category is empty
  });
  it("checks length and number range", () => {
    expect(validateFields(fields, { ...ok, note: "x".repeat(25) }).note).toBeTruthy();
    expect(validateFields(fields, { ...ok, amount: "0" }).amount).toBeTruthy();
    expect(validateFields(fields, { ...ok, mode: "recurring", dayOfMonth: "31" }).dayOfMonth).toBeTruthy();
  });
  it("checks a chosen file's size and type, and accepts a saved one", () => {
    expect(validateFields(fields, { ...ok, receipt: { name: "a.pdf", size: 9 * 1024 * 1024, type: "application/pdf" } }).receipt).toBeTruthy();
    expect(validateFields(fields, { ...ok, receipt: { name: "a.exe", size: 100, type: "application/x-msdownload" } }).receipt).toBeTruthy();
    expect(validateFields(fields, { ...ok, receipt: { name: "a.pdf", size: 100, type: "application/pdf" } }).receipt).toBeUndefined();
    expect(validateFields(fields, { ...ok, receipt: { existing: true } }).receipt).toBeUndefined();
  });
  it("uses the screen's translator when given", () => {
    const e = validateFields(fields, { ...ok, amount: "" }, { t: (k) => `T:${k}` });
    expect(e.amount).toEqual(["T:kit.required"]);
  });
});

describe("values and body", () => {
  it("starts empty: '' for text, false for toggles, null for files", () => {
    const v = defaultValues(fields, { mode: "create" });
    expect(v.category).toBe("");
    expect(v.paid).toBe(false);
    expect(v.receipt).toBeNull();
    expect(v.mode).toBe("create");
  });
  it("keeps only digits", () => { expect(digits("Rs. 1,250")).toBe("1250"); expect(digits(null)).toBe(""); });
  it("builds the body: numbers as numbers, trimmed text, null for an empty optional, no files, no hidden fields", () => {
    const b = buildBody(fields, { category: "rent", amount: "1500", note: "  hello ", mode: "", dayOfMonth: "5", ref: "R", locked: "k", branchId: "b1", paid: true, receipt: { existing: true } });
    expect(b).toMatchObject({ category: "rent", amount: 1500, note: "hello", mode: null, paid: true, ref: "R", branchId: "b1" });
    expect(b).not.toHaveProperty("receipt");
    expect(b).not.toHaveProperty("dayOfMonth"); // hidden: mode is empty
  });
  it("leaves an empty branch out and sends a chosen one", () => {
    expect(buildBody([fields[7]], { branchId: "" })).toEqual({});
    expect(buildBody([fields[7]], { branchId: "b1" })).toEqual({ branchId: "b1" });
  });
  it("finds the first field with an error in form order", () => {
    expect(firstInvalidKey(fields, { amount: ["x"], category: ["y"] })).toBe("category");
    expect(firstInvalidKey(fields, {})).toBeNull();
  });
});
