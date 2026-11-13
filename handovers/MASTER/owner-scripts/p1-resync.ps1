# One-time, after P1-BE-3 is merged and RUN-UPDATE.cmd has run: brings the branch links in line with any branch access that old code
# edited since P1-DB-2, then proves it. QA asked for: a backup first, the dry run, the real run, then the check ending in PASS.
# How to run: .\scripts\ops\RUN-P1-RESYNC.cmd   (stop the API servers first: Ctrl+C in the dev:api terminal)
Set-Location (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$desk = Join-Path $HOME "Desktop"
$report = Join-Path $desk "p1-resync-report.txt"
function Stop-Here($msg) { Write-Host "`nSTOP: $msg" -ForegroundColor Red; "`nSTOPPED: $msg" | Out-File -Append -Encoding utf8 $report; exit 1 }
# Never let a database address (it can carry the password) reach the screen or the report, even inside an error message.
function Hide($lines) { $lines | ForEach-Object { "$_" -replace 'postgres(ql)?://\S+', '[database address hidden]' } }
function Ok($msg) { Write-Host "OK   $msg" -ForegroundColor Green; "OK   $msg" | Out-File -Append -Encoding utf8 $report }
"Branch links resync $(Get-Date -Format 'yyyy-MM-dd HH:mm')" | Out-File -Encoding utf8 $report

# The resync rebuilds the links from the old names: nothing else may write team or branch data while it runs (QA).
$answer = Read-Host "Have you stopped the API servers (Ctrl+C in the dev:api terminal)? Type YES"
if ($answer -ne "YES") { Stop-Here "Stop the API servers first, then run this again and type YES." }
"API servers stopped: confirmed by the owner" | Out-File -Append -Encoding utf8 $report
if (-not (Test-Path "backend-core/scripts/resync-branch-links.mjs")) { Stop-Here "The resync script is not here yet. Run RUN-UPDATE.cmd first (after the Lead merged P1-BE-3)." }
Write-Host "`n1/4  Backup" -ForegroundColor Cyan
$backupOut = npm run backup -- --no-photos 2>&1
$backupCode = $LASTEXITCODE
$backupOut = Hide $backupOut
$backupOut | ForEach-Object { Write-Host "  $_" }
"`n=== 1/4  Backup" | Out-File -Append -Encoding utf8 $report
$backupOut | Out-File -Append -Encoding utf8 $report
if ($backupCode -ne 0) { Stop-Here "Backup failed. Is the database running (npm run db:local)?" }
$savedIn = ($backupOut | Select-String -Pattern "saved in (.+)$" | Select-Object -First 1)
$where = if ($savedIn) { $savedIn.Matches[0].Groups[1].Value.Trim() } else { "(see the backup lines above)" }
Ok "backup done: to undo, restore $where"

foreach ($step in @(@("2/4  Dry run (changes nothing)", "--dry-run"), @("3/4  Real run", ""))) {
  Write-Host "`n$($step[0])" -ForegroundColor Cyan
  "`n=== $($step[0])" | Out-File -Append -Encoding utf8 $report
  if ($step[1]) { $out = node backend-core/scripts/resync-branch-links.mjs $step[1] 2>&1 } else { $out = node backend-core/scripts/resync-branch-links.mjs 2>&1 }
  $code = $LASTEXITCODE
  $out = Hide $out
  $out | Out-File -Append -Encoding utf8 $report
  $out | Select-Object -Last 4 | ForEach-Object { Write-Host "  $_" }
  if ($code -ne 0) { Stop-Here "The resync script stopped. Send Desktop\p1-resync-report.txt to the Lead." }
}
Ok "resync done"

Write-Host "`n4/4  Check" -ForegroundColor Cyan
"`n=== 4/4  check-branch-links" | Out-File -Append -Encoding utf8 $report
$out = node backend-core/scripts/check-branch-links.mjs 2>&1
$code = $LASTEXITCODE
$out = Hide $out
$out | Out-File -Append -Encoding utf8 $report
$last = "$($out | Select-Object -Last 1)"
if ($code -ne 0 -or $last -notmatch '^PASS') { Stop-Here "The check did not end with PASS. Send Desktop\p1-resync-report.txt to the Lead." }
Ok $last
Write-Host "`nDONE. Send Desktop\p1-resync-report.txt to QA, and tell the Lead: resync done." -ForegroundColor Cyan
