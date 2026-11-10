# Phase 0, step 4 (P0-BE-2 + P0-DB-2): save the last Backend fixes and the support tables on one branch, apply the
# database change, then run EVERY check and save the full report.
# How to run: .\scripts\ops\RUN-STEP-4.cmd   (stop the API servers first: Ctrl+C in the dev:api terminal)
# Rules: files were copied in by the Lead (QA approved, Lead fixes applied). Running this again is safe.

Set-Location (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$desk = Join-Path $HOME "Desktop"
$report = Join-Path $desk "p0-report.txt"
$beBranch = "phase-0/P0-finish"
function Stop-Here($msg) { Write-Host "`nSTOP: $msg" -ForegroundColor Red; exit 1 }
function Ok($msg) { Write-Host "OK   $msg" -ForegroundColor Green }

Write-Host "`n1/4  Branch and commits" -ForegroundColor Cyan
$cur = (git branch --show-current).Trim()
if ($cur -eq "phase-0/P0-BE-1-fix-tests") {
  git checkout -q -b $beBranch
  if ($LASTEXITCODE -ne 0) { git checkout -q $beBranch }
} elseif ($cur -ne $beBranch) { Stop-Here "Expected branch phase-0/P0-BE-1-fix-tests, found $cur. Send this to the Lead." }
git add -A -- backend-core/src business/backend website/backend admin/backend
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git commit -q -m "P0-BE-2: strict OTA request body, promote bot test, mailer and test type fixes, branch removal blocked by open other-site requests" }
git add -A -- backend-core/prisma
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git commit -q -m "P0-DB-2: add support_tickets and support_messages tables" }
git add -A -- scripts/ops
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git commit -q -m "P0-OPS-1: step 4 script" }
git push -q -u origin $beBranch
if ($LASTEXITCODE -ne 0) { Stop-Here "Push failed. Check internet, then run this again." }
Ok "saved on $beBranch"

Write-Host "`n2/4  Backup and database change" -ForegroundColor Cyan
npm run backup -- --no-photos
if ($LASTEXITCODE -ne 0) { Stop-Here "Backup failed. Is the database running (npm run db:local)?" }
Push-Location backend-core
npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) { Pop-Location; Stop-Here "The migration did not apply. Send the red text above to the Lead." }
$diff = npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script 2>$null
$diff | Out-File -Encoding utf8 (Join-Path $desk "p0-db-diff.txt")
if ($diff | Where-Object { "$_" -match '^\s*(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|COMMENT)\b' }) { Pop-Location; Stop-Here "The database differs from the schema. Tell the Lead (p0-db-diff.txt is on your Desktop)." }
npx prisma generate
if ($LASTEXITCODE -ne 0) { Pop-Location; Stop-Here "Prisma could not rebuild. Close the API servers and run this again." }
Pop-Location
Ok "support tables added; database matches the schema"

Write-Host "`n3/4  Running every check (about 6-8 minutes)" -ForegroundColor Cyan
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

Write-Host "`n4/4  Summary" -ForegroundColor Cyan
"`n==================== SUMMARY ====================" | Out-File -Append -Encoding utf8 $report
$summary | Out-File -Append -Encoding utf8 $report
$summary | ForEach-Object { if ($_ -match 'PASS$') { Write-Host $_ -ForegroundColor Green } else { Write-Host $_ -ForegroundColor Red } }
Write-Host "`nDONE. Full report on your Desktop: p0-report.txt. Tell the Lead: step 4 done." -ForegroundColor Cyan
