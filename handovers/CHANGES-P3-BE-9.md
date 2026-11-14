# CHANGES P3-BE-9: the payment router, the two payment systems, the paisa amount check

Phase 3, stage 6. MB section 12. Nothing customers see changes: today's plan checkout keeps using today's gateway settings; the new app checkout
(BE-6) will use this router.

## What changed
| File | What |
|---|---|
| `platform/src/payments/router.ts` (new) | `resolvePaymentMethods()`: Sheetal's purposes (`sheetal.subscription`, `sheetal.website`, `sheetal.managed_rent`) get only Sheetal's platform connections (+ bank transfer); a business's purposes (`business.invoice`, `business.pos`, `business.rent_self`) get only that business's connections, then its static QR, then "record by hand". No fall-back either way. Paused or down connections are hidden; in production test-mode connections only for staff testing on purpose. `assertMethodFor()` refuses again right before charging. `loadPaymentConnections()` reads only the right system's rows |
| `backend-core/src/lib/payments.ts` (additive) | `gatewayPaisa()`, `amountMatches()`, `rupeesText()`: eSewa/Fonepay answer in rupees with 2 decimals, Khalti in paisa; one paisa off is refused; no floating point. Today's verify functions unchanged |
| `platform/src/settings/defs.ts` | the definition of the business setting `business.payments` (the free static QR picture and its words); it is registered with its screen (FE-2), because today's test pins the list of business settings |

Test payments never reach revenue: `applySubscriptionPayment` (BE-4) writes revenue only for `mode = live`, and the database refuses a test row.

## Tests
`platform/test/payment-router.test.ts`: both directions refused; paused, down and non-payment connections hidden; another business's connection never offered;
test mode outside production and for staff only; the loader reads only Sheetal's rows for Sheetal's purposes. `backend-core/test/payments-paisa.test.ts`: amounts in
rupees and paisa, one paisa off refused, bad text refused.

## Hand test (after BE-6)
The pause/resume hand test (eSewa disappears from the app checkout) needs the new checkout screens; it is listed again with BE-6.

## Go back
Revert the PR (nothing calls the router yet).
