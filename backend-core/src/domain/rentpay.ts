// Paying rent online: the code moved to the Rentals app (apps/rentals/backend/rentpay.ts) in P2-W1-S1; this file only re-exports it, so every old import keeps working.
// Where it fits: still imported by the website API (finding a lease, taking a payment), the admin API (confirming or rejecting a payment made to Sheetal) and tests, as
// "@sheetal/backend-core/domain/rentpay". The names and behaviour are the same.
// Rules: no new code imports this path (new code imports @sheetal/app-rentals/backend); it is deleted at the end of Phase 2.

export { ONLINE_METHODS, confirmRentPayment, findLease, leaseView, payMethodsOf, payTargetOf, rejectRentPayment, takeOnlinePayment, type PayMethod } from "@sheetal/app-rentals/backend/rentpay";
