// @sheetal/app-expenses/backend: what the rest of the repo imports from the Expenses app's server code.
// Where it fits: business/backend/src/app.ts (routes), business/backend/src/jobs.ts (the job), and the old backend-core/src/domain/expenses.ts shim (helpers).
// How it works: re-exports only. Nothing here runs on import.
// Rules: an app exports its routes, its job and the helpers other code already used; the repositories and services stay inside the app.

export { EXPENSE_CATEGORIES, EXPENSE_METHODS, MAX_EXPENSE, SHEETAL_METHOD, expenseCategories, expenseNo, type ExpenseCategory } from "./categories.js";
export { monthSpan, monthsBetween, paymentSplit, profitRows, type ProfitRow } from "./profit.js";
export { generateDueExpenses, type DraftEvents } from "./recurring.js";
export { expenseJob, startExpenseJob } from "./jobs.js";
export { expenseRoutes, type ExpenseRoutesOptions } from "./routes.js";
