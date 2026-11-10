// Rupees and paisa for expenses: the one place an expense row's amount is read or written.
// Where it fits: the repositories (writing), the presenter and profit (reading). The old `amount` column holds whole rupees; the new
// `amountPaisa` column (P1-DB-1) holds the same amount x 100. Phase 1 writes BOTH on every write and the API still talks in whole rupees.
// How it works: `paisaOf(rupees)` is what is stored; `rupeesOf(row)` reads the paisa column and falls back to the rupee column for a row
// the paisa backfill has not reached yet (amount_paisa IS NULL), so a read never shows a wrong amount.
// Rules: no floating point; Money (platform/src/core/money.ts) does the conversion and refuses anything that is not a whole number.

import { Money } from "@sheetal/platform/core/money";

/** Whole rupees from the API -> the paisa column. */
export const paisaOf = (rupees: number): bigint => Money.rupees(rupees).toBigInt();

/** The two amount columns of a write, from whole rupees (keep both in step). */
export const amountColumns = (rupees: number) => ({ amount: rupees, amountPaisa: paisaOf(rupees) });

/** A row's amount in paisa (a plain number: every amount here is far below 2^53). */
export function paisaOfRow(row: { amount: number; amountPaisa: bigint | number | null }): number {
  return row.amountPaisa === null || row.amountPaisa === undefined ? Money.rupees(row.amount).paisa : Number(row.amountPaisa);
}

/** A row's amount in whole rupees, as the API shows it. */
export const rupeesOf = (row: { amount: number; amountPaisa: bigint | number | null }): number => Money.paisa(paisaOfRow(row)).toRupeesWhole();
