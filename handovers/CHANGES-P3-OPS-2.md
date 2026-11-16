# CHANGES P3-OPS-2: the cutover scripts, the runbook, the billing rules screen

Phase 3, stage 20. PHASE-3-TASKS.md task P3-OPS-2, MB section 8.6, launch gates G4 and G8. **The cutover itself has NOT been run on the real
data:** every business is still on `billingMode = plans` and `salesEnabled` is false. This stage is everything needed to run it, rehearsed
on a copy; each real step waits for the owner's typed `YES`.

## What is new
| File | What |
|---|---|
| `docs/p3-cutover-runbook.md` | the runbook in plain words: the three modes, what to do before, the four steps, the pilot hand test, what a step refuses and why, the launch gates G1 to G10 with where each is ticked, going back (five cases), the yearly checklist |
| `scripts/ops/RUN-P3-STEP-2.cmd`, `p3-step2.ps1` | the **rehearsal on the scratch copy**: backup + copy, apply, all to shadow, apps refused before 7 days, apps the pilot way, the list, back to plans, `--restore`, dry run again. Nine OK lines; `Desktop\p3-step2-report.txt`. Real data only read |
| `scripts/ops/p3-cutover.ps1` + `RUN-P3-CUTOVER-1.cmd` … `-4.cmd`, `RUN-P3-GO-BACK.cmd`, `RUN-P3-CUTOVER-STATUS.cmd` | the real steps. Each: the API servers must be stopped (ports 4000 to 4002 checked), **backup first**, a preview that writes nothing and must end PASS, the typed `YES`, then the same command with `--apply`, which must end PASS. Step 3 and "go back" ask for business ids (letters, digits, `-`, `_`, commas only). Status changes nothing |
| `admin/frontend/src/pages/BillingRules.jsx`, `billingRulesLogic.js` (+ test), one line in `Pricing.jsx` | **Admin → Pricing → Billing rules, which did not exist**: the `platform.billing` setting had no screen, so nobody could switch sales on without a developer. The sales switch, VAT %, trial, grace and read-only days, refund window, price rise notice, minimum charge, reminder days; a reason is required; the last 5 changes. Uses the typed settings store routes that already exist (`GET/PUT /admin/settings/store/platform.billing`): **no server change** |
| `scripts/backup.mjs` | refuses to back up the scratch copy (`sheetal_scratch`): its export would sit among the real backups and could be restored by mistake (it happened once while testing the cutover script against the copy; those two exports were deleted) |

## How the steps map to MB 8.6
| Runbook step | Command behind it | Mode after |
|---|---|---|
| 1 | `npm run billing:migrate -- --apply` | `plans` (rows exist, nothing reads them) |
| 2 | `npm run billing:mode -- --to=shadow --all --apply` | `shadow` |
| 3 (pilot) | `npm run billing:mode -- --to=apps --business=<ids> --min-days=0 --apply` | `apps` for the pilot |
| 4 | `npm run billing:mode -- --to=apps --all --apply` (7 days, zero "less") | `apps` for all |
| go back | `npm run billing:mode -- --to=plans …`; after step 1 only: `npm run billing:migrate -- --restore` | `plans` |

## Decisions (inside the design; say if you want them changed)
- **One PowerShell file with a `-Step`** instead of one per step (the task named `p3-cutover-*.ps1`): the backup, preview, YES and apply
  are the same code for every step, so they can't drift apart.
- **The preview must end PASS before the YES is even asked.** One refused business stops the whole step (nothing written); the owner fixes
  the reason or names fewer businesses. No script passes `--force`.
- **The pilot uses `--min-days=0`** (MB 8.6 step 3 comes before the 7 days end for everyone else); the "less" checks still apply to it.
- **Sales stay off until the owner switches them on** in the new panel; step 3 only says so. A pilot business on `apps` with sales off can
  install free editions and start trials, and sees prices as a preview.
- The billing rules panel shows the rules an owner changes. `quoteHours`, `seatAutoPauseDays`, the migration lock months and free-limit
  days, `minFirstPeriodDays`, `requireTaxInfo` and `pricesIncludeVat` are sent back exactly as saved (the last one is fixed by Q5).

## Tests and checks
- `admin/frontend/src/pages/billingRulesLogic.test.js` (5): an untouched form sends the saved value back unchanged; the sales switch changes
  one field only; paisa without floating point; every bad field named; day lists.
- The rehearsal (`p3-step2.ps1`) run on a copy of the real data on 16 Nov: nine OK lines (see the report in the reply).
- The real steps' script (`p3-cutover.ps1`) was run **against the copy** with typed answers: step 1 with NO (nothing written) and YES,
  step 2, step 4 (refused: 0 days on shadow, nothing written), step 3 with one business id, go back with ALL, and a bad id (refused).
  On the real data only `-Step status` ran (read only): 17 businesses on plans, 0 app rows. **No step was run on the real data.**
- The panel in the browser (test super admin): it loads the saved values (VAT 13, trial 14, grace 7, read-only 60, …), "Sales are off",
  a wrong value shows its message and keeps Save disabled. Nothing was saved.

## Left in Phase 3 after this stage
1. The owner runs the cutover (runbook), with a yes at each step: steps 1 and 2, seven days of shadow, the pilot, then everyone.
2. Launch gates G2, G3, G5, G6, G7, G9, G10 are the owner's, Finance's and the accountant's (runbook table).
3. Small leftovers from the screens (CONTINUE-phase-3.md): usage per limit in `/entitlements`; the AI top-up as its own quote item;
   `AiLocked` on each app's AI button; trial credits for new free businesses.

## Owner
1. `.\scripts\ops\RUN-P3-STEP-2.cmd` (safe): expect nine green OK lines and "DONE".
2. Hand test of the new panel: Admin → Pricing, scroll to **Billing rules**. Expect "Sales are off", VAT 13, grace 7. Change nothing yet.
3. Read `docs/p3-cutover-runbook.md`. The first real step is `RUN-P3-CUTOVER-1.cmd`, only when you say yes.
