# Phase 3 test plan (P3-QA-1)

What proves Phase 3 works, written before the code and grown with every task. Design: [MARKETPLACE-AND-BILLING.md](MARKETPLACE-AND-BILLING.md) (MB),
tasks: [PHASE-3-TASKS.md](PHASE-3-TASKS.md), risks: [PHASE-3-RISKS.md](PHASE-3-RISKS.md). One builder (no separate QA): every stage is checked against
this list before its merge, and CI must be green.

## 1. The twelve suites

| # | Suite | What it proves | File (task) | State |
|---|---|---|---|---|
| 1 | Lifecycle | every row of MB 5.2 and the 5.5 timeline (active, past due 0 to 6, free edition or read-only, locked at 67); paying in grace has no gap; a late job never changes access | `platform/test/billing-core.test.ts` (BE-2: the pure part); `platform/test/billing-lifecycle.test.ts` (BE-5: the job, fake clock) | pure part done |
| 2 | Proration | the 3 worked examples + 30 edge rows (halves, month ends, leap day, Nepal midnight, yearly, minimum charge) | `platform/test/proration.table.ts` + `billing-core.test.ts` (QA-1, BE-2) | done |
| 3 | Quote = invoice | the invoice stored at checkout has exactly the quote's lines; a catalog change between quote and pay changes nothing | `business/backend/test/marketplace.test.ts` (BE-6) | |
| 4 | Entitlement parity | v1 (plans) and v3 (apps) give the same answers where v3 mirrors v1; after migration v3 ≥ v1 for every fixture and key | `platform/test/entitlements-contract.test.ts` with `backend-core/test/billing-oracle.ts` and `backend-core/test/fixtures/p3-businesses.ts` (BE-3) | |
| 5 | Limits | hard stop, soft to +20% then stop, warn at 80%, null unlimited, grants and add-ons never lower; the error body of MB 6.3 | `billing-core.test.ts` (pure, done); per-app counters in BE-3 | pure part done |
| 6 | Money invariants | line net + VAT = gross; lines = invoice; subtotal + VAT = total; revenue net = invoice net; commission + publisher = net; partner + Sheetal = commission; 400 random carts | `billing-core.test.ts` (BE-2), database CHECKs in `backend-core/test/p3-billing-tables.test.ts` (DB-1/2), BE-4 | pure + database done |
| 7 | Numbering | two payments at once get consecutive numbers; a failed transaction leaves no gap; unique per fiscal year; the year edge at 00:30 and 23:30 Nepal time around Shrawan 1 | `platform/test/billing-invoice.test.ts` (BE-4); unique `(fy, no)` in DB-2 | database part done |
| 8 | Idempotent payment return | the payer returning twice (or two parallel returns) makes one invoice, one number, one revenue set | BE-4 | |
| 9 | Refunds | maker ≠ checker; two checkers decide once; never above the payment; credit note with the original percentages | BE-7; database CHECKs in DB-2 | database part done |
| 10 | Coupons | one per business, dates, minimum spend, apps named, never below zero, one coupon per invoice | `billing-core.test.ts` (pure, done); redemption counters in BE-6 | pure part done |
| 11 | AI credits | first-expiring first; 20 parallel calls never overspend; own key never uses credits; locked preview never calls a model; keys never in a response or log | BE-8; `remaining` CHECK in DB-1 | database part done |
| 12 | Migration proofs P1 to P8 | nobody loses an app, limit, feature, seat or credit; nobody pays more at the first renewal; all-or-nothing per business; `--restore` removes only its run | `backend-core/test/migrate-plans.test.ts` (BE-10) | |

## 2. Rules every Phase 3 test follows
- Money is paisa (`BigInt` in the database, `Money` in code). A test never compares floats.
- Dates: Nepal days. A test that crosses midnight uses 18:14 and 18:15 UTC (23:59 and 00:00 Nepal).
- Isolation and permissions as in Phase 2: another business's subscription, invoice or coupon is "not found"; every business route needs
  `workspace.billing.manage` (read routes `workspace.billing.read` where it exists); every admin route its `platform.*` permission.
- Old tests pass unchanged. Businesses on `billingMode = plans` behave exactly as before every stage.
- Public answers (catalog, pricing pages) are scanned for "verified", PAN and the technology company's name.

## 3. The owner's hand tests, per stage (expected screens)

| Stage | Steps | Expect |
|---|---|---|
| Database (DB-1/2) | RUN-UPDATE | "all OK"; old Billing pages show the same invoices and totals |
| Catalog (BE-1) | open the public catalog; Admin → Settings | app cards with prices; the catalog read-only |
| Shadow | one test business on `shadow`; use Expenses, Reviews, Team invite | nothing changes on screen; the shadow log shows zero differences |
| Pilot | the pilot business: install a free app, start a trial, buy two apps with the eSewa test merchant, open the invoice, change an edition, cancel and undo | the invoice number INV-2083-84-0001, VAT shown, the subscriptions page matches |
| All | the launch gates G1 to G10 (PHASE-3-RISKS.md section 6), one by one | each ticked by its owner |
