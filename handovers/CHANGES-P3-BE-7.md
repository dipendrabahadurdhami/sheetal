# CHANGES P3-BE-7: the admin billing API

Phase 3, stage 9. MB sections 3, 5, 9, 11, 13, 14.3 and 16; SETTINGS.md section 7. Back end only: the admin screens are P3-FE-3 and P3-FE-4.
No customer sees a change: every business is still on `billingMode = plans` and `platform.billing.salesEnabled` is off.

## Routes (new files in `admin/backend/src/modules/`; **all registered in `admin/backend/src/app.ts`** under `/v1`)
| File | Route | What |
|---|---|---|
| `pricing.ts` | `GET /admin/pricing` | catalog in use, billing rules, paying/trial/free counts per edition, waiting requests, last 20 changes |
| | `POST /admin/pricing/preview` | `{ catalog }`: the changes, refusals, whether approval is needed |
| | `PUT /admin/pricing` | `{ catalog, reason }`: `catalog.version` must be the one in use (409). Saved (version + 1), or **202** "Sent for approval" when a price rise or a paid-limit cut hits paying businesses |
| `coupons.ts` | `GET/POST /admin/coupons`, `PATCH /admin/coupons/:id`, `GET /admin/coupons/:id/redemptions` | make a code, pause/resume/end/cap it (with the version), who used it |
| `subscriptions.ts` | `GET /admin/subscriptions`, `GET /admin/subscriptions/:tenantId` | all subscriptions; one business: subscriptions with the access in force now, gifts, add-ons, history, app invoices |
| | `POST /admin/subscriptions/:tenantId/grants`, `…/grants/:id/revoke` | a gift or extension (EntitlementGrant, end date + reason) and taking it back |
| | `POST /admin/subscriptions/:tenantId/:appId/extend-trial` | `{ days, reason, version }`, at most 90 days in all |
| `sales.ts` | `GET /admin/sales`, `GET /admin/revenue` | live RevenueEntry rows by Nepal day; totals, previous period %, by day/app/edition/method, MRR, trials started/converted, lapsed; `&format=csv` |
| | `GET /admin/billing/vat`, `/admin/billing/tax-invoices`, `/admin/billing/ird`, `/admin/billing/shadow` | VAT per Nepal month (invoices and credit notes), the numbered list, "not sent to IRD" (no IRD link yet: all issued are listed, `linked: false`), shadow-mode differences |
| `refunds.ts` | `GET /admin/refunds`, `POST /admin/refunds`, `POST /admin/refunds/:id/sent` | ask (whole invoice or named lines; `endAccess` only for a full refund inside the refund window), then record the bank/wallet reference |
| `platform-approvals.ts` | `GET /admin/approvals`, `POST /admin/approvals/:id/decide` | maker-checker for staff: 72 hours, the maker never decides, one conditional claim; when nobody else holds the approver permission the request runs at once and the audit says the check was skipped |

Permissions: read pricing/coupons/billing lists `platform.billing.read`; change prices and coupons `platform.pricing.manage`; sales/revenue
`platform.revenue.read`; refunds `platform.billing.refund`; subscriptions read `platform.business.read`. **New** (super admin only at first):
`platform.subscription.grant` (gifts, trial extension) and `platform.billing.export` (every CSV, audited `billing.export`).

## Changed
- `platform/src/billing/invoice.ts`: `issueCreditNote()` takes optional `lineIds` (a part of a bundle, each line once); every credit line keeps
  `description.creditOfLineId`; it returns `totalPaisa`, `lineIds`, `whole`. Without `lineIds` it works as before.
- New `platform/src/billing/pricing-impact.ts` (pure) and `platform/src/billing/company.ts`: the typed setting **`platform.company`** (trade name,
  legal name, PAN, VAT registered, address, phone, email; private). `sellerSnapshot()` is now what paid invoices keep as the seller
  (`backend-core/src/domain/billing.ts`, `business/.../marketplace/routes.ts`); until the owner fills it in, it is `{ name: site name }` as before.
- `platform/src/settings/routes.ts`: the generic settings route refuses `platform.catalog` ("Change app prices on the Pricing screen").
- `platform/src/tenancy/platform.manifest.ts`: the two permissions; events `platform.refund.executed` and `platform.catalog.changed`. Generated files rebuilt.
- After an approved price rise, owners of paying businesses get a notice with the date (`priceChangeNoticeDays`) the new price reaches renewals.

## Tests
`admin/backend/test/billing-admin.test.ts` (DB): pricing 403 for operations, the generic route refused, a cut saved with reason and audit, stale version
409, a rise waits for approval (maker 403, operations 404, second finance approves, version + 1, event, decided twice 409), free edition in use cannot
be switched off; coupons (403, capitals, duplicate 409, unknown app, pause with version, stale 409, audit); gifts need the new permission and a reason,
revoke once; trial extension with version; sales by Nepal day around midnight, test payments never appear, totals = rows, CSV needs export and is audited;
refunds: part of a bundle (maker can't approve, CN number, refund rows for that line only, the same line or the whole invoice refused after, event,
money sent once), rejected changes nothing, test payment refused, one-person team runs at once with checker empty and ends access to the free edition;
VAT per month adds credit notes, tax-invoice list, IRD `linked: false`, shadow counter.
`platform/test/pricing-impact.test.ts` (pure): rise/cut, paid vs free limit, refusals vs hiding, add-on rise, no change; `sellerSnapshot()`.

## Owner
Nothing to run for this stage beyond the pending `RUN-UPDATE.cmd` (no new migration). Before the pilot: fill in Admin → Settings → Company details
on invoices (legal name, PAN, address).
