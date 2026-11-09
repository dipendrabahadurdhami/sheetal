# Phase 0, step 1 (P0-OPS-1): save ALL current work to GitHub on a safety branch, before any repair.
# Where it fits: the first thing run in Phase 0. Nothing is changed in the code; it only checks and commits.
# How to run (PowerShell, repo root, with the database running in another terminal: npm run db:local):
#   powershell -ExecutionPolicy Bypass -File .\scripts\ops\p0-step1-safety.ps1
# Rules: it stops at the first problem and says what to do. Running it again is safe.

Set-Location (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
function Stop-Here($msg) { Write-Host "`nSTOP: $msg" -ForegroundColor Red; exit 1 }
function Ok($msg) { Write-Host "OK   $msg" -ForegroundColor Green }
function Commit-Part($msg, [string[]]$paths) {
  git add -A -- $paths
  git diff --cached --quiet
  if ($LASTEXITCODE -eq 0) { Ok "nothing new for: $msg"; return }
  git commit -q -m $msg
  if ($LASTEXITCODE -ne 0) {
    Stop-Here "Commit failed ($msg). If git asked who you are, run these two lines, then run this script again:`n  git config user.name ""Dipendra""`n  git config user.email ""dipendrabahadurdhami77@gmail.com"""
  }
  Ok "committed: $msg"
}

Write-Host "`n1/6  Backup of the database" -ForegroundColor Cyan
npm run backup -- --no-photos
if ($LASTEXITCODE -ne 0) { Stop-Here "Backup failed. Start the database in another terminal (npm run db:local) and run this script again." }
Ok "backup done"

Write-Host "`n2/6  Safety branch" -ForegroundColor Cyan
$was = (git branch --show-current).Trim()
if ($was -ne "wip/before-phase-0") {
  git show-ref --verify --quiet refs/heads/wip/before-phase-0
  if ($LASTEXITCODE -eq 0) { git checkout -q wip/before-phase-0 } else { git checkout -q -b wip/before-phase-0 }
  if ($LASTEXITCODE -ne 0) { Stop-Here "Could not switch to the branch wip/before-phase-0. Send this message to the Lead." }
}
Ok "on wip/before-phase-0 (started from $was)"

Write-Host "`n3/6  Checking that no password or key gets saved" -ForegroundColor Cyan
foreach ($p in @("backend-core/.env", "test-accounts.csv", "backend-core/.pgdata/PG_VERSION", "OUT-test.zip", "business/frontend/.env.local")) {
  git check-ignore -q $p
  if ($LASTEXITCODE -ne 0) { Stop-Here "$p is NOT ignored by .gitignore. Send this message to the Lead." }
}
$secret = '(^|/)\.env($|\.)|\.pgdata|\.zip$|test-accounts\.csv$|\.pem$|\.key$'
$tracked = git ls-files | Where-Object { $_ -match $secret -and $_ -notmatch '\.example$' }
if ($tracked) { $tracked; Stop-Here "These secret-looking files are already saved in git (list above). Send the list to the Lead." }
$pending = git status --porcelain -uall | Where-Object { $_ -match $secret -and $_ -notmatch '\.example$' }
if ($pending) { $pending; Stop-Here "These secret-looking files would be saved (list above). Send the list to the Lead." }
$big = git ls-files --others --exclude-standard | ForEach-Object { Get-Item -LiteralPath $_ -ErrorAction SilentlyContinue } | Where-Object { $_.Length -gt 5MB }
if ($big) { $big | Select-Object FullName, @{n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } } | Format-Table; Stop-Here "Files over 5 MB would be saved (list above). Send the list to the Lead." }
if (-not (Test-Path package-lock.json)) { Stop-Here "package-lock.json is missing. Run: npm install   then run this script again." }
Ok "no secrets, no big files, package-lock.json present"

Write-Host "`n4/6  Saving the work in small commits" -ForegroundColor Cyan
Commit-Part "P0-OPS-1: tighten .gitignore (env files, keys, dumps)" @(".gitignore")
Commit-Part "P0-OPS-1: save work before phase 0 - backend-core" @("backend-core")
Commit-Part "P0-OPS-1: save work before phase 0 - shared" @("shared")
Commit-Part "P0-OPS-1: save work before phase 0 - website" @("website")
Commit-Part "P0-OPS-1: save work before phase 0 - business" @("business")
Commit-Part "P0-OPS-1: save work before phase 0 - admin" @("admin")
Commit-Part "P0-OPS-1: save work before phase 0 - mail-server" @("mail-server")
Commit-Part "P0-OPS-1: save work before phase 0 - scripts and docs" @("scripts", "docs", ":(exclude)docs/GIT-WORKFLOW.md", ":(exclude)scripts/ops/check.yml")
Commit-Part "P0-OPS-1: save work before phase 0 - root files" @(".", ":(exclude).github", ":(exclude)docs/GIT-WORKFLOW.md")

Write-Host "`n5/6  Sending the safety branch to GitHub" -ForegroundColor Cyan
git push -u origin wip/before-phase-0
if ($LASTEXITCODE -ne 0) { Stop-Here "Push failed. Check internet and GitHub sign-in, then run this script again." }
Ok "safety branch is on GitHub"

Write-Host "`n6/6  Adding the automatic GitHub check and the git guide" -ForegroundColor Cyan
New-Item -ItemType Directory -Force ".github/workflows" | Out-Null
Copy-Item -Force "scripts/ops/check.yml" ".github/workflows/check.yml"
Commit-Part "P0-OPS-1: add GitHub check workflow and git workflow guide" @(".github", "docs/GIT-WORKFLOW.md", "scripts/ops/check.yml")
git push
if ($LASTEXITCODE -ne 0) { Stop-Here "Push failed. Check internet and GitHub sign-in, then run: git push" }

$left = git status --porcelain
if ($left) { $left; Write-Host "`nSome files are still not saved (list above). Send the list to the Lead." -ForegroundColor Yellow }
else { Ok "everything saved; working folder clean" }
git log --oneline -12
Write-Host "`nDONE. Tell the Lead: step 1 done." -ForegroundColor Cyan
Write-Host "GitHub's Actions tab will show a red 'check' run for now. That is expected until the repairs are merged." -ForegroundColor Cyan
