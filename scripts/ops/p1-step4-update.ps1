# Phase 1, step 4: P1-DB-1b and P1-BE-1 are merged into main on GitHub (squash, CI green, QA approved).
# This brings your computer to the new main, deletes the two finished branches, and builds the three APIs the way
# production does (scripts/build-api.mjs bundles backend-core and now platform into dist/server.js).
# How to run: .\scripts\ops\RUN-P1-STEP-4.cmd

Set-Location (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$desk = Join-Path $HOME "Desktop"
function Stop-Here($msg) { Write-Host "`nSTOP: $msg" -ForegroundColor Red; exit 1 }
function Ok($msg) { Write-Host "OK   $msg" -ForegroundColor Green }

Write-Host "`n1/5  Getting the new main from GitHub" -ForegroundColor Cyan
$dirty = git status --porcelain | Where-Object { $_ -notmatch 'scripts/ops/' }
if ($dirty) { $dirty; Stop-Here "There are unsaved changes (listed above). Send a screenshot to the Lead." }
git fetch -q --prune origin
if ($LASTEXITCODE -ne 0) { Stop-Here "git fetch failed. Check internet, then run this again." }
$localMain = (git rev-parse main).Trim()
$remoteMain = (git rev-parse origin/main).Trim()
git merge-base --is-ancestor main origin/main
$behindOnly = ($LASTEXITCODE -eq 0)
if ($localMain -ne $remoteMain -and -not $behindOnly) { Stop-Here "Your local main has commits that are not on GitHub. Send a screenshot to the Lead." }
Ok "GitHub main is $($remoteMain.Substring(0,7))"

Write-Host "`n2/5  Switching to the new main" -ForegroundColor Cyan
git checkout -q -B main origin/main
if ($LASTEXITCODE -ne 0) { Stop-Here "Could not switch to main. Send a screenshot to the Lead." }
git branch -q --set-upstream-to=origin/main main
Ok "on main $((git rev-parse --short HEAD).Trim())"

Write-Host "`n3/5  Making sure your local files are all still there" -ForegroundColor Cyan
$keep = Join-Path $desk "sheetal-local-copies"
foreach ($f in @("photo-gps-report.csv", "photo-gps-summary.csv", "tidy-listings-report.csv")) {
  $dst = Join-Path "backend-core" $f
  if (-not (Test-Path $dst) -and (Test-Path (Join-Path $keep $f))) { Copy-Item (Join-Path $keep $f) $dst; Write-Host "  put back $dst" }
}
if (-not (Test-Path "Claude outputs") -and (Test-Path (Join-Path $keep "Claude outputs"))) { Copy-Item -Recurse (Join-Path $keep "Claude outputs") "Claude outputs"; Write-Host "  put back Claude outputs" }
$tracked = git ls-files | Select-String -Pattern '^Claude outputs/|photo-gps-[^/]*\.csv$|-report\.csv$'
if ($tracked) { Stop-Here "Report files are tracked again. Send a screenshot to the Lead." }
Ok "local files in place, none of them in git"

Write-Host "`n4/5  Deleting the two finished branches (their work is in main)" -ForegroundColor Cyan
foreach ($b in @("phase-1/P1-DB-1b-review-audit", "phase-1/P1-BE-1-core-primitives")) {
  git show-ref --verify --quiet "refs/heads/$b"
  if ($LASTEXITCODE -eq 0) { git branch -q -D $b }
  git ls-remote --exit-code --heads origin $b *> $null
  if ($LASTEXITCODE -eq 0) { git push -q origin --delete $b }
}
npm install 2>&1 | Out-Null
Push-Location backend-core; npx prisma migrate status 2>$null | Select-String "up to date|not yet been applied"; Pop-Location
Write-Host "`n5/5  Production build of the three APIs (bundles the new platform files)" -ForegroundColor Cyan
foreach ($dir in @("website/backend", "business/backend", "admin/backend")) {
  Push-Location $dir
  node ../../scripts/build-api.mjs 2>&1 | Out-File -Encoding utf8 (Join-Path $desk "p1-build-$($dir.Split('/')[0]).txt")
  $code = $LASTEXITCODE
  Pop-Location
  if ($code -ne 0) { Stop-Here "The $dir build failed. Send Desktop\p1-build-$($dir.Split('/')[0]).txt to the Lead." }
  Ok "$dir builds (dist/server.js)"
}
$distTracked = git ls-files | Select-String -Pattern '/dist/'
if ($distTracked) { Stop-Here "Build output is tracked by git. Send a screenshot to the Lead." }
git --no-pager log --oneline -5
Write-Host "`nDONE. Tell the Lead: step 4 done." -ForegroundColor Cyan
