# Phase 3, step 2 (P3-OPS-2): the REHEARSAL of the whole cutover and of the way back, on the scratch copy. Your real data is only read.
# What it does, all on the copy: 1 backup + a new copy, 2 the migration writes the app rows, 3 everyone to "shadow",
#               4 "apps" is refused before the 7 days (proves the rule), 5 the pilot way: "apps" at once, 6 the list shows no difference,
#               7 go back: everyone to "plans", 8 the migration rows removed, 9 the dry run passes again (the copy is as it started).
# What you get: Desktop\p3-step2-report.txt. This is launch gate G8 (a backup taken and a restore rehearsed) and the rehearsal the
#               runbook asks for (docs/p3-cutover-runbook.md).
# How to run: .\scripts\ops\RUN-P3-STEP-2.cmd   (the servers may stay open; nothing real is changed). Running it again is safe.
. (Join-Path $PSScriptRoot "p3-lib.ps1")
Start-Report "p3-step2-report.txt" "Phase 3 step 2: cutover rehearsal on a copy"
Need-Database
$copy = "npm run -s scratch -- run npm run -s"
function Must-Pass($r, $what) { if (-not (Ends-With-Pass $r)) { Stop-Here "$what did not end with PASS (on the copy; your real data is untouched). Send Desktop\p3-step2-report.txt." } }

$r = Run-Step "1/9  Backup and a new scratch copy" "npm run -s backup -- --no-photos && npm run -s scratch -- make" 3
if ($r.code -ne 0) { Stop-Here "The backup or the scratch copy failed. Send Desktop\p3-step2-report.txt." }
Ok "copy ready; every row count matches the backup"

$r = Run-Step "2/9  On the copy: the migration writes the app rows" "$copy billing:migrate -- --apply" 2
Must-Pass $r "The migration"
Ok "app rows written; every business still on plans"

$r = Run-Step "3/9  On the copy: everyone to shadow" "$copy billing:mode -- --to=shadow --all --apply" 2
Must-Pass $r "The move to shadow"
Ok "everyone with app rows is on shadow"

$r = Run-Step "4/9  On the copy: apps before the 7 days must be REFUSED" "$copy billing:mode -- --to=apps --all" 0
if ($r.code -eq 0 -or -not ($r.out | Where-Object { "$_" -match 'it needs 7' })) { Stop-Here "The 7-day rule did not refuse. Send Desktop\p3-step2-report.txt." }
Ok "refused, as it must be (7 days on shadow first)"

$r = Run-Step "5/9  On the copy: the pilot way, apps at once" "$copy billing:mode -- --to=apps --all --min-days=0 --apply" 2
Must-Pass $r "The move to apps"
Ok "everyone with app rows is on apps; open plan invoices voided"

$r = Run-Step "6/9  On the copy: the list (no business may get less than its plan gave)" "$copy billing:mode" 2
Must-Pass $r "The list"
Ok "no difference where the new system gives less"

$r = Run-Step "7/9  On the copy: go back, everyone to plans" "$copy billing:mode -- --to=plans --all --apply" 2
Must-Pass $r "The way back"
Ok "everyone is on plans again"

$r = Run-Step "8/9  On the copy: remove the migration rows" "$copy billing:migrate -- --restore" 2
Must-Pass $r "The restore"
Ok "migration rows removed"

$r = Run-Step "9/9  On the copy: the dry run again" "$copy billing:migrate" 2
Must-Pass $r "The dry run"
Ok "the copy is as it started: the dry run passes again"

Write-Host "`nDONE. The cutover and the way back both work on a copy of your data. Your real data was not changed." -ForegroundColor Cyan
