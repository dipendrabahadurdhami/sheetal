# CONTINUE Phase 3 (updated 16 Nov 2026, about 06:00 Nepal time) · Phase 3 about 53% done (by task size)

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
1. **BE-10** migration script (`--dry-run`, `--apply`, `--restore`; reuse `platform/src/billing/mapping.ts`; add R5 dates/prices, R7 add-ons, R8 AI credits,
   R9 covered, R10 lock, R11 report); **BE-11** website posting fair use.
2. FE-1..6 (register `business.payments` in SETTING_DEFS with its screen and update the pinned list in `platform/test/settings-pure.test.ts`, saying so).
   FE-6 also needs: buying a Sheetal AI plan / top-up in the cart (quote items; see `CHANGES-P3-BE-8.md` "Not in this stage").
   FE-3/FE-4 use the BE-7 routes (`CHANGES-P3-BE-7.md` lists them); the approvals screen is `GET /admin/approvals` + `POST /admin/approvals/:id/decide`.
3. OPS-1 (runbook, owner scripts for shadow/pilot), OPS-2 (shadow 7 days → pilot → all): the owner's yes at each step, backup first.

## Decisions taken so far (all inside the design; see each CHANGES)
- A cancelled subscription has no grace (MB 5.1 over one row of 5.2). Coupon before price protection. "Carry" below Rs 10.
- Mail, Promote, Payroll, Accounting, Restaurant are catalog-only entries (no manifests yet; their permissions stay in workspace). Promote Rs 300 and
  Expenses free 50 MB receipts are **Owner to confirm**.
- v1 keeps today's answers exactly; v3 never gives less than v1 for the 19 fixtures (parity test).
- BE-7: a refund's `endAccess` counts the refund window from the payment date. "Not sent to IRD" lists every issued tax invoice until the IRD link
  exists (`linked: false`). Approval requests last 72 hours. "Lapsed" in the revenue report = `expired` subscription events.

## Owner steps pending
RUN-UPDATE (applies `20261113200000_p3_subscriptions` and `20261113210000_p3_invoicing_revenue`; backs up first). Then open
`http://127.0.0.1:4000/v1/public/catalog`: the app cards with prices.
Before the pilot: Admin → Settings → "Company details on invoices" (legal name, PAN, address).
