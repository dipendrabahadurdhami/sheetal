# CHANGES P3-OPS-1: the dry run on a copy of the real data, the mode switch, two new checks

Phase 3, stage 19. PHASE-3-TASKS.md task P3-OPS-1, MB sections 8.4 to 8.6, launch gates G4 (first half) and G8. **Nothing changes for any
customer:** every business is still on `billingMode = plans` and `salesEnabled` is false. The real database was only read (by the backup).

## What is new
| File | What |
|---|---|
| `scripts/scratch-db.mjs` + `npm run scratch` | a scratch copy of the database (`sheetal_scratch`, same local server): `-- make` (from the newest backup, tables by the migrations, rows by `restore.mjs`, row counts checked), `-- run <command>` (runs it with `DATABASE_URL` = the copy), `-- drop`. Refuses if `DATABASE_URL` already names the copy; refuses a backup older than the code's migrations; never prints a database address |
| `backend-core/src/domain/billing-mode.ts` + `backend-core/scripts/billing-mode.ts` + `npm run billing:mode` | **the cutover switch, which did not exist**: nothing in the code could move a business to `shadow` or `apps`. The list (mode, app rows, days on shadow, recorded differences, a comparison made now, open plan invoices, payments in flight); `--to=shadow|apps|plans --business=ID[,ID] | --all`, dry by default, `--apply` writes, `--min-days=N` (the pilot), `--force` |
| `scripts/check-money-columns.mjs` + `npm run check:money` | every `…Paisa` field of the schema is `BigInt` and its column ends in `_paisa` (42 today) |
| `backend-core/scripts/check-catalog.ts` + `npm run check:catalog` | the seed catalog passes the schema and the guard, and the seed file agrees with the manifests (prices name real paid editions, no "extra" app hides a manifest, soft limits and add-ons name real limits). `-- --db` checks the catalog **saved** in the database the same way |
| `scripts/ops/RUN-P3-STEP-1.cmd`, `p3-step1.ps1`, `p3-lib.ps1` | the owner's step: backup, scratch copy, catalog check, dry run (must end PASS), price report on the Desktop, mode list. Report: `Desktop\p3-step1-report.txt` |
| `package.json` | `check` now also runs `check:money` and `check:catalog` (so CI does too, with no change to `check.yml`); `scripts/help.mjs` describes the 4 new commands |

## The rules of the switch (MB 8.6, R10)
- `shadow` and `apps` need the migration's rows (a business the migration skipped stays on `plans`).
- `apps` needs: on `shadow` first, 7 days there (`--min-days=0` for the pilot), and zero "less" differences: those the servers recorded
  since the move to shadow, **and** the same comparison made at that moment from the stored rows (`compareNow`). The second one matters
  here: a business nobody opens during the 7 days records nothing, so the recorded count alone would prove nothing for it.
- Moving to `apps` **voids the business's open plan and add-on invoices** (R10) in the same transaction as the mode and the audit row
  (`billing.mode_changed`, target `shadow -> apps`, the voided ids in `meta`). Boost, banner and paid invoices are never touched.
- A plan payment in flight refuses `apps`. `--force` skips the three shadow rules only, never this one.
- `apps -> plans` is refused once the business paid a subscription invoice or installed an app itself (MB 8.6: switch sales off and fix
  forward). Never forced. `apps -> shadow` is refused (go back to `plans` first).
- Run it with the API servers stopped (the owner scripts check ports 4000 to 4002).

## A bug the dry run on the real data found (fixed, with a test)
`platform/src/billing/migrate-plan.ts`, proof P1: a **free (Starter) business with a leftover renewal date** was checked "just before its
period ends" (a year away), long after its 90 days of old limits. That was a false FAIL: under plans that date decides nothing for a free
plan. P1 now checks the period end only for a paid plan or a trial; a free business is checked today and just before its 90 days end
(owner's answer Q2). One real business (a test account, hotel Starter) failed before and passes now. No old assertion changed.

Also: the price report CSV now starts with a byte-order mark, so Excel reads the "…" in the masked names.

## Result on the copy of the real data (16 Nov, backup `2026-11-16_1029`)
- 113 tables, 22,823 rows restored; every row count equals the backup.
- Saved catalog: version 1, 18 apps, passes the guard.
- Dry run: **15 planned, 15 passed every proof, 2 skipped, 0 failed: PASS.** The 2 skipped have a plan payment in flight (R10); they stay
  on plans until it is paid or fails, then the script is run again.
- Rehearsal on the copy (not on the real data): apply 15 written; all to shadow; apps refused before 7 days; apps with `--min-days=0`;
  back to plans; `--restore` 15 restored; dry run PASS again. The comparison made now: 0 "less" for all 15.
- **Price report (for gate G2, the owner's decision):** the first renewal equals today's price for every paying business (price
  protection). After the 12-month lock, keeping **every** app would cost 114% to 178% more than today (Business: Rs 915 a month today,
  Rs 23,500 to 30,500 a year after; Pro: Rs 1,830 a month today, Rs 52,500 a year after). Keeping only the apps used in the last 90 days is
  far cheaper. The owner may want lower app prices, or to rely on "Choose the apps you keep" (MB 8.3), before real sales.

## Tests
- `backend-core/test/billing-mode.test.ts` (13; 5 pure, 8 on the database): every rule above one by one; a dry run writes nothing; "all" is
  only the businesses with app rows; one audit row per move; R10 (only that business's open plan and add-on invoices, never boost, paid or
  another business's); in flight refuses even forced; go back before and after a sale.
- `backend-core/test/migrate-plans.test.ts` +1 (53): the leftover renewal date.
- `scripts/check-money-columns.test.js` (5), `scripts/scratch-db.test.js` (4), root run.

## Also
`scripts/ops/p1-step1.ps1` and `p1-step3.ps1` (finished Phase 1 scripts) still added tool credit lines to their commits; removed (owner's rule).

## Not in this stage
- The cutover itself on the real data (OPS-2): backup, `--apply`, shadow, pilot, all. The owner's yes at each step.
- The 2 businesses with a payment in flight: settle (approve or fail the payment in Admin), then run the dry run again.

## Owner
1. `.\scripts\ops\RUN-P3-STEP-1.cmd` (safe, any time): expect five green OK lines and "DONE".
2. Open `Desktop\p3-price-report.csv` in Excel and read the last two price columns.
