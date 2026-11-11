// Rentals: the code moved to the Rentals app (apps/rentals/backend) in P2-W1-S1; this file only re-exports it, so every old import keeps working.
// Where it fits: still imported by tests, scripts (test-accounts.ts), the website and admin APIs as "@sheetal/backend-core/domain/rentals". RENT_METHODS, UNIT_KINDS, MAX_RENT, the codes
// (leaseNo, billNo, repairNo), balanceOf, billStatus, the date and fee helpers, runRentBills and statementsFor are all here, with the same names and behaviour.
// Rules: no new code imports this path (new code imports @sheetal/app-rentals/backend); it is deleted at the end of Phase 2.

export { RENT_METHODS, UNIT_KINDS, MAX_RENT, addDays, balanceOf, billNo, billStatus, dueDateOf, feeOf, lastDayOf, lateFeeOf, leaseCovers, leaseNo, repairNo } from "@sheetal/app-rentals/backend/rentals";
export { runRentBills } from "@sheetal/app-rentals/backend/bills";
export { statementsFor, type StatementLine } from "@sheetal/app-rentals/backend/statement.repository";
