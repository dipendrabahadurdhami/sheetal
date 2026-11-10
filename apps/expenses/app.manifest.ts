// Expenses: what a business spent, recurring expenses, and profit by month and branch.
// Where it fits: loaded by the generator (permissions, menu, roles) and by the API at start (events, limits).
// How it works: plain data. Prices and limits are only defaults; the admin panel owns them after the first start. Phase 1: every limit is null (unlimited) and price is null, so nothing changes.
// Rules: no functions or logic; every permission and event starts with "expenses."; the code lives in apps/expenses/backend (moved in by P1-BE-5).

import type { AppManifest } from "@sheetal/platform/core/manifest";

const manifest = {
  manifestVersion: 1,
  id: "expenses",
  kind: "app",
  name: { en: "Expenses", ne: "खर्च" },
  tagline: { en: "Track what you spend, set recurring costs, and see your profit.", ne: "खर्च हेर्नुहोस्, नियमित खर्च राख्नुहोस्, र नाफा हेर्नुहोस्।" },
  icon: "receipt",
  category: "money",
  businessTypes: "all",
  trialDays: null,
  limits: [
    { key: "expenses_per_month", label: { en: "Expenses per month" }, unit: "per_month" },
    { key: "recurring_templates", label: { en: "Recurring expenses" }, unit: "count" },
    { key: "receipt_storage_mb", label: { en: "Receipt storage" }, unit: "mb" },
  ],
  editions: [
    { id: "free", name: { en: "Free" }, free: true, limits: { expenses_per_month: null, recurring_templates: null, receipt_storage_mb: null }, features: [], price: null },
    {
      id: "full",
      name: { en: "Full" },
      free: false,
      limits: { expenses_per_month: null, recurring_templates: null, receipt_storage_mb: null },
      features: ["expenses.receipts", "expenses.profit"],
      price: null,
    },
  ],
  permissions: [
    { id: "expenses.expense.read", label: { en: "See expenses" }, scopes: ["own", "branch", "all"], default: "branch", group: "Expenses" },
    { id: "expenses.expense.create", label: { en: "Add expenses" }, scopes: ["branch", "all"], default: "branch", group: "Expenses" },
    { id: "expenses.expense.update", label: { en: "Change expenses and receipts" }, scopes: ["own", "branch", "all"], default: "branch", group: "Expenses" },
    { id: "expenses.expense.delete", label: { en: "Delete or skip expenses" }, scopes: ["own", "branch", "all"], default: "branch", group: "Expenses" },
    { id: "expenses.expense.confirm", label: { en: "Confirm recurring drafts" }, scopes: ["branch", "all"], default: "branch", group: "Expenses", approvable: true },
    { id: "expenses.recurring.read", label: { en: "See recurring expenses" }, scopes: ["branch", "all"], default: "branch", group: "Recurring" },
    { id: "expenses.recurring.create", label: { en: "Add recurring expenses" }, scopes: ["branch", "all"], default: "branch", group: "Recurring" },
    { id: "expenses.recurring.update", label: { en: "Change, pause or resume recurring expenses" }, scopes: ["branch", "all"], default: "branch", group: "Recurring" },
    { id: "expenses.recurring.stop", label: { en: "Stop recurring expenses" }, scopes: ["branch", "all"], default: "branch", group: "Recurring" },
    { id: "expenses.profit.read", label: { en: "See profit" }, scopes: ["branch", "all"], default: "branch", group: "Profit" },
  ],
  roles: [
    {
      key: "accountant",
      types: ["hotel", "developer", "agency", "sponsor"],
      add: [
        "expenses.expense.read:branch",
        "expenses.recurring.read:branch",
        "expenses.profit.read:branch",
        "expenses.expense.create:branch",
        "expenses.expense.update:branch",
        "expenses.expense.delete:branch",
        "expenses.expense.confirm:branch",
        "expenses.recurring.create:branch",
        "expenses.recurring.update:branch",
        "expenses.recurring.stop:branch",
      ],
    },
    {
      key: "branch_manager",
      types: ["agency"],
      add: [
        "expenses.expense.read:branch",
        "expenses.recurring.read:branch",
        "expenses.profit.read:branch",
        "expenses.expense.create:branch",
        "expenses.expense.update:branch",
        "expenses.expense.delete:branch",
        "expenses.expense.confirm:branch",
        "expenses.recurring.create:branch",
        "expenses.recurring.update:branch",
        "expenses.recurring.stop:branch",
      ],
    },
  ],
  approvals: [
    {
      action: "expenses.expense.confirm",
      label: { en: "Confirm an expense above a limit" },
      money: true,
      enabledByDefault: false,
      approverPermission: "expenses.expense.confirm",
    },
  ],
  menu: [
    {
      id: "expenses",
      label: { en: "Expenses", ne: "खर्च" },
      icon: "receipt",
      path: "/business/expenses",
      group: "money",
      order: 40,
      permission: "expenses.expense.read",
      badge: { endpoint: "/expenses?status=draft&per=1", field: "meta.total" },
    },
  ],
  events: {
    publishes: [
      {
        name: "expenses.expense.confirmed",
        v: 1,
        label: "An expense was added or a draft was confirmed",
        payload: { expenseId: "id", branchId: "id", category: "string", amountPaisa: "paisa", spentOn: "date", method: "string" },
      },
      {
        name: "expenses.expense.updated",
        v: 1,
        label: "An expense was changed",
        payload: { expenseId: "id", branchId: "id", amountPaisa: "paisa", previousAmountPaisa: "paisa" },
      },
      { name: "expenses.expense.deleted", v: 1, label: "An expense was deleted", payload: { expenseId: "id", branchId: "id", amountPaisa: "paisa" } },
      { name: "expenses.expense.skipped", v: 1, label: "A recurring draft was skipped", payload: { expenseId: "id", recurringId: "id", forMonth: "string" } },
      {
        name: "expenses.recurring.draft_created",
        v: 1,
        label: "A recurring expense made this month's draft",
        payload: { recurringId: "id", expenseId: "id", forMonth: "string", branchId: "id" },
      },
    ],
    consumes: [],
  },
  ai: [
    {
      id: "receipt_reader",
      name: { en: "Read a receipt" },
      description: { en: "Fills date, vendor, amount and category from a receipt photo." },
      minutesSaved: 2,
      status: "planned",
      permission: "expenses.expense.create",
    },
    {
      id: "categoriser",
      name: { en: "Suggest the category" },
      description: { en: "Picks the category from the vendor and note." },
      minutesSaved: 0.5,
      status: "planned",
      permission: "expenses.expense.create",
    },
    {
      id: "monthly_summary",
      name: { en: "Explain the month" },
      description: { en: "A short note on what changed in spending and profit this month." },
      minutesSaved: 15,
      status: "planned",
      permission: "expenses.profit.read",
    },
  ],
  dependencies: { requires: [], optional: ["invoicing", "rentals"], reads: ["BizReceipt", "BizInvoice", "Payout", "PayoutItem", "OwnerStatement"] },
  models: ["Expense", "RecurringExpense"],
  branchOwned: [{ model: "Expense", label: { en: "expense" } }, { model: "RecurringExpense", label: { en: "expense" } }],
  settings: [
    {
      key: "expenses.categories",
      label: { en: "Expense categories" },
      scope: "platform",
      type: "list",
      legacy: "AppSetting 'catalog' → lists.expenseCategories (edited in Admin → Listing setup)",
    },
    { key: "expenses.approval.limit", label: { en: "Ask for approval above (Rs.)" }, scope: "business", type: "money", default: null },
  ],
  jobs: [{ id: "expenses.generate-due", every: "6h", label: "Add this month's drafts for recurring expenses" }],
} satisfies AppManifest;

export default manifest;
