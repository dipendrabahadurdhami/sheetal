# Update: brings this computer to the latest main on GitHub after the Lead merged work there.
# Use it every time the Lead says "run the update". It never touches your local-only files (report CSVs, Claude outputs).
#   1. checks nothing unsaved, fetches main and switches to it (never visiting an old main)
#   2. puts back any local-only file that went missing (from Desktop\sheetal-local-copies)
#   3. deletes phase-1 branches whose work is already in main (here and on GitHub); branches still waiting are kept
#   4. npm install, database: backup if there are new migrations, migrate deploy, prisma generate
#   5. quick checks: generated permissions, manifests, schema tags, boundaries, and the data checks on your database
# How to run: .\scripts\ops\RUN-UPDATE.cmd   (stop the API servers first: Ctrl+C in the dev:api terminal)

Set-Location (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$desk = Join-Path $HOME "Desktop"
function Stop-Here($msg) { Write-Host "`nSTOP: $msg" -ForegroundColor Red; exit 1 }
function Ok($msg) { Write-Host "OK   $msg" -ForegroundColor Green }
function Step($msg) { Write-Host "`n$msg" -ForegroundColor Cyan }

Step "1/5  Getting the latest main from GitHub"
# npm install on Windows sometimes rewrites package-lock.json; GitHub's copy is the right one, so put it back.
git checkout -q -- package-lock.json 2>$null
$dirty = git status --porcelain | Where-Object { $_ -notmatch 'scripts/ops/' }
if ($dirty) { $dirty; Stop-Here "There are unsaved changes (listed above). Send a screenshot to the Lead." }
git fetch -q --prune origin
if ($LASTEXITCODE -ne 0) { Stop-Here "git fetch failed. Check internet, then run this again." }
$localMain = (git rev-parse main).Trim()
$remoteMain = (git rev-parse origin/main).Trim()
git merge-base --is-ancestor main origin/main
$behindOnly = ($LASTEXITCODE -eq 0)
if ($localMain -ne $remoteMain -and -not $behindOnly) { Stop-Here "Your local main has commits that are not on GitHub. Send a screenshot to the Lead." }
$before = (git rev-parse HEAD).Trim()
git checkout -q -B main origin/main
if ($LASTEXITCODE -ne 0) { Stop-Here "Could not switch to main. Send a screenshot to the Lead." }
git branch -q --set-upstream-to=origin/main main
Ok "on main $((git rev-parse --short HEAD).Trim())"

Step "2/5  Local-only files"
$keep = Join-Path $desk "sheetal-local-copies"
foreach ($f in @("photo-gps-report.csv", "photo-gps-summary.csv", "tidy-listings-report.csv")) {
  $dst = Join-Path "backend-core" $f
  if (-not (Test-Path $dst) -and (Test-Path (Join-Path $keep $f))) { Copy-Item (Join-Path $keep $f) $dst; Write-Host "  put back $dst" }
}
if (-not (Test-Path "Claude outputs") -and (Test-Path (Join-Path $keep "Claude outputs"))) { Copy-Item -Recurse (Join-Path $keep "Claude outputs") "Claude outputs"; Write-Host "  put back Claude outputs" }
Ok "local files in place"

Step "3/5  Removing finished branches (only those whose work is already in main)"
# A branch counts as finished when every file it changed is now exactly the same in main (true after a squash merge).
# A branch still waiting for a test or a review differs from main, so it is kept.
function Test-InMain($ref) {
  # Best test: merging the branch into main would change nothing (git 2.38+). Works even when main changed the same files later.
  $merged = git merge-tree --write-tree origin/main $ref 2>$null | Select-Object -First 1
  if ($LASTEXITCODE -eq 0 -and $merged) { return ("$merged".Trim() -eq (git rev-parse "origin/main^{tree}").Trim()) }
  # Older git: every file the branch changed is now exactly the same in main.
  $base = (git merge-base origin/main $ref 2>$null)
  if (-not $base) { return $false }
  $files = git diff --name-only $base $ref
  if (-not $files) { return $true }
  git diff --quiet origin/main $ref -- $files
  return ($LASTEXITCODE -eq 0)
}
foreach ($b in (git for-each-ref --format="%(refname:short)" refs/heads/phase-1/)) {
  if (Test-InMain $b) { git branch -q -D $b; Write-Host "  deleted $b (its work is in main)" } else { Write-Host "  kept $b (not merged yet)" }
}
foreach ($r in (git for-each-ref --format="%(refname:short)" refs/remotes/origin/phase-1/)) {
  $name = $r -replace '^origin/', ''
  if (Test-InMain $r) { git push -q origin --delete $name 2>$null; Write-Host "  deleted on GitHub: $name" } else { Write-Host "  kept on GitHub: $name (not merged yet)" }
}
Ok "finished branches removed"

Step "4/5  Packages and database"
npm install 2>&1 | Out-File -Encoding utf8 (Join-Path $desk "update-npm-install.txt")
if ($LASTEXITCODE -ne 0) { Stop-Here "npm install failed. Send Desktop\update-npm-install.txt to the Lead." }
Ok "packages installed"
# Ask the database itself whether a migration is waiting (not git: a run stopped half-way has already moved the code).
Push-Location backend-core
$status = npx prisma migrate status 2>&1 | Out-String
Pop-Location
$waiting = $status -match "not yet been applied|have not yet been applied|following migration"
if ($status -match "Can't reach database|P1001") { Stop-Here "Can't reach the database. Start it in another terminal (npm run db:local), wait 20 seconds, then run this again." }
if ($waiting) {
  npm run backup -- --no-photos
  if ($LASTEXITCODE -ne 0) { Stop-Here "Backup failed. Is the database running (npm run db:local)?" }
  Ok "backup done (there are new migrations)"
}
Push-Location backend-core
npx prisma migrate deploy 2>&1 | Out-File -Encoding utf8 (Join-Path $desk "update-migrate.txt")
if ($LASTEXITCODE -ne 0) { Pop-Location; Stop-Here "The database update failed. Send Desktop\update-migrate.txt to the Lead." }
$diff = npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script 2>$null
$sql = $diff | Where-Object { "$_" -match '^\s*(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|COMMENT)\b' }
if ($sql) { Pop-Location; Stop-Here "The database differs from the schema. Send a screenshot to the Lead." }
npx prisma generate 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Pop-Location; Stop-Here "Prisma could not rebuild. Close the API servers (Ctrl+C in the dev:api terminal) and run this again." }
Pop-Location
Ok "database matches the schema, Prisma client rebuilt"

Step "5/5  Quick checks"
foreach ($c in @("gen:permissions -- --check", "check:manifests", "check:schema", "check:boundaries")) {
  $out = cmd /c "npm run -s $c 2>&1"
  if ($LASTEXITCODE -ne 0) { $out; Stop-Here "npm run $c failed. Send a screenshot to the Lead." }
  Ok ($out | Select-Object -Last 1)
}
# Data checks: read-only scripts that prove a migration did what it should on YOUR data (they change nothing).
$dataLog = Join-Path $desk "update-data-checks.txt"
"Data checks $(Get-Date -Format 'yyyy-MM-dd HH:mm')" | Out-File -Encoding utf8 $dataLog
foreach ($check in @("backend-core/scripts/check-branch-links.mjs")) {
  if (Test-Path $check) {
    "`n=== $check" | Out-File -Append -Encoding utf8 $dataLog
    node $check 2>&1 | Out-File -Append -Encoding utf8 $dataLog
    if ($LASTEXITCODE -ne 0) { Stop-Here "A data check did not pass. Send Desktop\update-data-checks.txt to the Lead." }
    Ok "data check passed: $(Split-Path -Leaf $check) (details in Desktop\update-data-checks.txt)"
  }
}
git --no-pager log --oneline -4
Write-Host "`nDONE. Tell the Lead: update done." -ForegroundColor Cyan
