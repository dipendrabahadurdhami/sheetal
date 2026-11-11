// @sheetal/app-rentals/backend: what the rest of the repo imports from the Rentals app's server code.
// Where it fits: business/backend/src/app.ts (routes), business/backend/src/jobs.ts (the job, through the modules/rentals shim), the old backend-core/src/domain/rentals.ts and
// rentpay.ts shims (helpers), and the website and admin APIs (the online-payment code in rentpay.ts).
// How it works: re-exports only. Nothing here runs on import.
// Rules: an app exports its routes, its job and the helpers other code already used; the repositories and services stay inside the app.

export { RENT_METHODS, UNIT_KINDS, MAX_RENT, addDays, balanceOf, billNo, billStatus, dueDateOf, feeOf, lastDayOf, lateFeeOf, leaseCovers, leaseNo, repairNo } from "./rentals.js";
export { runRentBills, type BillEvents } from "./bills.js";
export { statementsFor, type StatementLine } from "./statement.repository.js";
export { ONLINE_METHODS, confirmRentPayment, findLease, leaseView, payMethodsOf, payTargetOf, rejectRentPayment, takeOnlinePayment, type PayMethod } from "./rentpay.js";
export { rentJob, startRentJob } from "./jobs.js";
export { rentalRoutes, type RentalRoutesOptions } from "./routes.js";
