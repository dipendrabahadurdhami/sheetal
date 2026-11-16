# Moving businesses from plans to apps: how to run it

The script moves businesses from Starter / Business / Pro to app subscriptions (MARKETPLACE-AND-BILLING.md section 8). It **proves** before it
writes that nobody loses an app, limit, feature, seat or AI credit, and that nobody pays more at their first renewal. Run everything from the
repo root in the VS Code terminal (PowerShell). Files you name with `--csv` land in the `backend-core` folder.

## 0. Try it on a copy first (your real data is only read)
```
.\scripts\ops\RUN-P3-STEP-1.cmd
```
It takes a backup, builds a scratch copy of the database from it, checks the saved prices, runs the dry run on the copy and saves the price
report to `Desktop\p3-price-report.csv`. By hand, any command can be run on the copy by putting `npm run scratch -- run` in front of it:
```
npm run scratch -- make
npm run scratch -- run npm run billing:migrate -- --verbose
npm run scratch -- drop
```

## 1. Look first (writes nothing)
```
npm run billing:migrate
npm run billing:migrate -- --business=<id> --verbose
npm run billing:migrate -- --csv=p3-price-report.csv
```
Each business gets one line: `PASS`, `FAIL` (with the proof that failed) or `SKIP` (with why: suspended, demo, a payment still in flight, ...).
`--verbose` shows every app, grant, add-on and the price lock. The CSV has, per paying business: the old price, the first renewal with price
protection, the price after the lock with every app, and with only the apps it used in the last 90 days.

## 2. Write (only after the owner's yes, and a backup)
```
npm run backup
npm run billing:migrate -- --apply --business=<one id>
npm run billing:migrate -- --apply
```
One transaction per business: all of its rows or none. A business with any FAIL is not written. Nobody sees a change yet: every business
stays on billing mode "plans" until staff move it to "shadow" and then "apps".

## 3. Undo
```
npm run billing:migrate -- --restore
```
Removes the rows of the last apply run and puts the businesses back on "plans". A business that already bought or installed something on the
new system is refused (`--force` removes the migration rows anyway; its own purchases stay). `--run=<id>` restores an older run.

## 4. Move businesses forward (after step 2; stop the API servers first)
```
npm run billing:mode
npm run billing:mode -- --to=shadow --all --apply
npm run billing:mode -- --to=apps --business=<pilot ids> --min-days=0 --apply
npm run billing:mode -- --to=apps --all --apply
npm run billing:mode -- --to=plans --business=<id> --apply
```
The first line is the list: every business, its mode (plans, shadow, apps) and what stands in its way. Without `--apply` a move only says
what would happen. Moving to "apps" needs 7 days on "shadow" with no difference where the new system gives less than the plan (the pilot
uses `--min-days=0`), and it cancels that business's open plan invoices (the renewal job makes new ones). A business that bought something
on the new system can't go back to "plans".

Both scripts end with `PASS` or `FAIL` (exit code 0 or 1). Business names are shown as two letters plus the id.
