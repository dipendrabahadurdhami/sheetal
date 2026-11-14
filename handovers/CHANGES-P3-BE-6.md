# CHANGES P3-BE-6: the business marketplace API

Phase 3, stage 8. MB sections 5 and 16. Every route needs `workspace.billing.manage`. A business on today's plans can read `GET /marketplace` and gets
**409 `billing_mode`** for everything else, so nothing changes for any customer until Sheetal moves a business to `billingMode = apps`. Checkout also needs
`platform.billing.salesEnabled` (off by default: 409 `sales_off`).

## Routes (new file `business/backend/src/modules/marketplace/routes.ts`; **registered in `business/backend/src/app.ts`**)
| Route | What |
|---|---|
| `GET /v1/marketplace` | the public catalog + this business's apps (installed, status, access, edition, trial used, period end, waiting change) |
| `POST /v1/subscriptions/:appId/install` | a free edition (re-install brings everything back) |
| `POST /v1/subscriptions/:appId/trial` | once per business per app, and not again for the same owner's other business (abuse check); no card |
| `POST /v1/subscriptions/quote`, `/v1/addons/quote` | the cart's quote (same function as the invoice) |
| `POST /v1/subscriptions/checkout`, `/v1/addons/checkout` | stores the invoice from that quote and starts Sheetal's own gateway (eSewa, Khalti, Fonepay, bank transfer) with the exact paisa; a zero total (100% coupon) applies at once with no tax number |
| `POST /v1/subscriptions/invoices/pay` | pay an open app invoice (a renewal the job made); only this business's invoices |
| `POST /v1/subscriptions/:appId/change` | an upgrade answers 402 `payment_needed` with the quote (pay it in the cart); a downgrade or year-to-month waits for the period end |
| `POST /v1/subscriptions/:appId/cancel` / `resume` / `remove` | cancel at the period end (a trial ends now and falls to the free edition); resume before the end; remove = uninstall, never deletes data, refused while a paid period runs |
| `POST /v1/coupons/check` | the coupon's answer for this cart |
| `GET /v1/billing/overview` | subscriptions and app invoices (tax numbers, lines, VAT) |

## Changed
- `backend-core/src/lib/payments.ts`: the six gateway helpers take an optional exact `amountPaisa` (rupees with two decimals for eSewa/Fonepay, paisa for Khalti);
  without it they work exactly as before.
- `business/backend/src/modules/billing/routes.ts`: the payment return checks app invoices to the paisa; the old plan checkout answers 409 `billing_mode` for a
  business on `apps` and refuses app invoices ("Pay app invoices in Billing → Apps"); the paid message for apps.

## Tests
`business/backend/test/marketplace.test.ts`: permission on every route; plans mode refused; free install once; trial once per business and per owner, cancel falls
back to free; quote = stored invoice; eSewa test merchant: one paisa off refused, exact amount applied, tax number, test mode makes no revenue; another business's
invoice not found; coupon checked then once per business; 100% coupon applies without a number; upgrade needs payment; cancel/resume/remove; sales off. Old
`billing.test.ts` and `addons.test.ts` unchanged (plans mode).

## Hand test (pilot business, after the owner moves it to `apps` and switches sales on: steps come with OPS-1)
Install a free app, start a trial, put two apps in the cart, pay with the eSewa test merchant, see the invoice in the overview.

## Go back
Revert the PR, or keep every business on `billingMode = plans` (the routes then answer 409).
