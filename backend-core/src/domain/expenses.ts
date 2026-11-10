// Expenses and profit: the code moved to the Expenses app (apps/expenses/backend) in P1-BE-5; this file only re-exports it, so every old import keeps working.
// Where it fits: still imported by tests and older code as "@sheetal/backend-core/domain/expenses". EXPENSE_METHODS, MAX_EXPENSE, SHEETAL_METHOD, the categories, expenseNo,
// profitRows, paymentSplit, monthSpan, monthsBetween and generateDueExpenses are all here, with the same names and behaviour.
// Rules: no new code imports this path (new code imports @sheetal/app-expenses/backend); it is deleted at the end of Phase 2.

export { EXPENSE_CATEGORIES, EXPENSE_METHODS, MAX_EXPENSE, SHEETAL_METHOD, expenseCategories, expenseNo, type ExpenseCategory } from "@sheetal/app-expenses/backend/categories";
export { monthSpan, monthsBetween, paymentSplit, profitRows, type ProfitRow } from "@sheetal/app-expenses/backend/profit";
export { generateDueExpenses } from "@sheetal/app-expenses/backend/recurring";
