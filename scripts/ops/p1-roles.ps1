# One time, after the update that ends Phase 1 (stage 1.5 part 2): moves the permissions stored on every role from the old names to the new ones.
# Why it must run: after this update the servers only understand the new names. Until this has run, people other than owners have no access.
# What it does: 1 backup, 2 preview (writes nothing), 3 the rewrite (only after you type YES), 4 check that nothing is left to rewrite,
#               5 copy today's connection settings into the Setup center, 6 refresh the test accounts.
# To undo the rewrite: node backend-core/scripts/rewrite-role-perms.mjs --restore   (the old lists are kept in the column roles.perms_v1),
#                      or restore the backup from step 1.
# How to run: .\scripts\ops\RUN-P1-ROLES.cmd   (stop the API servers first: Ctrl+C in the dev:api window)
Set-Location (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$desk = Join-Path $HOME "Desktop"
$report = Join-Path $desk "p1-roles-report.txt"
function Stop-Here($msg) { Write-Host "`nSTOP: $msg" -ForegroundColor Red; "`nSTOPPED: $msg" | Out-File -Append -Encoding utf8 $report; exit 1 }
# Never let a database address (it can carry the password) reach the screen or the report, even inside an error message.
function Hide($lines) { $lines | ForEach-Object { "$_" -replace 'postgres(ql)?://\S+', '[database address hidden]' } }
function Ok($msg) { Write-Host "OK   $msg" -ForegroundColor Green; "OK   $msg" | Out-File -Append -Encoding utf8 $report }
function Run-Step($title, $command, $tail) {
  Write-Host "`n$title" -ForegroundColor Cyan
  "`n=== $title" | Out-File -Append -Encoding utf8 $report
  $out = cmd /c "$command 2>&1"
  $code = $LASTEXITCODE
  $out = Hide $out
  $out | Out-File -Append -Encoding utf8 $report
  $out | Select-Object -Last $tail | ForEach-Object { Write-Host "  $_" }
  return @{ code = $code; out = $out }
}
"Role rewrite (old permission names -> new) $(Get-Date -Format 'yyyy-MM-dd HH:mm')" | Out-File -Encoding utf8 $report

$answer = Read-Host "Have you stopped the API servers (Ctrl+C in the dev:api window)? Type YES"
if ($answer -ne "YES") { Stop-Here "Stop the API servers first, then run this again and type YES." }
if (-not (Test-Path "backend-core/scripts/rewrite-role-perms.mjs")) { Stop-Here "The rewrite script is not here. Run RUN-UPDATE.cmd first." }

$r = Run-Step "1/6  Backup" "npm run backup -- --no-photos" 4
if ($r.code -ne 0) { Stop-Here "Backup failed. Is the database running (npm run db:local)?" }
$savedIn = ($r.out | Select-String -Pattern "saved in (.+)$" | Select-Object -First 1)
$where = if ($savedIn) { $savedIn.Matches[0].Groups[1].Value.Trim() } else { "(see the backup lines above)" }
Ok "backup done: to undo everything, restore $where"

$r = Run-Step "2/6  Preview (writes nothing)" "node backend-core/scripts/rewrite-role-perms.mjs --dry-run" 4
$last = "$($r.out | Select-Object -Last 1)"
if ($r.code -ne 0 -or $last -notmatch '^PASS') { Stop-Here "The preview did not end with PASS, so nothing was changed. Send Desktop\p1-roles-report.txt to the Lead." }
Ok "preview passed: nobody would lose access"

$answer = Read-Host "`nThe preview passed. Type YES to rewrite the roles now"
if ($answer -ne "YES") { Stop-Here "Nothing was changed. Run this again when you are ready." }
$r = Run-Step "3/6  Rewriting the roles" "node backend-core/scripts/rewrite-role-perms.mjs --apply" 4
$last = "$($r.out | Select-Object -Last 1)"
if ($r.code -ne 0 -or $last -notmatch '^PASS') { Stop-Here "The rewrite stopped and wrote nothing (it is all-or-nothing). Send Desktop\p1-roles-report.txt to the Lead." }
Ok "roles rewritten (the old lists are kept in roles.perms_v1)"

$r = Run-Step "4/6  Check: nothing left to rewrite" "node backend-core/scripts/rewrite-role-perms.mjs --dry-run" 3
$summary = "$($r.out | Select-String -Pattern '^Summary:' | Select-Object -Last 1)"
if ($r.code -ne 0 -or $summary -notmatch ', 0 would change,') { Stop-Here "Some roles still hold old names. Send Desktop\p1-roles-report.txt to the Lead." }
Ok "every role holds the new names"

$r = Run-Step "5/6  Connections into the Setup center" "npm run -s integrations:migrate" 3
if ($r.code -ne 0) { Stop-Here "integrations:migrate failed. The roles are fine. Send Desktop\p1-roles-report.txt to the Lead." }
Ok "connection settings copied (nothing deleted)"

$r = Run-Step "6/6  Test accounts" "npm run -s accounts:test" 3
if ($r.code -ne 0) { Stop-Here "accounts:test failed. The roles are fine. Send Desktop\p1-roles-report.txt to the Lead." }
Ok "test accounts refreshed"

Write-Host "`nDONE. Tell the Lead: roles done. Then start the servers with RUN-START.cmd." -ForegroundColor Cyan
