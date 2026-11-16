# CHANGES P3-FE-4: admin App sales, App revenue, App billing, Legal and required info

Phase 3, stage 16. MB sections 13 and 14.3, on the BE-7 routes. Staff screens only (live API); no server change.

## New admin pages (menu: Businesses → App sales, App revenue, App billing, Legal and required info)
| Page | Path | What |
|---|---|---|
| App sales | `/admin/sales` (`platform.revenue.read`) | every app sale and refund in Nepal time: business, invoice, app/edition, kind, method, gross, commission %, Sheetal net; totals (sales, VAT, commission, Sheetal net); pages; CSV |
| App revenue | `/admin/revenue` (`platform.revenue.read`) | Today / 7 days / 30 days / Custom (Nepal dates); sales, refunds, commission, Sheetal net, new / renewals / upgrades / add-ons, each with % change against the period just before; MRR (without VAT), trials started / converted, lapsed; by day / app / edition / method; CSV |
| App billing | `/admin/billing-apps` (`platform.billing.read`) | tabs: VAT per Nepal month (with credit notes, VAT to pay; CSV), tax invoices and credit notes, Not sent to IRD (all, until the IRD link exists), Refunds (stage; "Money sent" records the bank/wallet reference), Shadow check (businesses with "less" under apps) |
| Legal and required info | `/admin/legal` (`platform.settings.read`, change: `platform.settings.update`) | **Company details on invoices** (`platform.company`: trade name, legal name, PAN 9 digits, VAT registered, address, phone, email; reason required; last changes), links to Content (sale terms, refund policy, invoice footer) and to the field builder (required business info) |

The old Admin → Billing page (plan invoices) is unchanged: plans are still in use.

## Files
`admin/frontend/src/pages/{SalesRevenue,LegalInfo}.jsx`, `reportsLogic.js`, `reportsLogic.test.jsx`; `AdminApp.jsx` (menu, routes);
`nav.appSales/appRevenue/appBilling/legal` in `en-market.js` / `ne-market.js`.

## Tests
`reportsLogic.test.jsx` (12): today in Nepal around midnight UTC; custom ranges (order, a year at most); the query sends only the range (the server
works out Nepal days); the picker's choices and labelled date boxes; totals equal the rows and the pages show a mismatch; % change words; every CSV goes
through the audited export; the company body passes the `platform.company` schema itself (PAN 9 digits); guards; no partner name.
Run on the owner's PC: admin + business front-end 84/84, lint, admin build.

## Hand test
Admin → App revenue → Custom 1-15 Nov → numbers and the previous period; CSV (then Admin → Audit shows the export). App billing → VAT.
Legal and required info → fill the company details (legal name, PAN, address) with a reason. (Sales from the pilot appear after the pilot pays.)

## Go back
Revert, or hide the four menu items.
