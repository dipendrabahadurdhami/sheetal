# CONTINUE Phase 3 (updated 14 Nov 2026, about 12:00 Nepal time)

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
| 8 | #73 | BE-6 | business marketplace API: install, trial (once per app and per owner), cart quote = invoice, checkout with Sheetal's own gateways to the paisa, change/cancel/resume/remove, coupons, overview; old plan checkout refuses app invoices (`CHANGES-P3-BE-6.md`) |

Every business is still on `billingMode = plans`: nothing has changed for any customer. `salesEnabled` is false.

## Next, in order
1. **BE-7** admin routes: `GET|PUT /admin/pricing` (catalog with reason; refuse hiding an edition with subscribers), `/admin/coupons`, `/admin/subscriptions`
   (grant/extend with reason: `platform.subscription.grant`, new permission), `/admin/sales`, `/admin/revenue` (from `revenue_entries`, live only), `/admin/refunds`
   (maker-checker with `PlatformApproval`, executes `issueCreditNote` + `payments.refunded_paisa`), shadow-diff count, the company's legal details for the seller snapshot.
2. **BE-8** AI credits (grants, spend oldest-expiry first, own key, locked preview); **BE-10** migration script (`--dry-run`, `--apply`, `--restore`; reuse
   `platform/src/billing/mapping.ts`; add R5 dates/prices, R7 add-ons, R8 AI credits, R9 covered, R10 lock, R11 report); **BE-11** website posting fair use.
3. FE-1..6 (register `business.payments` in SETTING_DEFS with its screen and update the pinned list in `platform/test/settings-pure.test.ts`, saying so).
4. OPS-1 (runbook, owner scripts for shadow/pilot), OPS-2 (shadow 7 days → pilot → all): the owner's yes at each step, backup first.

## Decisions taken so far (all inside the design; see each CHANGES)
- A cancelled subscription has no grace (MB 5.1 over one row of 5.2). Coupon before price protection. "Carry" below Rs 10.
- Mail, Promote, Payroll, Accounting, Restaurant are catalog-only entries (no manifests yet; their permissions stay in workspace). Promote Rs 300 and
  Expenses free 50 MB receipts are **Owner to confirm**.
- v1 keeps today's answers exactly; v3 never gives less than v1 for the 19 fixtures (parity test).

## Owner steps pending
RUN-UPDATE (applies `20261113200000_p3_subscriptions` and `20261113210000_p3_invoicing_revenue`; backs up first). Then open
`http://127.0.0.1:4000/v1/public/catalog`: the app cards with prices.
