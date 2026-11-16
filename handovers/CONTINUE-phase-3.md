# CONTINUE Phase 3 (updated 16 Nov 2026, about 11:30 Nepal time) · Phase 3 about 93% done (by task size: 51 of 55, S=1 M=2 L=3; OPS-2 counts half until the owner has run the cutover)

Phase 3 is being built stage by stage (PHASE-3-TASKS.md order). Read this, then `docs/architecture/PHASE-3-TEST-PLAN.md`, then the CHANGES notes named below.

## Done (stages 1-10 merged with CI green; 11-13 merged on 16 Nov after the tests ran on the owner's PC, GitHub Actions being off)
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
| 9 | #75 | BE-7 | admin billing API (`CHANGES-P3-BE-7.md`) |
| 10 | #76 | BE-8 | AI credits and the provider router (`CHANGES-P3-BE-8.md`) |
| 11 | main `d9d6dc8` | BE-10 | migration script plans → apps: dry run, apply, restore, proofs P1-P8, price report; `npm run billing:migrate` (`CHANGES-P3-BE-10.md`, `docs/p3-migration-howto.md`) |
| 12 | main `78f8d7b` | BE-11 | free posting: fair use per day, checked businesses publish at once, `is_verified` gone from public answers, `POST /start-free` (`CHANGES-P3-BE-11.md`) |
| 13 | main (branch `phase-3/P3-FE-1-marketplace`) | FE-1 | business Marketplace, edition drawer, Cart (one payment), Subscriptions page, price-protection card; only on `apps`; overview answers `lock`; bodies in `marketplace/bodies.ts` (`CHANGES-P3-FE-1.md`) |
| 14 | main | FE-2 | prompt kit `@sheetal/ui/billing` (one error mapper, UpgradePanel replaces the toast, LimitBanner, EditionBadge, AiLocked, ReadOnlyBanner), `useEntitlements()`, menu by app on `apps` (`CHANGES-P3-FE-2.md`) |
| 15 | main | FE-3 | admin Pricing (editions, limits, features, trials, add-ons, AI plans; who is affected; reason; approval), Coupons, Approvals, a business's App subscriptions (gifts, trial extension, AI credits); bodies in `billing-bodies.ts` (`CHANGES-P3-FE-3.md`) |
| 16 | main | FE-4 | admin App sales, App revenue (ranges in Nepal time, % change, CSV), App billing (VAT, tax invoices, IRD, refunds, shadow), Legal and required info (company details) (`CHANGES-P3-FE-4.md`) |
| 17 | main | FE-5 | website `/apps`, `/apps/:id`, `/pricing` from the public catalog, Start free; `/plans` kept until the cutover (`CHANGES-P3-FE-5.md`) |
| 18 | main | FE-6 | business AI page (state, credits meter, Sheetal AI plans into the cart, own keys for 4 providers, preferred provider, fallback switch); `withAiApp`; `/v1/ai/connections`, `/v1/ai/settings` (`CHANGES-P3-FE-6.md`) |
| 19 | main | OPS-1 | `npm run scratch` (a scratch copy of the database), `npm run billing:mode` (**the switch plans → shadow → apps, which did not exist**; R10 voiding), `check:money`, `check:catalog`, `RUN-P3-STEP-1.cmd`; dry run on a copy of the real data: 15 PASS, 2 skipped (payment in flight); a P1 false FAIL fixed (free plan with a leftover renewal date) (`CHANGES-P3-OPS-1.md`) |
| 20 | main | OPS-2 (scripts and runbook; **the cutover itself is not run**) | `docs/p3-cutover-runbook.md`; `RUN-P3-STEP-2.cmd` (the rehearsal on the copy: nine OK lines); `RUN-P3-CUTOVER-1..4.cmd`, `RUN-P3-GO-BACK.cmd`, `RUN-P3-CUTOVER-STATUS.cmd` (backup, preview, typed YES, apply); **Admin → Pricing → Billing rules** (the sales switch and the billing numbers had no screen); `npm run backup` refuses the scratch copy (`CHANGES-P3-OPS-2.md`) |

Every business is still on `billingMode = plans`: nothing has changed for any customer. `salesEnabled` is false.

## Cutover log (real data)
- **Step 1 done, 16 Nov 2026 about 16:55** (the owner's yes in chat): backup `2026-11-16_1655`, then `billing:migrate --apply`: 15 written,
  2 skipped (a plan payment in flight), 0 failed. After it: 17 on `plans`, 15 with app rows, 0 "less". Nobody sees a change. Sales off.
  Undo: `npm run billing:migrate -- --restore`. 
- **Step 2 done, 16 Nov 2026 about 16:56** (the owner's yes in chat): backup `2026-11-16_1656`, then `billing:mode --to=shadow --all --apply`:
  15 moved, 0 refused. After it: 2 on `plans` (payment in flight), 15 on `shadow`, 0 "less". The plan still answers; nobody sees a change.
  Undo: `RUN-P3-GO-BACK.cmd`, type `ALL`. **Shadow runs until 23 Nov 2026. Next real step: `RUN-P3-CUTOVER-3.cmd` (the pilot) or, from
  23 Nov, `-4` (everyone), each with the owner's yes. Check `RUN-P3-CUTOVER-STATUS.cmd` on the days between.**

## Next, in order
While Actions is off: branch, build, run the tests on the owner's PC workspace by workspace, fast-forward main, `git push origin main`.
1. **The cutover on the real data, by the owner, one step at a time** (`docs/p3-cutover-runbook.md`). Ask for the owner's yes before each:
   `RUN-P3-CUTOVER-1.cmd` (app rows; nobody sees a change) → `-2` (shadow) → 7 days, `RUN-P3-CUTOVER-STATUS.cmd` daily → `-3` (the pilot:
   Sheetal's own business first) → sales on in Admin → Pricing → Billing rules → the pilot hand test → `-4` (everyone).
   Before step 1: the 2 businesses with a plan payment in flight (approve or fail the payment in Admin → Billing, then `RUN-P3-STEP-1.cmd` again).
2. **Gate G2, the owner's decision:** the price report shows that after the 12-month lock, keeping every app costs 114% to 178% more than
   today's plan (the first renewal is unchanged). Lower the app prices in Admin → Pricing, or accept it; then `RUN-P3-STEP-1.cmd` again.
3. QA-2 sign-offs = the launch gates G1 to G10 (runbook table): G3, G5, G6, G7, G9, G10 are the owner's, Finance's and the accountant's.
4. Small leftovers from the screens (each CHANGES "Not in this stage"): usage per limit in `/entitlements`; the AI top-up as its own quote
   item; `AiLocked` on each app's AI button when that feature moves to `runAi()`; trial credits for new free businesses.
## Decisions taken so far (all inside the design; see each CHANGES)
- A cancelled subscription has no grace (MB 5.1 over one row of 5.2). Coupon before price protection. "Carry" below Rs 10.
- Mail, Promote, Payroll, Accounting, Restaurant are catalog-only entries (no manifests yet; their permissions stay in workspace). Promote Rs 300 and
  Expenses free 50 MB receipts are **Owner to confirm**.
- v1 keeps today's answers exactly; v3 never gives less than v1 for the 19 fixtures (parity test).
- BE-10: the script is TypeScript run with tsx (to call the live builders and quote); limits come from the plan with add-ons as grants until the
  lock ends; add-ons become `appId = "legacy"` records; lock monthly = old renewal ÷ months; open plan invoices listed, not voided; AI monthly credits
  via `ai_credits_monthly` grants (the lifecycle job adds them on `apps`). A whole-app grant now lifts a free-edition app (v3 fix).
- BE-11: the plan's listing limit stays only for businesses on `plans`; fair use 5 a day (20 for checked businesses) in `platform.posting`.
  One old assertion changed: `catalog.test.ts` expected `is_verified` (the owner's rule forbids it in public).
- BE-7: a refund's `endAccess` counts the refund window from the payment date. "Not sent to IRD" lists every issued tax invoice until the IRD link
  exists (`linked: false`). Approval requests last 72 hours. "Lapsed" in the revenue report = `expired` subscription events.

## Decisions in OPS-1 and OPS-2
- The mode switch is a script (`npm run billing:mode`), not an admin screen: every move is backed up, previewed and typed YES by the owner.
- Moving to `apps` needs 7 days on shadow and zero "less" differences, recorded **or computed at that moment** (a business nobody opens
  records nothing). `--force` skips the shadow rules only; a payment in flight and going back after a sale are never forced.
- P1 checks the end of the period only for a paid plan or a trial (a free plan's leftover `renewsAt` decides nothing under plans).
- One cutover script with `-Step`; a preview with one refused business stops the whole step; no owner script passes `--force`.

## Owner steps pending
1. RUN-UPDATE (no new migrations in stages 19 and 20), then `RUN-P3-STEP-1.cmd` and `RUN-P3-STEP-2.cmd` (both safe: a copy only).
2. Read `Desktop\p3-price-report.csv` and decide on the prices (gate G2).
3. Admin → Legal and required info → "Company details on invoices" (legal name, PAN, address), before the pilot.
4. Then the cutover, step by step, each with a yes (runbook).
