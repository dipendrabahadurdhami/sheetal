# Phase 3 tasks: marketplace, per-app subscriptions, pricing

Status: plan for Phase 3 (task P3-ARCH). Nothing here is built. Design: [MARKETPLACE-AND-BILLING.md](MARKETPLACE-AND-BILLING.md) (called **MB** below, with section numbers). Risks: [PHASE-3-RISKS.md](PHASE-3-RISKS.md).

## 0. How to read this

- Same task style as Phase 1: one task = one chat = one branch from the latest `main` = one `OUT-<ID>.zip` (CHANGES, HANDOVER, full files). Rules in TEAM-RULES.md apply to every task (full files only, one migration per DB task, `/// @app` on new models, no new npm packages, PowerShell commands, say what you could not run).
- **Start condition.** Phase 3 code starts only when Phase 2 has ended and `main` is green. It needs from Phase 1 and 2: the kernel (`BaseService`, `Money`, events and outbox), all apps on the kernel, the typed settings store (P1-BE-9), the Integration Center framework (P1-BE-8) and its screens (P1-FE-5), paisa columns, and `buildEntitlements()` in `platform/src/tenancy/context.ts`. If one is missing, the task says what it uses instead; the Lead decides before the task starts.
- File paths below follow FOLDERS-AND-MOVE-PLAN.md. Phase 2 may have moved some files; **the Lead gives each chat the real paths** and the files it must read (listed under "Needs").
- Sizes: S = a few files, M = about the size of P1-BE-4, L = about the size of P1-BE-5 (one app moved to the kernel, roughly 20 files). No task is bigger than L. A task that grows past L stops and writes its handover (TEAM-RULES).

## 1. The order at a glance

```
            ┌─ P3-QA-1 (test plan and oracles, written first, grows with every task)
Phase 2 ends ─┤
            └─ P3-DB-1 ─► P3-DB-2 ─┬─► P3-BE-1 ─┬─► P3-BE-3 ─┬─► P3-BE-6 ─► P3-FE-1
                                    │            │            ├─► P3-BE-10 ─► P3-OPS-1 ─► P3-OPS-2 (shadow, pilot, all)
                                    ├─► P3-BE-2 ─┤            └─► P3-FE-2
                                    │            └─► P3-BE-4 ─► P3-BE-5
                                    ├─► P3-BE-9 (payment router; independent)
                                    ├─► P3-BE-8 (AI) ─► P3-FE-6
                                    ├─► P3-BE-7 (admin API, after BE-4) ─► P3-FE-3, P3-FE-4
                                    └─► P3-BE-11 (website posting) ─► P3-FE-5
```

| Can run at the same time | Why it is safe |
|---|---|
| P3-QA-1 with everything | it only writes tests and fixtures |
| P3-BE-1 ‖ P3-BE-2 ‖ P3-BE-9 (after DB-2) | different folders; BE-2 is pure code with no database |
| P3-BE-3 ‖ P3-BE-4 (after BE-1 and BE-2) | entitlements and invoicing share only the pure core |
| P3-BE-8 ‖ P3-BE-5 ‖ P3-BE-10 | different folders |
| P3-FE-2 ‖ P3-FE-3 ‖ P3-FE-4 ‖ P3-FE-5 (after their API tasks) | different front-end folders |

| Must NOT run at the same time | Why |
|---|---|
| P3-DB-1 and P3-DB-2 (and any other DB work) | both edit the one `schema.prisma`; older copies overwrote newer ones twice in Phase 0 (TEAM-RULES #10) |
| P3-BE-4 and P3-BE-7 | both change the refund and invoice routes |
| P3-OPS-2 and any BE task | the cutover freezes billing code |

Gate between stages: QA approves, the Lead merges, CI is green, `prisma migrate diff` is empty.

## 2. Tasks

### P3-QA-1 — Test plan, fixtures and oracles (QA) · size M · first, in parallel with DB-1
- **Goal:** everything the other tasks need to be proven, written before the code. 
- **Files:** `docs/architecture/PHASE-3-TEST-PLAN.md`; `backend-core/test/billing-oracle.ts` (like `permissions-oracle.ts`: the v1 entitlement rules written out by hand as the reference); `backend-core/test/fixtures/p3-businesses.ts` (every type × Starter/Business/Pro × add-ons × status: active, trial, past_due, suspended, covered, demo); `platform/test/proration.table.ts` (the three worked examples in MB §5.3 plus 30 more: leap days, month ends, Nepal midnight, yearly, minimum charge).
- **Tests:** the plan lists the 12 suites: lifecycle (every row of MB §5.2), proration, quote vs invoice equality, entitlement parity v1 vs v3, limits (hard, soft, 80%), money invariants (lines = invoice, VAT, revenue = invoice net), numbering (two payments at once, fiscal year edge at 01:00 Nepal on Shrawan 1), idempotent payment return, refunds, coupons, AI credits (FIFO, no overspend under concurrency), migration proofs P1 to P8.
- **Hand test:** the owner's click list per stage (shadow, pilot, all) with expected screens.
- **Go back:** documents and tests only; delete the files.
- **Needs:** this document, MB, ACCESS.md §13 (the style of the permissions tests).

### P3-DB-1 — Subscription tables (Database) · size M · migration `p3_subscriptions`
- **Goal:** the tables of MB §15 that hold state: `Subscription`, `SubscriptionEvent`, `EntitlementGrant`, `AddonSubscription`, `BillingLock`, `BillingMigrationRun`, `AiCreditGrant`; columns `Tenant.billingMode`, `AiUsage.appId/provider/source/requestId`.
- **Files:** the newest `backend-core/prisma/schema.prisma` (whole file), the migration folder, `platform/src/tenancy/platform.manifest.ts` (models list), `scripts/check-schema-ownership` expectations, `CHANGES-P3-DB-1.md`.
- **Tests:** `prisma migrate diff` empty; ownership check passes (`/// @app platform` on every model); a SQL test for each CHECK (status words, `remaining ≤ credits`, unique `(tenantId, appId)`); a test that **no existing row changes** (counts before and after on a copy).
- **Hand test:** `npm run db:local`, apply the migration, open Prisma Studio: tables exist and are empty; the old pages still load.
- **Go back:** revert the branch; the migration only adds. If applied by mistake, a down script drops only the new tables and the new columns (named in CHANGES).
- **Needs:** newest `schema.prisma`, `platform.manifest.ts`, `MODEL-OWNERS.md`, MB §15.

### P3-DB-2 — Invoicing, revenue, coupons, approvals (Database) · size M · migration `p3_invoicing_revenue` · after DB-1
- **Goal:** `Invoice` changes (`no`, `fy`, `issuedAt`, paisa columns, `sellerSnapshot`, `creditForId`, `couponId`, `catalogVersion`; `planId` optional; new kinds), `InvoiceLine`, `Payment` changes (`amountPaisa`, `mode`, `refundedPaisa`, refund fields), `RevenueEntry`, `Coupon`, `CouponRedemption`, `PlatformApproval`; triggers: issued invoice money cannot change, `RevenueEntry` cannot update or delete; unique `(fy, no)`.
- **Backfill (data-only, same migration or a second named step):** paisa = rupees × 100 for every old invoice and payment; `mode = "live"` for existing payments except those made with eSewa's public test merchant (marked `test`); nothing deleted. This is the same pattern as `20261111120000_expenses_paisa_resync`.
- **Tests:** backfill equals old rupees × 100 on every row; the triggers refuse an update; old queries (`/billing`, admin invoices) still return the same numbers; `migrate diff` empty.
- **Hand test:** the old Business → Billing page and Admin → Billing → Payments show the same invoices and totals as before.
- **Go back:** revert; the backfill only fills new columns.
- **Needs:** schema after DB-1, `Invoice`/`Payment` code (`domain/billing.ts`), CHANGES-P1-DB-3 (backfill style).

### P3-BE-1 — Catalog, billing settings, public catalog (Backend) · size M
- **Goal:** MB §3 and §16: `platform.catalog` and `platform.billing` as typed settings with guards; seeding from manifests; the optional manifest field `availability`; real `limits` and `editions` written into each `app.manifest.ts` as **defaults** (keys in MB §8.2; prices from MB §3.4 are in the seed file, not in manifests, so the owner's numbers are not code); new apps `mail`, `promote` as manifests; `GET /public/catalog` (public fields only).
- **Files:** `platform/src/billing/catalog.ts`, `platform/src/billing/catalog.seed.ts`, `platform/src/core/manifest.ts` (additive field), `scripts/lib/manifests.mjs` and `scripts/check-manifests.mjs` (new rules: every limit key used in an edition is declared; paid edition has a price in the seed), the 15 manifests, `apps/mail/`, `apps/promote/` (manifest only), website public route, tests.
- **Tests:** guards (MB §3.3); the seed equals the manifest defaults; a saved value is never overwritten by a new release; the public endpoint has no PAN, partner name, or internal field (a test that scans the JSON); `npm run gen:permissions` and `check:manifests` pass.
- **Hand test:** Admin → Settings shows the catalog JSON read-only (screens come in FE-3); the public endpoint returns the app cards.
- **Go back:** revert the branch; no table is involved.
- **Needs:** KERNEL, APP-MANIFEST, SETTINGS.md, `platform/src/core/manifest.ts`, `scripts/check-manifests.mjs`, `scripts/lib/manifests.mjs`, the settings registry from P1-BE-9, every `app.manifest.ts`.
- **Parallel:** with BE-2 and BE-9.

### P3-BE-2 — The pure billing core (Backend) · size M
- **Goal:** all billing maths as pure functions, no database, no clock: `effectiveStatus`, `accessMode`, `quote` (MB §5.4), proration (§5.3), coupon rules, the monthly anchor and co-terming, price-protection line, `Money` use everywhere.
- **Files:** `platform/src/billing/{effective-status,access,quote,proration,coupon,anchor,lock}.ts`, `platform/test/billing-*.test.ts` (table-driven from P3-QA-1).
- **Tests:** every row of MB §5.2; the 3 worked examples; property tests: lines add to total, VAT split adds back, a coupon never goes below zero, `due ≥ 0`, a quote is the same when run twice; Nepal-midnight edges.
- **Hand test:** none (pure); the QA task prints the table of quotes for review by the owner.
- **Go back:** revert.
- **Needs:** `platform/src/core/money.ts`, MB §4 and §5.
- **Parallel:** with BE-1 and BE-9.

### P3-BE-3 — Entitlements v3, shadow mode, limits (Backend) · size L
- **Goal:** MB §6 and §7: `platform/src/billing/entitlements.ts` builds `Entitlements` from subscriptions, grants and add-ons; the three new methods; `BaseService.action()` calls `requireWrite`; limit **usage counters** registered by each app's `host.ts` for the limits in MB §8.2; per-business flag: `plans` uses v1, `shadow` runs both and logs differences, `apps` uses v3; the small `GET /entitlements` route; the contract test run against v1 and v3.
- **Files:** `platform/src/billing/{entitlements,usage,shadow}.ts`, `platform/src/core/service.ts` (additive), `platform/src/tenancy/context.ts` and `system-context.ts` (choose builder by `billingMode`), each app's `host.ts` (usage counters), `business/.../entitlements/routes.ts` and its registration in `app.ts` (**say so in CHANGES**), tests including `entitlements-contract.test.ts` and the seat-unpause fix check.
- **Tests:** contract test (same answers for the same inputs where v3 is configured to mirror v1); v3 ≥ v1 for the fixtures after migration; each access mode (MB §7.2) for create, update, read; cache clears on `billing.subscription.changed`; shadow diff written, v1 answer returned; jobs skip non-`full` businesses.
- **Hand test:** set one test business to `shadow`; use Expenses, Reviews, Team invite; the shadow log shows zero differences.
- **Go back:** set `billingMode = plans` (default). Code is inert for businesses on `plans`.
- **Needs:** BE-1, BE-2, DB-1, `platform/src/tenancy/context.ts`, `system-context.ts`, `platform/src/core/service.ts`, each app's `host.ts` and `scope.ts`, ACCESS.md §7 and §10.

### P3-BE-4 — Tax invoices, payment apply, revenue ledger (Backend) · size L
- **Goal:** MB §9 and §13: issue the tax invoice and receipt **on payment** inside the payment transaction (`INV-2083-84-0001` via `DocCounter`, `tenant_id = "__platform__"`); `InvoiceLine`; `applyPayment` v3 for kinds `subscription` and `addon` (boost and banner kinds untouched); `RevenueEntry` rows with commission and partner share (`platform.revenueShare.appSales`); credit notes; the `fiscalYearOf` fix and tests; event `billing.invoice.issued`; amount-in-paisa check.
- **Files:** `backend-core/src/domain/billing.ts` (keeps old exports, adds v3 path), `platform/src/billing/{invoice,numbering,revenue,credit-note}.ts`, `backend-core/src/domain/money.ts` (`fiscalYearOf` fix), tests.
- **Tests:** two payments at once get two consecutive numbers; a failing transaction leaves no gap; returning twice changes nothing; fiscal year edge (01:00 Nepal on Shrawan 1); lines = invoice; revenue net = invoice net; commission and partner rounding adds back (`publisher + commission = net`); changing the setting does not change old entries; a credit note reverses with the original percentages; legacy kinds still pay.
- **Hand test:** with the eSewa test merchant, pay a test subscription; open the tax invoice; check numbers, VAT and the revenue entry in the database.
- **Go back:** revert; old `applyPayment` path is still in the file for `plans` mode.
- **Needs:** `domain/billing.ts`, `domain/money.ts`, `lib/payments.ts`, `business/.../billing/routes.ts`, `invoicing/routes.ts` (`nextNo` pattern), DB-2.
- **Not parallel with:** BE-7.

### P3-BE-5 — Lifecycle jobs (Backend) · size M · after BE-4
- **Goal:** MB §5.5: the renewal job v3 (renewal invoices with **price protection**, reminders −7 −1 0 +3 +6, `past_due`, free-edition fallback, `read_only`, `locked`, trial reminders and end, scheduled downgrades, `cancelled` → `expired`, seat auto-pause, covered-business sync replacing `syncCovered`); each step idempotent; writes `SubscriptionEvent`; mails with the existing templates (new keys listed in CHANGES).
- **Files:** `platform/src/billing/lifecycle.ts`, `business/backend/src/jobs.ts` and `admin/backend/src/jobs.ts` (registration), mail template seeds, tests with a fake clock.
- **Tests:** one test per timeline row; running the job twice or a day late gives the same end state; a business never loses access early; paying in grace restores without a gap; `billingMode = plans` businesses are ignored.
- **Hand test:** with the clock tool in the QA task, move a test business through trial, past due, read-only, locked and back by paying.
- **Go back:** disable the new job in `jobs.ts` (one line); the old cycle still runs for `plans` mode.
- **Needs:** `domain/billing.ts` (`runBillingCycle`), both `jobs.ts`, BE-2, BE-3, BE-4.

### P3-BE-6 — Business API: marketplace and subscriptions (Backend) · size L · after BE-3 and BE-4
- **Goal:** the routes of MB §16 (business): `/marketplace`, `/subscriptions/*`, `/addons/*`, `/coupons/check`, `/billing/overview`; checkout builds the invoice from the same `quote`; install and remove; trial start with the once-per-app rule and abuse checks; old `/billing*` routes answer from legacy data for `plans` mode and a clear message for `apps` mode; `limit_reached` and `subscription_read_only` error shapes (MB §6.3).
- **Files:** `business/backend/src/modules/marketplace/*` (or the workspace app's backend, per Phase 2), `business/backend/src/app.ts` (**register the routes; say so**), `business/backend/test/marketplace.test.ts`, `.strict()` bodies checked against the pages (FE-1) — the FE task checks the same shapes (TEAM-RULES #12).
- **Tests:** quote equals invoice; a second trial is refused; a coupon is used once per business; a permission check on every route (`workspace.billing.manage`); a business cannot pay with another business's invoice; old tests of `billing.test.ts` and `addons.test.ts` still pass in `plans` mode.
- **Hand test:** as the pilot business: install a free app, start a trial, put two apps in the cart, pay with the eSewa test merchant, see the invoice.
- **Go back:** the routes check the flag; `billingMode = plans` hides them.
- **Needs:** BE-3, BE-4, the old billing routes and tests, `app.ts`.

### P3-BE-7 — Admin API: pricing, coupons, subscriptions, sales, revenue, refunds (Backend) · size L · after BE-4
- **Goal:** `GET|PUT /admin/pricing` with reason, impact count and `PlatformApproval` for price rises with paying customers; coupons CRUD; `/admin/subscriptions` (view, gift or extend through `EntitlementGrant`, extend trial); `/admin/sales` and `/admin/revenue` (SETTINGS.md §7 queries on `RevenueEntry`, Nepal-time ranges, CSV with audit); refunds with maker-checker and credit note (MB §11); VAT summary; "not sent to IRD" list; shadow-diff counter.
- **Files:** `admin/backend/src/modules/{pricing,coupons,subscriptions,sales,revenue,refunds}.ts`, `admin/backend/src/modules/routes.ts` and `app.ts` (**register; say so**), tests.
- **Tests:** SETTINGS.md §7.4 list (Nepal boundaries, setting change does not rewrite history, test-mode excluded, totals = rows, non-finance gets 403); a refund cannot be approved by its maker; a one-person team skips approval with an audit note; a price change with no paying customers needs no approval.
- **Hand test:** change a price with the pilot business paying; see the approval; approve with a second staff user; open the renewal preview.
- **Go back:** revert; old admin pages stay.
- **Needs:** BE-4, the admin files in `admin/backend/src/modules/` (billing, plans, addons, earnings, payouts, routes), `platform/src/settings/*`.
- **Not parallel with:** BE-4.

### P3-BE-8 — AI credits and provider router (Backend) · size L · after DB-1, BE-1
- **Goal:** MB §10: `AiCreditGrant` spending with FIFO and row locks, `ai(appId)` in Entitlements, the provider router over Integration Center business connections (`ai.anthropic`, `ai.openai`, `ai.gemini`, `voice.elevenlabs`), locked-preview responses (no model call), credit rates as catalog settings, the failed-call refund, monthly allowance grants by the lifecycle job; the old `aiFor()` stays as the `plans` mode path.
- **Files:** `platform/src/billing/ai.ts`, `backend-core/src/lib/ai.ts` (additive), provider adapters per INTEGRATIONS.md §2 (one file each: openai, gemini, elevenlabs; anthropic exists), `business/.../aiaccount/routes.ts` (reads the connection), tests with a fake provider.
- **Tests:** 20 parallel calls never overspend; credits expire first-expiring-first; a refused call never reaches the provider; own-key calls take no credits; fallback only when the owner switched it on; keys never appear in any response or log (a scan test).
- **Hand test:** with a test key: locked preview, then connect the key, then use Sheetal credits, then run out.
- **Go back:** `billingMode = plans` uses the old `aiFor()`.
- **Needs:** `lib/ai.ts`, `domain/ai-features.ts`, `aiaccount/routes.ts`, `devkeys` if it uses keys, INTEGRATIONS.md §2 and §13, the Integration Center code.
- **Parallel:** with BE-5, BE-10.

### P3-BE-9 — Payment router and the two systems (Backend) · size M · after DB-2
- **Goal:** MB §12: `PaymentRouter.resolve(ctx, purpose)`; Sheetal-only for subscriptions; business-only for business apps; no fall-back; test mode kept apart; the paisa amount check in `lib/payments.ts` for eSewa, Khalti (paisa) and Fonepay; checkout lists only `live` and healthy platform connections; static QR as a business payment method.
- **Files:** `platform/src/payments/router.ts`, `backend-core/src/lib/payments.ts` (additive), the business settings payments section, tests.
- **Tests:** a subscription can never resolve a business connection and the reverse; a `down` provider is hidden; a paused one is hidden; amount mismatch by one paisa is refused; test payments never reach `RevenueEntry`.
- **Hand test:** pause eSewa in the Integration Center: it disappears from checkout; resume: it returns.
- **Go back:** revert; old gateway code keeps its path.
- **Needs:** `lib/payments.ts`, the Integration Center code, `business/.../settings/routes.ts`, `domain/rentpay.ts` (to name purposes only).
- **Parallel:** with BE-1, BE-2.

### P3-BE-10 — Migration script from plans to apps (Backend) · size L · after BE-3
- **Goal:** MB §8: `backend-core/scripts/migrate-plans-to-apps.mjs` with `--dry-run`, `--apply`, `--restore`, `--business`, `--verbose`, `--csv`, `--catalog`; proofs P1 to P8; masked names; PASS or FAIL exit code; price report.
- **Files:** the script, `backend-core/test/migrate-plans.test.ts`, `backend-core/test/migrate-plans.fixtures.ts`, a short `docs/p3-migration-howto.md`.
- **Tests:** every fixture from P3-QA-1: P1 to P8 pass; a deliberately broken mapping makes the proof FAIL and `--apply` refuse; idempotent second run; `--restore` removes only that run's rows; a business with a payment in flight is skipped and listed.
- **Hand test:** the dry run on the owner's own data (Sheetal Property business): read the printout; run with `--business=<id>`; then the price report.
- **Go back:** `--restore`.
- **Needs:** `scripts/rewrite-role-perms.mjs` (style), BE-3 builders, `domain/{plans,addons,billing}.ts`, the generated registry.

### P3-BE-11 — Free website posting and the public catalog (Backend) · size M · after BE-1
- **Goal:** website posting stops reading plan limits; own `platform.posting.fairUse` (per person and per day, higher for verified posters); unverified posters' posts go to review, verified posters publish at once; **no public API or page exposes "verified"**; the plan routes (`/subscription-plans`, upgrade requests) are replaced by the public catalog and a "Start free" hand-off.
- **Files:** `website/backend/src/modules/posting/routes.ts`, `catalog/present.ts`, `public/routes.ts`, tests (`write.test.ts`, `catalog.test.ts` updated).
- **Tests:** a scan of every public response for the words "verified" and for PAN; fair-use limits refuse the 6th post; a verified poster's post is `published`, an unverified one is `pending`.
- **Hand test:** post as a new user (goes to review), approve in Admin; post as a verified user (goes live).
- **Go back:** revert.
- **Needs:** the website posting, catalog, public routes and their tests, `Tenant.verification`.

### P3-FE-1 — Business marketplace, cart, subscriptions page (Frontend) · size L · after BE-6
- **Goal:** MB §14.1: Marketplace, edition drawer, cart and checkout, Subscriptions page, price-protection card, "Download my data"; Nepali and English text for every string (`ne` falls back to `en`, flagged).
- **Files:** `business/frontend/src/pages/{Marketplace,Cart,Subscriptions,PriceProtection}.jsx`, `shared/src/i18n/*`, `business/frontend/src/App.jsx`, replacing `BusinessBilling.jsx` and `LiveBilling.jsx` for `apps` mode.
- **Tests:** component tests for the quote panel (numbers come only from the API), keyboard and mobile layout checks (FRONTEND-KIT.md), `.strict()` body shapes match BE-6.
- **Hand test:** the pilot business buys two apps, sees the invoice, changes an edition, cancels and undoes.
- **Go back:** the page is only shown for `apps` mode.
- **Needs:** FRONTEND-KIT.md, `BusinessBilling.jsx`, `LiveBilling.jsx`, `Addons.jsx`, `Shell.jsx`, BE-6 contract.

### P3-FE-2 — Prompt kit, errors, `useEntitlements` (Frontend) · size M · after BE-3
- **Goal:** MB §6.3 and §14.2: `LimitBanner`, `UpgradePanel`, `EditionBadge`, `AiLocked`, `ReadOnlyBanner`; `useEntitlements()` from `/entitlements`; one error mapper for `limit_reached`, `subscription_read_only` and the old codes; `plans.js` helpers replaced for `apps` mode.
- **Files:** `packages/ui/src/billing/*`, `packages/sdk/src/hooks.js`, `shared/src/core/plans.js` (kept for `plans` mode), `shared/src/layout/Shell.jsx` (menu by `hasApp` and access mode), tests.
- **Tests:** each component with each error body; no modal over unsaved work; dismiss rules.
- **Hand test:** hit a limit in Expenses, Hotel and Team invites; the same panel appears with the right numbers.
- **Go back:** the kit is only mounted for `apps` and `shadow` (banner off in `shadow`).
- **Needs:** `packages/ui`, `packages/sdk`, `shared/src/core/plans.js`, `Shell.jsx`, BE-3 contract.
- **Parallel:** with FE-1, FE-3, FE-4.

### P3-FE-3 — Admin: Pricing, Editions, Coupons, Subscriptions (Frontend) · size L · after BE-7
- **Goal:** MB §14.3: the Pricing editor (price, limits with hard/soft, features, trial, visibility, impact count, reason, approval status), Coupons, one business's Subscriptions with gift and extend.
- **Files:** `admin/frontend/src/pages/{Pricing,Coupons,BusinessSubscriptions}.jsx`, `App.jsx`, i18n, replacing `LivePlans`-style pages (read-only "Legacy plans").
- **Tests:** the form only sends what BE-7 accepts; paisa fields typed as rupees with 2 decimals and converted with `Money` strings; a price rise shows "needs approval".
- **Hand test:** edit a free limit and a price; try a rise with customers; approve as a second staff.
- **Go back:** hide the menu items.
- **Needs:** `AdminOps.jsx`, `LiveBilling.jsx`, `LiveAddons.jsx`, FRONTEND-KIT.md `FormBuilder`, BE-7 contract.

### P3-FE-4 — Admin: Sales, Revenue, Billing, Legal and required info (Frontend) · size M · after BE-7
- **Goal:** MB §13 and §14.3: Sales list, Revenue report (today, 7 days, 30 days, custom) with comparison and CSV, Billing (invoices, credit notes, VAT summary, refunds waiting, not sent to IRD, shadow diffs), Legal and required-info editor.
- **Files:** `admin/frontend/src/pages/{Sales,Revenue,BillingV3,LegalInfo}.jsx`, `live.js`, i18n.
- **Tests:** Nepal-time range pickers; totals equal the rows; export button audited.
- **Hand test:** sales made in the pilot show up within a minute; custom range works.
- **Go back:** hide the menu items.
- **Needs:** `LiveEarnings.jsx`, `LiveBilling.jsx`, BE-7 contract.

### P3-FE-5 — Website (Next.js): Apps and Pricing pages (Frontend) · size M · after BE-11
- **Goal:** MB §14.4: `/apps`, `/apps/<id>`, `/pricing` from the public catalog; SEO tags; "Start free"; no "verified", no PAN, no internal company names anywhere.
- **Files:** the Next.js website's pages and components (paths from the website migration; the Lead provides them), replacing `Plans.jsx` and `PlanCards.jsx`.
- **Tests:** a build-time scan of rendered HTML for forbidden words; prices equal the API.
- **Hand test:** open the pages signed out; click "Start free".
- **Go back:** keep the old plans page until QA signs off.

### P3-FE-6 — AI screens (Frontend) · size M · after BE-8
- **Goal:** Sheetal AI plan page, credits meter, top-up, connect own key (Integration Center business screens with the four providers), preferred provider, "fall back to Sheetal AI" switch, locked-preview panels wired to every app's AI buttons.
- **Files:** `business/frontend/src/pages/{AiPlan,AiAccounts}.jsx`, `packages/ui/src/billing/AiLocked.jsx`, i18n.
- **Tests:** key fields are write-only (never shown again); the meter equals the API.
- **Hand test:** locked → connect key → works → disconnect → Sheetal credits.
- **Go back:** hide the page; previews are inert.
- **Needs:** `LiveAiAccounts.jsx`, `AI.jsx`, INTEGRATIONS.md screens, BE-8 contract.

### P3-OPS-1 — Dry run on a copy of the real data, CI additions (DevOps) · size M · after BE-10
- **Goal:** restore a backup into a scratch database (`scripts/restore.mjs`), run the dry run, produce the price report, run the proofs; add CI checks: `check-money-columns` (every `…Paisa` is `BigInt`), `check-catalog` (seed equals manifests), the new test folders; `RUN-P3-STEP-n.cmd` files like the Phase 1 ones.
- **Files:** `scripts/ops/p3-step*.ps1`, `scripts/ops/RUN-P3-STEP-*.cmd`, `.github/workflows/check.yml`, `scripts/check-money-columns.mjs`.
- **Tests:** CI is green; the dry run prints PASS on the copy.
- **Hand test:** the owner reads the price report (MB §8.5) and adjusts the catalog in a file (`--catalog`) before launch.
- **Go back:** scripts only; nothing touches live data.

### P3-OPS-2 — Cutover and runbook (DevOps) · size M · last
- **Goal:** MB §8.6: backup; apply the migration to the live data (`plans` mode, nothing visible); switch to `shadow`; read diffs for 7 days; pilot (Sheetal's own business, then 5); all; **launch gates** (PHASE-3-RISKS.md §6) checked one by one; the yearly checklist (Shrawan 1 date, VAT rate, IRD rules); the go-back steps in plain words.
- **Files:** `docs/p3-cutover-runbook.md`, `scripts/ops/p3-cutover-*.ps1`, `RUN-P3-CUTOVER-*.cmd`.
- **Hand test:** the runbook is rehearsed on the scratch copy first.
- **Go back:** MB §8.6, written as numbered steps.

### P3-QA-2 — Stage sign-offs (QA) · size S each, three times
Shadow sign-off (zero diffs, proofs PASS, price report reviewed) → pilot sign-off (real payments, invoice numbers consecutive, revenue entries match, refund rehearsal) → all sign-off (7 days clean). Each writes `QA-P3-<stage>.md`; the Lead merges only after it.

## 3. What each task delivers to the next (contracts)

| From | To | Contract |
|---|---|---|
| DB-1, DB-2 | all BE | the schema file and migration names |
| BE-1 | BE-3, BE-6, BE-7, FE-3, FE-5 | `Catalog` type and `GET /public/catalog` JSON |
| BE-2 | BE-3, BE-4, BE-5, BE-6 | `quote()`, `effectiveStatus()`, `accessMode()` signatures |
| BE-3 | FE-2, FE-1, BE-6 | `GET /entitlements` JSON, error bodies (MB §6.3) |
| BE-6 | FE-1 | route list, bodies, `.strict()` shapes |
| BE-7 | FE-3, FE-4 | route list and bodies |
| BE-8 | FE-6 | `GET /ai/overview` JSON (plan, credits, connections, state per app) |
| BE-10 | OPS-1 | the script and its fixtures |

## 4. Order of work for the owner (plain words)

1. Answer Q1 to Q5 (or accept the recommendations) while P3-QA-1 and P3-DB-1 run.
2. Wait for the Backend tasks; send each `OUT-*.zip` to QA, then to the Lead.
3. After BE-10, run the dry run on your own data and read the **price report**. Change prices in the catalog file until you like it.
4. Hand-test on the pilot business, then the launch gates, then everyone.
