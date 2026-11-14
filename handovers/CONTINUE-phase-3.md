# CONTINUE Phase 3 (updated 14 Nov 2026, about 10:00 Nepal time)

Phase 3 is being built stage by stage (PHASE-3-TASKS.md order). Read this, then `docs/architecture/PHASE-3-TEST-PLAN.md`, then the CHANGES notes named below.

## Done (merged, CI green)
| Stage | PR | Task(s) | Note |
|---|---|---|---|
| 1 | #65 | DB-1 + DB-2 | 12 tables, paisa twins, CHECKs and triggers (`CHANGES-P3-DB-1-2.md`); also fixed a clock-dependent People test |
| 2 | #66 | BE-2 + QA-1 (plan, proration table) | pure billing core in `platform/src/billing/` (`CHANGES-P3-BE-2.md`) |
| 3 | #67 | BE-1 | catalog + billing settings, manifest editions, `GET /v1/public/catalog` (`CHANGES-P3-BE-1.md`) |
| 4 | #68 | BE-3 + QA-1 (oracle, fixtures) | entitlements v3, shadow, limits, `GET /v1/entitlements` (`CHANGES-P3-BE-3.md`) |
| 5 | #69 | BE-4 | tax invoices at payment, subscription payments, revenue ledger, credit notes, `fiscalYearOf` in Nepal time (`CHANGES-P3-BE-4.md`) |
| 6 | #70 | BE-9 | payment router (two systems, no fall-back), paisa amount check, `business.payments` definition (`CHANGES-P3-BE-9.md`) |
| 7 | #71 | BE-5 | hourly lifecycle job: statuses, one renewal invoice per business, reminders; the old plan cycle skips `apps` (`CHANGES-P3-BE-5.md`) |

Every business is still on `billingMode = plans`: nothing has changed for any customer. `salesEnabled` is false.

## Next, in order
1. **BE-6** business routes: `/marketplace`, `/subscriptions` (install, trial, quote, checkout, change, cancel, resume), `/addons/*`, `/coupons/check`,
   `/billing/overview`, usage counters on `/entitlements`. Checkout: `quote()` -> `createInvoiceFromQuote()` -> `resolvePaymentMethods("sheetal.subscription")`
   -> gateway with `rupeesText(totalPaisa)` -> verify with `amountMatches()` -> `applyPayment()` (already routes kind `subscription`). Register `business.payments`
   in SETTING_DEFS with its screen and update the pinned list in `platform/test/settings-pure.test.ts` (say so in CHANGES).
2. **BE-7** admin routes (refunds call `issueCreditNote`, maker-checker `PlatformApproval`); **BE-8** AI credits; **BE-10** migration script
   (reuse `platform/src/billing/mapping.ts`); **BE-11** website posting.
3. FE-1..6, OPS-1, OPS-2 (the customer move needs the owner's yes at each step, backup first).

## Decisions taken so far (all inside the design; see each CHANGES)
- A cancelled subscription has no grace (MB 5.1 over one row of 5.2). Coupon before price protection. "Carry" below Rs 10.
- Mail, Promote, Payroll, Accounting, Restaurant are catalog-only entries (no manifests yet; their permissions stay in workspace). Promote Rs 300 and
  Expenses free 50 MB receipts are **Owner to confirm**.
- v1 keeps today's answers exactly; v3 never gives less than v1 for the 19 fixtures (parity test).

## Owner steps pending
RUN-UPDATE (applies `20261113200000_p3_subscriptions` and `20261113210000_p3_invoicing_revenue`; backs up first). Then open
`http://127.0.0.1:4000/v1/public/catalog`: the app cards with prices.
