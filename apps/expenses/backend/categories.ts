// Expense categories, payment methods and the EX-0007 number.
// Where it fits: moved here from backend-core/src/domain/expenses.ts (P1-BE-5); that file re-exports it, so every old import still works.
// How it works: the category list is the built-in one, or the one staff saved in Admin → Listing setup (the "catalog" app setting).
// Rules: the lists and limits are the ones the old file had, word for word; changing a category id would orphan old expenses.

import type { Db } from "@sheetal/platform/db/client";

export const EXPENSE_METHODS = ["cash", "bank", "fonepay", "esewa", "khalti", "card", "other"] as const;
export const MAX_EXPENSE = 2_000_000_000;
/** The payment method of money Sheetal collected for the business (set by the system; never typed by a person). */
export const SHEETAL_METHOD = "sheetal";

export interface ExpenseCategory { id: string; en: string; ne: string; icon?: string }
/** The built-in list, in step with `expenseCategories` in shared/src/data/catalog.js. Staff can change it in Admin →
 *  Listing setup (stored in the "catalog" app setting). */
export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  { id: "salaries", en: "Salaries", ne: "तलब", icon: "users" },
  { id: "rent", en: "Rent", ne: "भाडा", icon: "key-round" },
  { id: "utilities", en: "Utilities", ne: "बिजुली, पानी र इन्टरनेट", icon: "zap" },
  { id: "repairs", en: "Repairs and maintenance", ne: "मर्मत सम्भार", icon: "wrench" },
  { id: "marketing", en: "Marketing", ne: "मार्केटिङ", icon: "megaphone" },
  { id: "supplies", en: "Supplies", ne: "सामग्री", icon: "shopping-bag" },
  { id: "travel", en: "Fuel and travel", ne: "इन्धन र यात्रा", icon: "car" },
  { id: "commissions", en: "Commissions", ne: "कमिसन", icon: "hand-coins" },
  { id: "taxes", en: "Taxes and fees", ne: "कर र शुल्क", icon: "receipt" },
  { id: "other", en: "Other", ne: "अन्य", icon: "circle-check" },
];

/** The categories now: the list staff saved, or the built-in one. */
export async function expenseCategories(db: Db): Promise<ExpenseCategory[]> {
  const stored = ((await db.appSetting.findUnique({ where: { key: "catalog" } }))?.value as { lists?: Record<string, unknown> } | null)?.lists?.expenseCategories;
  if (!Array.isArray(stored) || !stored.length) return EXPENSE_CATEGORIES;
  return stored.filter((c): c is ExpenseCategory => !!c && typeof c === "object" && typeof (c as ExpenseCategory).id === "string").map((c) => ({ id: c.id, en: String(c.en ?? c.id), ne: String(c.ne ?? c.en ?? c.id), icon: c.icon }));
}

/** EX-0007 */
export const expenseNo = (seq: number) => `EX-${String(seq).padStart(4, "0")}`;
