# Phase 0, step 2 (P0-DB-1): put back the People and Developer-keys tables, then run all tests for the Backend chat.
# Where it fits: after step 1 (the safety branch). The Lead already copied the repaired schema, the repair migration
# and the Architect's design docs (docs/architecture) into the folder.
# How to run: .\scripts\ops\RUN-STEP-2.cmd   (it starts the database if needed). Stop the API servers first
# (npm run dev:api) so Prisma can rebuild its client.
# Rules: stops at the first problem with a clear message. Running it again is safe.

Set-Location (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$desk = Join-Path $HOME "Desktop"
$dbBranch = "phase-0/P0-DB-1-database-repair"
function Stop-Here($msg) { Write-Host "`nSTOP: $msg" -ForegroundColor Red; exit 1 }
function Ok($msg) { Write-Host "OK   $msg" -ForegroundColor Green }

Write-Host "`n1/7  Checking where we are" -ForegroundColor Cyan
$cur = (git branch --show-current).Trim()
if ($cur -ne "wip/before-phase-0" -and $cur -ne $dbBranch) { Stop-Here "Expected branch wip/before-phase-0 (or $dbBranch), found $cur. Send this to the Lead." }
if (-not (Test-Path "backend-core/prisma/migrations/20261109090000_restore_people/migration.sql")) { Stop-Here "The repair migration is missing. Tell the Lead." }
Ok "on $cur, repair files present"

if ($cur -eq "wip/before-phase-0") {
  Write-Host "`n2/7  Saving the Architect's design docs and these step files" -ForegroundColor Cyan
  git add -A -- docs/architecture scripts/ops
  git diff --cached --quiet
  if ($LASTEXITCODE -ne 0) {
    git commit -q -m "P1-ARCH-1: add architecture design docs; P0 step 2 script"
    git push -q
    if ($LASTEXITCODE -ne 0) { Stop-Here "Push failed. Check internet, then run this again." }
  }
  Ok "design docs saved on GitHub"
  git show-ref --verify --quiet "refs/heads/$dbBranch"
  if ($LASTEXITCODE -eq 0) { git checkout -q $dbBranch } else { git checkout -q -b $dbBranch }
  if ($LASTEXITCODE -ne 0) { Stop-Here "Could not switch to $dbBranch. Send this to the Lead." }
} else { Write-Host "`n2/7  Already on $dbBranch" -ForegroundColor Cyan }
Ok "on $dbBranch"

Write-Host "`n3/7  Saving the repair on its own branch" -ForegroundColor Cyan
git add -A -- backend-core/prisma/schema.prisma backend-core/prisma/migrations/20261109090000_restore_people
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git commit -q -m "P0-DB-1: restore people and developer-keys tables"
  if ($LASTEXITCODE -ne 0) { Stop-Here "Commit failed. Send this to the Lead." }
}
Ok "repair committed"

Write-Host "`n4/7  Backup before changing the database" -ForegroundColor Cyan
npm run backup -- --no-photos
if ($LASTEXITCODE -ne 0) { Stop-Here "Backup failed. Is the database running (npm run db:local)?" }
Ok "backup done"

Write-Host "`n5/7  Repairing the database" -ForegroundColor Cyan
Push-Location backend-core
npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) { Pop-Location; Stop-Here "The migration did not apply. Send the red text above to the Lead." }
npx prisma migrate status 2>&1 | Tee-Object -FilePath (Join-Path $desk "p0-db-status.txt")
$diff = npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script 2>&1
$diff | Out-File -Encoding utf8 (Join-Path $desk "p0-db-diff.txt")
$sql = $diff | Where-Object { "$_" -match '\S' -and "$_" -notmatch '^\s*--' }
if ($sql) { Pop-Location; Stop-Here "The database still differs from the schema. Send p0-db-diff.txt (on your Desktop) to the Lead." }
Ok "database matches the schema (no differences)"
npx prisma generate
if ($LASTEXITCODE -ne 0) { Pop-Location; Stop-Here "Prisma could not rebuild. Close the API servers (Ctrl+C in the dev:api terminal) and run this again." }
Pop-Location
npm run people:roles
if ($LASTEXITCODE -ne 0) { Stop-Here "people:roles failed. Send the red text above to the Lead." }
Ok "database repaired; managers have the People permissions"

Write-Host "`n6/7  Sending the repair branch to GitHub" -ForegroundColor Cyan
git push -u origin $dbBranch
if ($LASTEXITCODE -ne 0) { Stop-Here "Push failed. Check internet, then run: git push -u origin $dbBranch" }
Ok "repair branch on GitHub"

Write-Host "`n7/7  Running all tests (about 5 minutes; some failures are expected)" -ForegroundColor Cyan
npm test 2>&1 | Out-File -Encoding utf8 (Join-Path $desk "test-output.txt")
Ok "tests finished; results saved"

git --no-pager log --oneline -5
Write-Host "`nDONE. Tell the Lead: step 2 done." -ForegroundColor Cyan
Write-Host "On your Desktop: test-output.txt. Next: Backend chat with P0-chat2-backend.zip + test-output.txt." -ForegroundColor Cyan
