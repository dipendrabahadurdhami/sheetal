# CHANGES P3-BE-10: the migration script from plans to apps

Phase 3, stage 11. MB section 8 (rules R1 to R11, proofs P1 to P8, the price report). **Nothing changes for any customer:** `--apply` writes the
new rows but leaves every business on `billingMode = plans` (step 1 of MB 8.6), so nothing reads them until staff move a business to `shadow`
and then `apps` (OPS-1). The owner says yes before `--apply` on real data, with a backup first.

## What changed
| File | What |
|---|---|
| `platform/src/billing/migrate-plan.ts` (new, pure) | one business on paper: R1-R9 rows (subscriptions, grants, add-on records, price lock, AI credit grant) and proofs P1, P2, P3, P4, P7, P8. P1 uses the same comparison as shadow mode (`compareEntitlements`, v1 `buildEntitlements`, v3 `buildEntitlementsV3` from the planned rows) at now, just before the paid/trial period ends, just before an old grace ends, and (free and covered) just before the lock ends; plus AI credits. P3 prices the first renewal with the real `quote()` and the lock |
| `backend-core/src/domain/billing-migration.ts` (new) | loads a business (plan, `effectiveLimits`, add-ons with today's prices, usage counts, open plan invoices, payments in flight, AI credits); `dryRun`, `apply` (one transaction per business, P5 row counts and plan columns, P6 paid invoices, all inside it), `restore`, `priceReportCsv` |
| `backend-core/scripts/migrate-plans-to-apps.ts` (new) + `npm run billing:migrate` | the command line: dry run (default), `--apply`, `--restore [--run=ID] [--force]`, `--business=ID[,ID]`, `--verbose`, `--csv=path`, `--catalog=path`; PASS/FAIL exit code; names masked |
| `platform/src/billing/ai-credits.ts` | `migratedAllowance()`: a month's credits from an `ai_credits_monthly` grant (ref `migrated-ai:<grant>:<month>`, safe twice) |
| `platform/src/billing/lifecycle.ts` | step 5: moved businesses on `apps` get their old plan's monthly AI credits until the lock ends |
| `platform/src/billing/entitlements.ts` | **fix**: a whole-app grant now also lifts an app that is on its free edition (before, a gift of the paid edition to a free-edition app did nothing). Only raises |
| `docs/p3-migration-howto.md` (new) | the owner's steps |

## Decisions (inside the design; say if you want them changed)
- **The script is TypeScript run with `tsx`** (MB 8.4 named a `.mjs`): that is the only way to call the very `buildEntitlementsV3` and `quote()`
  the servers use, which 8.4 also requires. The other backend-core scripts already run this way.
- **Limits come from the plan with its add-ons** (what v1 enforces today) as grants until the lock ends, so nothing drops when an add-on's
  period ends. Add-ons are kept as `AddonSubscription` records with the old price (`appId = "legacy"`), so they are never counted twice.
- **The price lock's monthly figure = the old renewal ÷ months** (rounded down to the paisa), so a 3, 6 or 12-month business keeps its old
  multi-month discount (P3 holds for every period).
- **R10:** open plan/add-on invoices are listed by the dry run, **not voided**, because the business stays on `plans` and may still pay them.
  The switch to `apps` (OPS-1) voids them. A business with a plan payment in flight is skipped until it settles.
- **R5:** the monthly AI credits become an `ai_credits_monthly` grant; the lifecycle job adds each month's credits only once the business is on
  `apps` (under `plans` the old credits still apply, so nothing is given twice).
- **R9 covered:** free-edition rows (`source = covered`) plus whole-app grants until the paying business's lock ends; no price lock (it pays nothing).
- **Trial:** trialing until `renewsAt`, no lock; the old plan's limits stay as grants until the later of the trial end and 90 days.
- **Past due:** the period end and `graceUntil` are copied; an old grace longer than the new one is covered by whole-app grants until it ends.
- Usage is counted for 12 limits (rooms, listings, leads, units, leases, collections, recurring expenses; per month: POS bills, customer
  invoices, expenses, reviews, agreements, counted over the last 31 days). A count above the new limit gets "unlimited" until the lock ends.
  `projects`, `outlets`, `open_investments`, `staff_records`, `pipelines` and storage are not counted (no single table); P1 still covers them.

## Tests (`backend-core/test/migrate-plans.test.ts` + `migrate-plans.fixtures.ts`, 52)
- Every QA-1 fixture (19) and 6 more (3 and 12 months, add-ons, already over the free limits, covered, a long old grace): P1-P4, P7, P8 pass, nothing less.
- 8 skips, each listed with its reason: suspended, cancelled, demo, payment in flight, unknown plan / type / add-on, paid without a renewal date.
- The rules R2-R9 one by one; a deliberately broken mapping (an app left out) makes P1 FAIL; a 10× dearer catalog still passes P3 because of the lock.
- Database: the dry run writes nothing; apply writes every row stamped with the run, an event per subscription and an audit row, leaves plan,
  dates, status and `billingMode` exactly as they were, leaves the open invoice open and skips the payment in flight; a second apply writes nothing;
  the lifecycle job adds the AI credits once a month; restore refuses a business with its own new-system app, removes only its run's rows
  (another business's subscription stays), `--force` keeps the business's own row; the business can be moved again after a restore.

## Owner
Nothing changes on screen. Hand test (read only): `npm run billing:migrate -- --business=<your business id> --verbose`, read the printout,
then `npm run billing:migrate -- --csv=p3-price-report.csv` (the file lands in `backend-core/`). `--apply` only after your yes.
