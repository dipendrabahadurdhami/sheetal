# CHANGES P3-FE-3: admin Pricing, Coupons, Approvals and a business's Subscriptions

Phase 3, stage 15. MB section 14.3, on the BE-7 admin billing API. Staff screens only (live API); no customer sees a change.

## New admin pages
| Page | Path | What |
|---|---|---|
| Pricing | `/admin/pricing` | every app: editions side by side with price a month and a year (rupees, 2 decimals), limits (empty = unlimited; hard stop or soft with % over), features (tick, or add a new key), trial days, free edition on, shown in the marketplace, live / coming soon; paying / trial / free counts per edition; seat and add-on prices, add-ons on sale; Sheetal AI plan prices and credits. **Who is affected?** (`POST /admin/pricing/preview`): each change in words, paying subscriptions affected, "Needs approval", refusals. A reason (5-300 characters) is required; Save or **Send for approval** (202). Someone saved first → 409 → "Reload". Waiting approvals and the last 20 versions. Read only without `platform.pricing.manage`. |
| Coupons | `/admin/coupons` | list with uses and total discount; new coupon (percent, amount in rupees, extra trial days; apps; first purchase; minimum spend; Nepal dates; total cap; per business; periods); pause / resume / end now (with the version); who used it |
| Approvals | `/admin/approvals` | waiting and decided requests (price rises with paying customers, refunds); Approve / Reject with a note; the maker sees "another person decides" |
| Business subscriptions | `/admin/tenants/:id/subscriptions` (button "App subscriptions" on the business page) | apps with the status and access in force now, price vs list price, ends; gifts and extensions (in force / taken back) with Take back; add-ons; history; app invoices and credit notes; **Gift or extend** (whole app, a higher limit, a feature, seats; end date; reason), **Extend trial** (with the version), **Gift AI credits** |

Menu: Pricing, Coupons, Approvals under Businesses (live API only). The old Plans and Add-ons pages stay as they are: every business is still on
`plans` and needs them until the cutover (MB 14.3's "read-only Legacy plans" belongs with OPS-2, when the first businesses move).

## Files
- New: `admin/frontend/src/pages/{Pricing,Coupons,PlatformApprovals,BusinessSubscriptions}.jsx`, `pricingLogic.js` (rupees ↔ paisa as text, catalog
  edits on a copy, every request body), `pricingLogic.test.jsx`.
- `AdminApp.jsx` (menu + routes), `AdminTenants.jsx` (the "App subscriptions" button), `nav.pricing/coupons/approvals` in `en-market.js` / `ne-market.js`.
- Server (no behaviour change): the admin billing bodies moved unchanged into `admin/backend/src/modules/billing-bodies.ts` and are imported by
  `pricing.ts`, `coupons.ts`, `subscriptions.ts`, `platform-approvals.ts`, so the screen tests parse with the same rules.

## Tests
`admin/frontend/src/pages/pricingLogic.test.jsx` (13): rupees with up to 2 decimals → paisa without floating point (round trip for many amounts; bad
input refused); catalog edits never touch the original; **every body parsed with the API's own rules** (pricing preview/save with reason, coupons of
each kind with Nepal dates and caps, coupon pause/end with version, gifts of each kind, take back, trial extension, AI credits, approval decision);
a price rise renders "3 paying subscriptions affected" + "Needs approval"; the one-person-team note; refusals as alerts; Save waits for the check and
a valid reason; menu, guarded routes, the business page link; `type="button"`.
Run on the owner's PC: admin API 134/134 (unchanged tests, after the bodies move), root front-end incl. these, lint (no new warnings), typecheck,
admin build. GitHub Actions is off.

## Hand test (staff test accounts)
1. Admin → Pricing → Hotel → change the free rooms limit → Who is affected? → reason → Save prices.
2. Raise the Full price while a test business pays for it → Who is affected? says Needs approval → Send for approval.
3. Sign in as a second finance staff → Approvals → Approve with a note → Pricing shows the new version.
4. Coupons → New coupon DASHAIN10, 10% off Hotel → pause, resume.
5. Businesses → a business → App subscriptions → Gift or extend → whole app Hotel for 30 days.

## Go back
Revert; or hide the three menu items. The API stays as BE-7 left it.
