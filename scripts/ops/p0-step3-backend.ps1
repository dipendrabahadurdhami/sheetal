# Phase 0, step 3 (P0-BE-1): save the Backend fixes on their own branch, then run EVERY check separately and save
# one full report (lint, typecheck and tests for each part), so nothing is hidden behind the first failure.
# How to run: .\scripts\ops\RUN-STEP-3.cmd   (stop the API servers first: Ctrl+C in the dev:api terminal)
# Rules: the fixes were copied into the folder by the Lead. Running this again is safe.

Set-Location (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$desk = Join-Path $HOME "Desktop"
$report = Join-Path $desk "p0-report.txt"
$beBranch = "phase-0/P0-BE-1-fix-tests"
function Stop-Here($msg) { Write-Host "`nSTOP: $msg" -ForegroundColor Red; exit 1 }
function Ok($msg) { Write-Host "OK   $msg" -ForegroundColor Green }

Write-Host "`n1/3  Branch for the Backend fixes" -ForegroundColor Cyan
$cur = (git branch --show-current).Trim()
if ($cur -eq "phase-0/P0-DB-1-database-repair") {
  git add -A -- scripts/ops
  git diff --cached --quiet
  if ($LASTEXITCODE -ne 0) { git commit -q -m "P0-OPS-1: step scripts" }
  git push -q
  git checkout -q -b $beBranch
  if ($LASTEXITCODE -ne 0) { git checkout -q $beBranch }
} elseif ($cur -ne $beBranch) { Stop-Here "Expected branch phase-0/P0-DB-1-database-repair, found $cur. Send this to the Lead." }
git add -A -- backend-core/src business/backend website/backend admin/backend scripts/ops
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git commit -q -m "P0-BE-1: restore Update E code (own AI keys, people, devkeys routes); fix forms money check, agreements check order, promote test"
  if ($LASTEXITCODE -ne 0) { Stop-Here "Commit failed. Send this to the Lead." }
}
git push -q -u origin $beBranch
Ok "fixes saved on $beBranch"

Write-Host "`n2/3  Running every check (about 6-8 minutes)" -ForegroundColor Cyan
"Sheetal Phase 0 report - $(Get-Date -Format 'yyyy-MM-dd HH:mm')  branch $beBranch" | Out-File -Encoding utf8 $report
$summary = @()
function Run-Part($name, [scriptblock]$cmd) {
  Write-Host "  ... $name"
  "`n==================== $name ====================" | Out-File -Append -Encoding utf8 $report
  & $cmd 2>&1 | Out-File -Append -Encoding utf8 $report
  $result = if ($LASTEXITCODE -eq 0) { "PASS" } else { "FAIL" }
  "-> $name : $result" | Out-File -Append -Encoding utf8 $report
  $script:summary += "{0,-34} {1}" -f $name, $result
}
Run-Part "lint" { npm run lint }
Run-Part "typecheck root" { npx tsc -p tsconfig.json }
foreach ($w in @("@sheetal/backend-core", "@sheetal/website-api", "@sheetal/business-api", "@sheetal/admin-api", "@sheetal/mail-server")) {
  Run-Part "typecheck $w" { npm run typecheck -w $w }
}
Run-Part "tests shared (root vitest)" { npx vitest run }
foreach ($w in @("@sheetal/backend-core", "@sheetal/website-api", "@sheetal/business-api", "@sheetal/admin-api", "@sheetal/mail-server")) {
  Run-Part "tests $w" { npm run test -w $w }
}

Write-Host "`n3/3  Summary" -ForegroundColor Cyan
"`n==================== SUMMARY ====================" | Out-File -Append -Encoding utf8 $report
$summary | Out-File -Append -Encoding utf8 $report
$summary | ForEach-Object { if ($_ -match 'PASS$') { Write-Host $_ -ForegroundColor Green } else { Write-Host $_ -ForegroundColor Red } }
Write-Host "`nDONE. Full report on your Desktop: p0-report.txt. Tell the Lead: step 3 done." -ForegroundColor Cyan
