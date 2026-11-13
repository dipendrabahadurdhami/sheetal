# CHANGES P3-BE-2 (+ P3-QA-1 part): the pure billing core

Phase 3, stage 2. All billing maths as pure functions (no database, no clock), and the Phase 3 test plan with its proration table.
Design: MARKETPLACE-AND-BILLING.md (MB) sections 4 to 7. Nothing calls these yet; entitlements v3 (BE-3), invoices (BE-4), the jobs (BE-5)
and the routes (BE-6) will.

## Files (all new)
| File | What |
|---|---|
| `platform/src/billing/types.ts` | Catalog, BillingSettings (+ defaults), SubscriptionState, BillingState, CartItem, Coupon, Quote shapes |
| `platform/src/billing/days.ts` | Nepal days (UTC+05:45), anchors (day 1 to 28), month steps |
| `platform/src/billing/effective-status.ts` | status, access mode and edition from the dates (MB 5.1, 5.5, 7.2); what each access mode allows |
| `platform/src/billing/limits.ts` | hard, soft (+20%), warn at 80% (Q1); the larger limit wins, null = unlimited |
| `platform/src/billing/proration.ts` | exact share of a price for days left; upgrade credit/charge/due |
| `platform/src/billing/coupon.ts` | coupon rules and the discount spread over eligible lines |
| `platform/src/billing/lock.ts` | price protection for migrated businesses (Q2) |
| `platform/src/billing/quote.ts` | the quote: subscribe (first purchase, co-terming, yearly), change (upgrade, downgrade scheduled, month to year), renew (no gap in grace), add-ons, coupon, protection, minimum charge, VAT once per invoice |
| `platform/test/proration.table.ts` | QA-1: the 3 worked examples + edge rows, expected values worked out separately with exact fractions |
| `platform/test/billing-core.test.ts` | 61 tests: the table, the status timeline, limits, the three examples through `quote()`, the rules, 400 random carts that must add up |
| `docs/architecture/PHASE-3-TEST-PLAN.md` | QA-1: the 12 suites, test rules, the owner's hand tests per stage |

## Decisions made while building (within the design)
- A **cancelled** subscription has no grace: at its period end it falls to the free edition (or locks). MB 5.1 says so; one row of the 5.2 table
  ("cancelled, period ends unpaid -> past_due") reads otherwise; 5.1 wins because a cancelled owner expects no renewal.
- The coupon is applied **before** price protection, so protection compares the price really charged (a coupon can never push a total below zero).
- A "carry" line moves a total below the minimum charge (Rs 10) to the next invoice only when the cart has no full-price purchase.
- `AppCatalog.name` is optional (BE-1 seeds it from the manifests).

QA-1's `billing-oracle.ts` and `fixtures/p3-businesses.ts` come with BE-3 (the entitlement parity test is their first user).

## Owner
Nothing to see (pure code). Go back: revert the PR.
