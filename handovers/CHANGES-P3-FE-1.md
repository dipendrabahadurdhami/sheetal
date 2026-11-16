# CHANGES P3-FE-1: business marketplace, cart and Subscriptions page

Phase 3, stage 13. MB section 14.1. The screens on top of the BE-6 marketplace API. **Only a business on `billingMode = apps` sees them**
(the menu item and the new billing page); every business on today's plans keeps the old Plan and billing page exactly as it was.

## New pages (business panel)
| Page | Path | What |
|---|---|---|
| Marketplace | `/business/marketplace` (`?app=<id>` opens that app) | app cards from `GET /marketplace`: icon, tagline, Free / "from Rs x a month", status chip (Not installed, Free, Trial n days, Paid, Ends at period end, Payment due, Read only, Coming soon); search (English and Nepali), category chips, popular apps for the business type first; **Install free**, **Try 14 days**, **Upgrade** / **Change**, **Compare editions** |
| Edition drawer | (in Marketplace) | editions side by side: price a month, price a year with "You save n months", every limit (Unlimited for none), every feature; monthly/yearly switch; Add to cart / Switch to this / Install free / trial |
| Cart | `/business/marketplace/cart` | apps and add-ons in one cart, **one payment**; monthly/yearly for the whole cart; coupon box (`POST /coupons/check`); the quote panel shows the API's lines, proration notes, discount, VAT, total; Sheetal's live payment methods (from `GET /billing`); checkout → gateway, or the bank-transfer receipt form, or "Get it now" for a zero total |
| Subscriptions | `/business/billing` when on `apps` | each app with edition, status, next renewal, price, limits; open invoices with Pay; the next invoice (a quote of the renewals); add-ons into the cart; invoices and credit notes with a printable view; links to AI and to "Download my data"; Cancel (with undo), Remove (nothing is deleted) |
| Price protection card | (top of Subscriptions) | for a business moved by BE-10: the protected monthly price, the apps it covers, the end date; from 60 days before the end "Choose the apps you keep" |

## Files
- New: `business/frontend/src/pages/{Marketplace,Cart,Subscriptions,PriceProtection}.jsx`, `marketplaceLogic.js` (all the plain rules: money from paisa,
  chips, buttons, search, cart, request bodies), `business/frontend/src/billingMode.js` (the mode from `GET /entitlements`; null until known = today's pages).
- New texts: `shared/src/i18n/en-market.js` and `ne-market.js` (every English key has Nepali with the same placeholders), merged in `shared/src/core/i18n.jsx`.
- `BusinessApp.jsx`: the menu item "Apps marketplace" (only on `apps`, needs `workspace.billing.manage`), the routes `/business/marketplace` and
  `/business/marketplace/cart` (both need `workspace.billing.manage`), `/business/billing` shows Subscriptions on `apps` and the old page otherwise,
  the side chip says "Apps and billing" on `apps`.
- `LiveBilling.jsx`: the bank-transfer form shows an app invoice's exact amount with paisa (the old plan path still gets a whole-rupee number, unchanged).
- Server (small, additive): the marketplace bodies moved unchanged to `business/backend/src/modules/marketplace/bodies.ts` so the screen tests parse the
  pages' bodies with the same `.strict()` rules (TEAM-RULES #12); `GET /billing/overview` now also answers `lock` (protected price, months, apps, end), or null.

## Tests
- `business/frontend/src/pages/marketplaceLogic.test.js` (13): paisa formatting without floats, chips, buttons per mode, search and order, the cart,
  and **every body the pages send parsed with the API's own rules**; a stray field is refused.
- `business/frontend/src/pages/Marketplace.test.jsx` (13): the quote panel shows exactly the quote's numbers (the total is the API's, not a sum), Nepali
  names with English fallback, no page does arithmetic on a paisa field, the edition drawer (prices, saving, limits, features, buttons; none on `plans`),
  dialog/caption/row headers, `type="button"` on every raw button, `aria-pressed` chips, the coupon box answers Enter, the shell's mode switch and guards,
  every key in English and Nepali, never "verified".
- `business/backend/test/marketplace.test.ts`: one new test (the overview's `lock`: null, then the moved business's numbers, another business never sees it).
  The old 8 tests are unchanged.
- Run on the owner's PC: business API 427/427, business front-end 48/48, root front-end 300/302 (the 2 are `no-old-names.test.js`, the known
  Windows-only failure; it fails the same way without this change), lint, typecheck, boundaries, manifests, permissions, `help --check`, business build.
  GitHub Actions is still off, so there was no CI run.

## Not in this stage (said plainly)
- **Usage bars**: `GET /entitlements` gives each limit but not how much is used, so the Subscriptions page shows the limits as numbers. A usage figure per
  limit is a small API addition (FE-2 needs the same for `LimitBanner`).
- **"Tell me when it is ready"** on Coming soon cards: there is no route to store the wish, so the card says "This app is coming soon" and offers no button.
- **AI badge** on cards: the public catalog has no AI flag per app yet. The AI plan and top-up in the cart come with FE-6.
- **Download my data** links to Settings → Import and export (today's page); a real full export is not part of Phase 3's list.
- The read-only banner and limit prompts are FE-2.
- Not checked in a browser here (the built-in browser can't reach localhost, and no business on this PC is on `apps`).

## Hand test (pilot business, once Sheetal moves it to `apps` and switches sales on: OPS-1 steps)
1. Settings menu → Apps marketplace: the cards show prices; search "hotel"; filter Money.
2. Install a free app; start a trial of another (chip says "Trial, 14 days left").
3. Compare editions of Hotel → Yearly → Add to cart; add CRM; open the cart: one total, VAT shown; try a coupon.
4. Pay with the eSewa test merchant; back on Apps and billing the invoice has a tax number; View prints it.
5. Change Hotel to monthly (waits for the period end); Cancel CRM, then Undo cancel.

## Go back
Revert the merge, or keep every business on `billingMode = plans` (the pages then don't show; `/business/marketplace` only lets people look).
