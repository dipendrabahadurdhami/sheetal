# CHANGES P3-BE-4: tax invoices at payment, applying a subscription payment, the revenue ledger, credit notes

Phase 3, stage 5. MB sections 9, 11 and 13. Nothing can create a Phase 3 invoice yet from a screen (the checkout is BE-6) and every business is
on `billingMode = plans`, so no customer sees a change. The old invoice kinds (plan, addon, boost, banner) keep their old path untouched.

## What changed
| File | What |
|---|---|
| `platform/src/billing/invoice.ts` (new) | `fiscalYear()` in Nepal time; `nextTaxNumber()` (one atomic upsert of `doc_counters` row `__platform__` / `INV:<fy>` inside the payment transaction: consecutive under concurrency, rolled back with a failed payment); `createInvoiceFromQuote()` (stores exactly the quote, lines included); `applySubscriptionPayment()` (locks the invoice row, checks paid paisa = invoice paisa, numbers the tax invoice, updates subscriptions and add-ons, history rows, revenue rows, coupon use, audit row, event); `revenueRows()`; `issueCreditNote()` (negated lines, own number, refund rows with the original percentages, only once) |
| `backend-core/src/domain/billing.ts` | `applyPayment()` sends kind `subscription` to the new path (reads the revenue share and the seller name); other kinds unchanged |
| `backend-core/src/domain/money.ts` | **fix:** `fiscalYearOf()` counts in Nepal time (00:30 on Shrawan 1 in Nepal was still the old year) |
| `platform/src/settings/revenue-share.ts` | `appSales` (commission % on app sales, per app), **default 100%** until the owner enters the split (Q3, gate G3) |
| `platform/src/tenancy/platform.manifest.ts` | declares event `platform.invoice.issued` (the design's `billing.*` names: manifest events must start with the manifest id) |

## Decisions (Accountant / Owner to confirm, gate G5)
- Credit notes share the invoice number sequence (shown `CN-2083-84-0007`), so a number is never used twice in a fiscal year.
- A zero-total invoice takes no tax invoice number (MB 9.1, T8).
- The seller snapshot holds the site name only for now; the company's legal details setting comes with the admin screens (BE-7/FE-4).

## Tests
`platform/test/billing-invoice.test.ts` (database): fiscal year edges at 23:45 and 00:30 Nepal; quote = stored invoice; paying gives the number, subscription,
history, revenue (net and gross add up), event and audit; two parallel returns apply once; two payments at once get consecutive numbers; a failed payment
leaves no gap; a one-paisa mismatch is refused; test payments make no revenue; percentages kept at sale; credit note with the original
percentages, refused the second time; revenue splits add back for awkward amounts. Old tests unchanged (`fiscalYearOf` cases still pass).

## Owner
Nothing to see. Go back: revert the PR (the new path only runs for invoices of kind `subscription`, which nothing creates yet).
