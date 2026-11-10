# Phase 0, step 7: finish Phase 0. Merge the finished work into main, tag it phase-0-done and push both.
# Where it fits: only after step 6 showed every check PASS (481 tests, 10 Nov 2026) and QA signed off.
# How to run: .\scripts\ops\RUN-STEP-7.cmd
# Rules: stops if anything is not committed, or if the merge has a conflict (nothing is changed then).

Set-Location (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$work = "phase-0/P0-finish"
function Stop-Here($msg) { Write-Host "`nSTOP: $msg" -ForegroundColor Red; exit 1 }
function Ok($msg) { Write-Host "OK   $msg" -ForegroundColor Green }

Write-Host "`n1/4  Checking" -ForegroundColor Cyan
$cur = (git branch --show-current).Trim()
if ($cur -ne $work) { Stop-Here "Expected branch $work, found $cur. Send this to the Lead." }
git add -A -- scripts/ops
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git commit -q -m "P0-OPS-1: step 7 merge script" }
$left = git status --porcelain
if ($left) { $left; Stop-Here "Some files are not saved (list above). Send the list to the Lead." }
git push -q
git fetch -q origin
Ok "everything saved on $work"

Write-Host "`n2/4  Bringing the work into main" -ForegroundColor Cyan
git show-ref --verify --quiet refs/remotes/origin/main
$remoteMain = ($LASTEXITCODE -eq 0)
git show-ref --verify --quiet refs/heads/main
$localMain = ($LASTEXITCODE -eq 0)
if (-not $remoteMain -and -not $localMain) {
  git branch main $work
  Ok "main did not exist; created it from $work"
} else {
  if ($localMain) { git checkout -q main } else { git checkout -q -b main origin/main }
  if ($remoteMain) { git merge -q --ff-only origin/main 2>$null }
  git merge --no-ff -m "Phase 0 done: repaired database, restored lost code, all checks green" $work
  if ($LASTEXITCODE -ne 0) {
    git merge --abort
    git checkout -q $work
    Stop-Here "main has changes that clash with Phase 0. Nothing was changed. Send this message to the Lead."
  }
  Ok "merged $work into main"
}

Write-Host "`n3/4  Tag and push" -ForegroundColor Cyan
git checkout -q main
git tag -f phase-0-done -m "Phase 0 done: 481 tests, lint and typecheck green (10 Nov 2026)"
git push -u origin main
if ($LASTEXITCODE -ne 0) { Stop-Here "Push of main failed. Check internet, then run this again." }
git push -f origin phase-0-done
Ok "main and tag phase-0-done are on GitHub"

Write-Host "`n4/4  Done" -ForegroundColor Cyan
git --no-pager log --oneline -5
Write-Host "`nPHASE 0 IS FINISHED. Tell the Lead: step 7 done." -ForegroundColor Cyan
Write-Host "You are now on main. New work starts from here on new branches." -ForegroundColor Cyan
