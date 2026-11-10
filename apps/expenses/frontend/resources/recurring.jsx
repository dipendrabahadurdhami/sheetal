// The Recurring tab described as data for CrudPage: monthly templates that make a draft expense on a chosen day.
// Where it fits: ExpensesPage (the second tab).
// How it works: no delete; a template is changed, paused, resumed or stopped for good. `versioned: true` sends the row's version with every change and with
// pause / resume / stop (a stale one gives 409 and a reload). A stopped template shows no buttons. Categories come from the page (`extraContext.categories`).
// Rules: day of the month 1 to 28; amount whole rupees 1 to 2,000,000,000; "Other" needs a note; stopping asks first.

import React from "react";
import { Badge } from "@sheetal/ui/primitives";
import { rs } from "@sheetal/shared/core/format";
import { METHOD, METHOD_OPTIONS, MIN_AMOUNT, MAX_AMOUNT, OTHER_NOTE_MIN, categoryName, detailLine, monthLabel } from "./common.js";

const isOther = { key: "category", eq: "other" };

export const recurringFields = [
  { key: "branchId", type: "branch", label: "Branch", required: true },
  { key: "category", type: "select", label: "Category", required: true, columns: 2, options: { from: "categories", label: "en" } },
  { key: "amount", type: "money", label: "Amount (Rs.)", required: true, min: MIN_AMOUNT, max: MAX_AMOUNT, columns: 2 },
  { key: "dayOfMonth", type: "int", label: "Day of the month", hint: "1 to 28. A draft is made on this day.", required: true, min: 1, max: 28, maxLength: 2, columns: 2 },
  { key: "method", type: "select", label: "Paid by", required: true, columns: 2, options: METHOD_OPTIONS },
  { key: "vendor", type: "text", label: "Vendor", maxLength: 120, placeholder: "Who was paid" },
  { key: "note", type: "textarea", rows: 2, label: "Note", maxLength: 300, requiredWhen: isOther, minLength: OTHER_NOTE_MIN, labelWhen: { when: isOther, label: "What is it for?" } },
];

export const RECURRING_STATUS = { active: ["done", "Active"], paused: ["neutral", "Paused"], stopped: ["problem", "Stopped"] };
const badge = (r) => { const [tone, label] = RECURRING_STATUS[r.status] || ["neutral", r.status]; return <Badge tone={tone}>{label}</Badge>; };

export function recurringColumns(_rows, _meta, ctx) {
  const cats = ctx?.categories || [];
  return [
    { key: "c", label: "Expense", render: (r) => <span className="pf-two"><b>{categoryName(cats, r.category)}</b><small>{detailLine(r, r.branch)}</small></span> },
    { key: "d", label: "Day", num: true, render: (r) => `Day ${r.dayOfMonth} · from ${monthLabel(r.startMonth)}` },
    { key: "a", label: "Amount", num: true, align: "right", render: (r) => <b className="pf-strong">{rs(r.amount)}</b> },
    { key: "s", label: "Status", render: badge },
  ];
}

const live = (r) => r.status !== "stopped";

export const recurringResource = {
  path: "/expenses/recurring",
  label: { one: "recurring expense", many: "recurring expenses" },
  versioned: true,
  perms: { create: "manage", update: "manage" },
  titles: { create: "New recurring expense", edit: "Change recurring expense" },
  empty: { icon: "clock", title: "No recurring expenses" },
  list: {
    note: "A draft is added on the chosen day of each month. You confirm it, and can change the amount first.",
    columns: recurringColumns,
    primary: "c",
    secondary: ["d", "a", "s"],
    minWidth: 760,
  },
  form: {
    fields: recurringFields,
    edit: { omit: ["branchId"] },
    create: { defaults: { method: "cash", dayOfMonth: "1" } },
    toForm: (r) => ({ category: r.category, amount: String(r.amount), dayOfMonth: String(r.dayOfMonth || 1), method: r.method, vendor: r.vendor, note: r.note, branchId: r.branchId }),
  },
  rowActions: [
    { id: "edit", label: "Change", edit: true, perm: "manage", when: live },
    { id: "pause", label: "Pause", perm: "manage", when: (r) => r.status === "active" },
    { id: "resume", label: "Resume", perm: "manage", when: (r) => r.status === "paused" },
    { id: "stop", label: "Stop", perm: "manage", danger: true, when: live, confirm: "Stop this recurring expense for good? Its past expenses stay in your records." },
  ],
  view: {
    title: (r) => `Day ${r.dayOfMonth} of every month`,
    sub: (r) => RECURRING_STATUS[r.status]?.[1],
    canEdit: live,
    facts: (r, ctx) => [
      ["Category", categoryName(ctx?.categories, r.category)], ["Amount", rs(r.amount)], ["Day", `Day ${r.dayOfMonth}`], ["Starts", monthLabel(r.startMonth)],
      ["Paid by", METHOD[r.method]], ["Branch", r.branch], ["Vendor", r.vendor], ["Note", r.note],
    ],
  },
};
