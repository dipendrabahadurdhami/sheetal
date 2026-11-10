// The Expenses tab described as data for CrudPage: list, filters, columns, form, view, confirm a draft, skip / delete, receipt.
// Where it fits: ExpensesPage (the first tab). The same description is what the future admin field builder will store (docs/architecture/FRONTEND-KIT.md section 7).
// How it works: `versioned: true` makes CrudPage send the row's `version` on change, confirm and delete (a stale one gives 409 and a reload). A draft made by a
// recurring expense shows Confirm (the amount can change first) and Skip; a confirmed expense shows Change and Delete. The receipt is a file field: a chosen
// file is uploaded after the save, "remove it" is applied on Save. Categories come from the list's own answer (`categories`) and are shown in English.
// Rules: Other needs a note of 3 or more letters (the server says it too and its message is shown); amount is whole rupees 1 to 2,000,000,000; receipt is a
// photo or PDF up to 8 MB; every button that changes something has `perm: "manage"`, so a person without it sees only the Receipt button.

import React from "react";
import { Badge } from "@sheetal/ui/primitives";
import { fdate, rs, TODAY } from "@sheetal/shared/core/format";
import { METHOD, METHOD_OPTIONS, MIN_AMOUNT, MAX_AMOUNT, OTHER_NOTE_MIN, RECEIPT_ACCEPT, RECEIPT_MB, categoryName, detailLine, receipt } from "./common.js";

const isOther = { key: "category", eq: "other" };

export const expenseFields = [
  { key: "branchId", type: "branch", label: "Branch", required: true },
  { key: "category", type: "select", label: "Category", required: true, columns: 2, options: { from: "categories", label: "en" } },
  { key: "amount", type: "money", label: "Amount (Rs.)", required: true, min: MIN_AMOUNT, max: MAX_AMOUNT, columns: 2 },
  { key: "date", type: "date", label: "Date", required: true, columns: 2 },
  { key: "method", type: "select", label: "Paid by", required: true, columns: 2, options: METHOD_OPTIONS },
  { key: "vendor", type: "text", label: "Vendor", maxLength: 120, placeholder: "Who was paid" },
  { key: "note", type: "textarea", rows: 2, label: "Note", maxLength: 300, requiredWhen: isOther, minLength: OTHER_NOTE_MIN, labelWhen: { when: isOther, label: "What is it for?" } },
  { key: "receipt", type: "file", label: "Receipt", hint: `A photo or PDF, up to ${RECEIPT_MB} MB. Only your team can open it.`, accept: RECEIPT_ACCEPT, maxMB: RECEIPT_MB },
];

const statusBadge = (r) => (r.status === "draft" ? <Badge tone="action">To confirm</Badge> : <Badge tone="done">Confirmed</Badge>);

/** Columns depend on the data: with several branches in the list, "Paid by" becomes "Branch" with the method underneath. */
export function expenseColumns(rows, meta) {
  const cats = meta?.categories || [];
  const many = new Set((rows || []).map((r) => r.branchId)).size > 1;
  return [
    { key: "d", label: "Date", num: true, render: (r) => fdate(r.date) },
    { key: "c", label: "Expense", render: (r) => <span className="pf-two"><b>{categoryName(cats, r.category)}</b><small>{detailLine(r, r.no)}</small></span> },
    { key: "b", label: many ? "Branch" : "Paid by", render: (r) => (many ? <span className="pf-two"><b>{r.branch}</b><small>{METHOD[r.method]}</small></span> : METHOD[r.method]) },
    { key: "a", label: "Amount", num: true, align: "right", render: (r) => <b className="pf-strong">{rs(r.amount)}</b> },
    { key: "s", label: "Status", render: statusBadge },
  ];
}

/** The two stat cards above the list. */
export function expenseStats(_meta, rows) {
  const confirmed = rows.filter((r) => r.status === "confirmed");
  const waiting = rows.filter((r) => r.status === "draft");
  return [
    { label: "Confirmed in this list", value: rs(confirmed.reduce((s, r) => s + r.amount, 0)), note: `${confirmed.length} expenses` },
    { label: "To confirm", value: rs(waiting.reduce((s, r) => s + r.amount, 0)), note: waiting.length ? `${waiting.length} from recurring expenses` : "Nothing waiting", tone: waiting.length ? "action" : undefined },
  ];
}

const skipOrDelete = (r) => (r.recurringId ? "Skip" : "Delete");

export const expenseResource = {
  path: "/expenses",
  label: { one: "expense", many: "expenses" },
  versioned: true,
  perms: { create: "manage", update: "manage", delete: "manage" },
  titles: { create: "Add expense", edit: "Change expense" },
  empty: { icon: "receipt", title: "No expenses here" },
  list: {
    filters: [
      { id: "month", type: "month", label: "Month", width: 170 },
      { id: "category", type: "select", label: "Category", allLabel: "All categories", width: 200, options: { from: "categories", label: "en" } },
      { id: "status", type: "select", label: "Show", allLabel: "All", width: 170, options: [{ id: "confirmed", label: "Confirmed" }, { id: "draft", label: "To confirm" }] },
    ],
    params: ({ month, category, status }) => ({ status: status || "all", month, category }),
    sortable: false,
    columns: expenseColumns,
    primary: "c",
    secondary: ["d", "b", "a", "s"],
    minWidth: 860,
  },
  form: {
    fields: expenseFields,
    edit: { omit: ["branchId"] },
    create: { defaults: { method: "cash", date: TODAY.slice(0, 10) } },
    toForm: (r) => ({ category: r.category, amount: String(r.amount), date: r.date, method: r.method, vendor: r.vendor, note: r.note, branchId: r.branchId, receipt: r.hasReceipt ? { existing: true } : null }),
  },
  modes: {
    confirm: {
      title: "Confirm expense",
      submitLabel: "Confirm",
      note: "Made by a recurring expense. Check the amount, then confirm: only confirmed expenses count in your profit.",
      when: (r) => r.status === "draft",
      submit: (row, body, api) => api("POST", `/expenses/${row.id}/confirm`, body),
    },
  },
  rowActions: [
    { id: "receipt", label: "Receipt", icon: "image", first: true, refresh: false, when: (r) => r.hasReceipt, run: (row, api) => receipt.open(row, api) },
    { id: "edit", label: "Change", edit: true, perm: "manage", when: (r) => r.status === "confirmed" },
    { id: "remove", label: skipOrDelete, remove: true, perm: "manage" },
  ],
  remove: {
    title: (r) => `${skipOrDelete(r)} ${r.no}`,
    text: (r) => (r.recurringId ? `Skip ${r.no}? It won't be added again this month.` : `Delete ${r.no}? This can't be undone.`),
    confirmLabel: skipOrDelete,
  },
  view: {
    title: (r) => r.no,
    sub: (r) => (r.status === "draft" ? "To confirm" : "Confirmed"),
    canEdit: (r) => r.status === "confirmed",
    facts: (r, ctx) => [
      ["Date", fdate(r.date)], ["Category", categoryName(ctx?.categories, r.category)], ["Amount", rs(r.amount)], ["Paid by", METHOD[r.method]],
      ["Branch", r.branch], ["Vendor", r.vendor], ["Note", r.note], ["Receipt", r.hasReceipt ? "Saved" : ""],
    ],
  },
  afterSave: {
    file: {
      field: "receipt",
      upload: (id, file, api) => receipt.upload(id, file, api),
      remove: (id, api) => receipt.remove(id, api),
      failText: (why) => `Saved, but the receipt wasn't: ${why}`,
    },
  },
};
