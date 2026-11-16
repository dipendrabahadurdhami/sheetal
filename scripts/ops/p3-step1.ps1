# Phase 3, step 1 (P3-OPS-1): the dry run of "plans -> apps" on a COPY of your data. Your real data is only read (by the backup).
# What it does: 1 backup, 2 a scratch copy of the database from that backup, 3 checks the saved prices (catalog) on the copy,
#               4 the migration dry run on the copy (must end PASS) and the price report, 5 the list of billing modes on the copy.
# What you get: Desktop\p3-step1-report.txt (everything that was printed) and Desktop\p3-price-report.csv (open it in Excel:
#               one row per paying business: today's price, the first renewal, the price after the 12-month lock).
# How to run: .\scripts\ops\RUN-P3-STEP-1.cmd   (the servers may stay open; nothing is changed)
# Running it again is safe: the copy is made new each time.
. (Join-Path $PSScriptRoot "p3-lib.ps1")
Start-Report "p3-step1-report.txt" "Phase 3 step 1: dry run on a copy"
$csv = Join-Path $desk "p3-price-report.csv"
Need-Database

$r = Run-Step "1/5  Backup (reads your data, changes nothing)" "npm run -s backup -- --no-photos" 4
if ($r.code -ne 0) { Stop-Here "Backup failed." }
Ok "backup done"

$r = Run-Step "2/5  Scratch copy of the database (from that backup)" "npm run -s scratch -- make" 3
if ($r.code -ne 0) { Stop-Here "The scratch copy could not be made. Send Desktop\p3-step1-report.txt." }
Ok "scratch copy ready; every row count matches the backup"

$r = Run-Step "3/5  Saved prices and limits (catalog) on the copy" "npm run -s scratch -- run npm run -s check:catalog -- --db" 3
if ($r.code -ne 0) { Stop-Here "The saved catalog has a problem (see above). Fix it in Admin, Pricing, then run this again." }
Ok "the catalog is safe to sell from"

$r = Run-Step "4/5  Migration dry run on the copy (writes nothing)" "npm run -s scratch -- run npm run -s billing:migrate -- `"--csv=$csv`"" 6
if (-not (Ends-With-Pass $r)) { Stop-Here "The dry run did not end with PASS. Nothing was changed. Send Desktop\p3-step1-report.txt." }
$skips = @($r.out | Where-Object { "$_" -match '^SKIP' })
Ok "dry run PASS: nobody loses an app, a limit, a seat or AI credits, and nobody pays more at the first renewal"
if ($skips.Count) {
  Write-Host "  $($skips.Count) business(es) were skipped (listed in the report with the reason; they stay on today's plans):" -ForegroundColor Yellow
  $skips | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
}
if (Test-Path $csv) { Ok "price report saved: $csv" }

$r = Run-Step "5/5  Billing modes on the copy" "npm run -s scratch -- run npm run -s billing:mode" 2
if (-not (Ends-With-Pass $r)) { Stop-Here "The mode list did not end with PASS. Send Desktop\p3-step1-report.txt." }
Ok "every business is on plans"

Write-Host "`nDONE. Your real data was not changed. Open Desktop\p3-price-report.csv and look at the prices." -ForegroundColor Cyan
