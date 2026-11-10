# Phase 1, step 1: apply P1-OPS-1 (clean-up + empty workspaces + CI) and then P1-DB-1 (kernel database columns).
# The Lead put the reviewed files in scripts/ops/p1-step1/ (same folders as the repo). This script copies them in on
# their own branches, in the order QA asked for, and writes everything QA needs to Desktop\p1-step1-report.txt.
#   Branch 1: phase-1/P1-OPS-1-workspaces   (from main)
#   Branch 2: phase-1/P1-DB-1-kernel-base   (from branch 1, so the clean-up never has to be undone on disk)
# How to run: .\scripts\ops\RUN-P1-STEP-1.cmd   (stop the API servers first: Ctrl+C in the dev:api terminal)
# Rules: stops at the first problem with a clear message. Running it again is safe (it continues where it stopped).

Set-Location (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$repo = (Get-Location).Path
$desk = Join-Path $HOME "Desktop"
$report = Join-Path $desk "p1-step1-report.txt"
$opsBranch = "phase-1/P1-OPS-1-workspaces"
$dbBranch = "phase-1/P1-DB-1-kernel-base"
$trailer = @("-m", "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>", "-m", "Claude-Session: https://claude.ai/code/session_01VaYig1RW2H1HEkMCaLayKD")
function Stop-Here($msg) { Write-Host "`nSTOP: $msg" -ForegroundColor Red; "`nSTOPPED: $msg" | Out-File -Append -Encoding utf8 $report; exit 1 }
function Ok($msg) { Write-Host "OK   $msg" -ForegroundColor Green; "OK   $msg" | Out-File -Append -Encoding utf8 $report }
function Section($msg) { Write-Host "`n$msg" -ForegroundColor Cyan; "`n==================== $msg ====================" | Out-File -Append -Encoding utf8 $report }
function Note($text) { $text | Out-File -Append -Encoding utf8 $report }
function Copy-In($rel) {
  $src = Join-Path $payload $rel
  if (-not (Test-Path $src)) { Stop-Here "Missing file $src. Tell the Lead." }
  $dst = Join-Path $repo $rel
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
  Copy-Item -Force $src $dst
}
function Run-Check($name) {
  $log = Join-Path $desk "p1-check-$name.txt"
  Write-Host "  running npm run check (about 6-8 minutes)..."
  npm run check 2>&1 | Out-File -Encoding utf8 $log
  $code = $LASTEXITCODE
  Note "--- last 60 lines of npm run check ($name), exit code $code ---"
  Get-Content $log -Tail 60 | Out-File -Append -Encoding utf8 $report
  if ($code -ne 0) { Stop-Here "npm run check failed ($name). Send p1-step1-report.txt and p1-check-$name.txt (Desktop) to the Lead." }
  Ok "npm run check passed ($name)"
}

"Sheetal Phase 1 step 1 report - $(Get-Date -Format 'yyyy-MM-dd HH:mm')" | Out-File -Encoding utf8 $report
# The reviewed files wait in scripts/ops/p1-step1; move them to the Desktop so lint and tests never scan them.
$waiting = Join-Path $repo "scripts/ops/p1-step1"
$payload = Join-Path $desk "sheetal-p1-step1-files"
if (Test-Path $waiting) {
  if (Test-Path $payload) { Remove-Item -Recurse -Force $payload }
  Move-Item $waiting $payload
}
if (-not (Test-Path $payload)) { Stop-Here "The Lead's files are missing (scripts/ops/p1-step1). Tell the Lead." }

# ------------------------- Part A: P1-OPS-1 -------------------------
Section "1/9  Where we are"
$cur = (git branch --show-current).Trim()
git show-ref --verify --quiet "refs/heads/$opsBranch"; $opsExists = ($LASTEXITCODE -eq 0)
git show-ref --verify --quiet "refs/heads/$dbBranch"; $dbExists = ($LASTEXITCODE -eq 0)
Note "branch: $cur"
if (-not $opsExists) {
  if ($cur -ne "main") { Stop-Here "Expected branch main, found $cur. Send this to the Lead." }
  git pull -q
  if ($LASTEXITCODE -ne 0) { Stop-Here "git pull failed. Check internet, then run this again." }
  # Only the Lead's new step files may be waiting; anything else means unsaved work.
  $dirty = git status --porcelain | Where-Object { $_ -notmatch 'scripts/ops/' }
  if ($dirty) { Note ($dirty -join "`n"); Stop-Here "There are unsaved changes on main (listed in the report). Send the report to the Lead." }
  Ok "on main, up to date, nothing unsaved"
} else { Ok "continuing (branch $opsBranch already exists)" }

Section "2/9  Safety tag pre-phase1 (on GitHub too)"
git rev-parse -q --verify "refs/tags/pre-phase1" | Out-Null
if ($LASTEXITCODE -ne 0) {
  if ($opsExists) { git tag pre-phase1 main } else { git tag pre-phase1 }
}
git push -q origin pre-phase1 2>$null
Ok "tag pre-phase1 is at $(git rev-parse --short pre-phase1)"

Section "3/9  Keeping a copy of the report files and Claude outputs (they leave git, never your disk)"
$keep = Join-Path $desk "sheetal-local-copies"
New-Item -ItemType Directory -Force -Path $keep | Out-Null
foreach ($f in @("backend-core/photo-gps-report.csv", "backend-core/photo-gps-summary.csv", "backend-core/tidy-listings-report.csv")) {
  if (Test-Path $f) { Copy-Item -Force $f $keep }
}
if (Test-Path "Claude outputs") { Copy-Item -Recurse -Force "Claude outputs" $keep }
Ok "copies in Desktop\sheetal-local-copies"

Section "4/9  P1-OPS-1: stop tracking generated reports"
if ($dbExists) { git checkout -q $opsBranch } elseif ($opsExists) { git checkout -q $opsBranch } else { git checkout -q -b $opsBranch }
if ($LASTEXITCODE -ne 0) { Stop-Here "Could not switch to $opsBranch. Send this to the Lead." }
Copy-In ".gitignore"
git rm -r -q --cached --ignore-unmatch "Claude outputs" | Out-Null
git rm -q --cached --ignore-unmatch backend-core/photo-gps-report.csv backend-core/photo-gps-summary.csv backend-core/tidy-listings-report.csv | Out-Null
$still = git ls-files | Select-String -Pattern '^Claude outputs/|photo-gps-[^/]*\.csv$|-report\.csv$'
if ($still) { Note ($still -join "`n"); Stop-Here "Some report files are still tracked (listed in the report)." }
Note "git check-ignore:"; git check-ignore -v "Claude outputs/x" backend-core/photo-gps-report.csv backend-core/photo-gps-summary.csv backend-core/tidy-listings-report.csv 2>&1 | Out-File -Append -Encoding utf8 $report
git add .gitignore
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git commit -q -m "P1-OPS-1: stop tracking generated reports" @trailer
  if ($LASTEXITCODE -ne 0) { Stop-Here "Commit failed. Send this to the Lead." }
}
Ok "reports and Claude outputs no longer in git (still on disk)"

Section "5/9  P1-OPS-1: empty workspaces, new checks, CI"
$opsFiles = @(
  "package.json", "tsconfig.json", "eslint.config.js", "vitest.config.js",
  "scripts/help.mjs", "scripts/check-boundaries.mjs", "scripts/gen-permissions.mjs", "scripts/check-manifests.mjs", "scripts/check-schema-ownership.mjs",
  "platform/package.json", "platform/tsconfig.json", "platform/vitest.config.js", "platform/src/index.ts",
  "packages/ui/package.json", "packages/ui/tsconfig.json", "packages/ui/src/index.js",
  "packages/sdk/package.json", "packages/sdk/tsconfig.json", "packages/sdk/src/index.js",
  "packages/config/package.json", "packages/config/tsconfig.json", "packages/config/src/index.js",
  "apps/expenses/package.json", "apps/expenses/tsconfig.json", "apps/expenses/vitest.config.js", "apps/expenses/src/index.ts",
  "apps/reviews/package.json", "apps/reviews/tsconfig.json", "apps/reviews/vitest.config.js", "apps/reviews/src/index.ts"
)
foreach ($f in $opsFiles) { Copy-In $f }
# The GitHub check: .github is written by this script (the Lead cannot write there); a copy stays in scripts/ops.
$wf = Join-Path $payload "github-workflows-copy/workflows/check.yml"
New-Item -ItemType Directory -Force -Path ".github/workflows" | Out-Null
Copy-Item -Force $wf ".github/workflows/check.yml"
Copy-Item -Force $wf "scripts/ops/check.yml"
Write-Host "  npm install (links the new workspaces)..."
npm install 2>&1 | Out-File -Encoding utf8 (Join-Path $desk "p1-npm-install.txt")
if ($LASTEXITCODE -ne 0) { Stop-Here "npm install failed. Send p1-npm-install.txt (Desktop) to the Lead." }
Note "npm ls of the six new packages:"
npm ls @sheetal/platform @sheetal/ui @sheetal/sdk @sheetal/config @sheetal/app-expenses @sheetal/app-reviews --depth=0 2>&1 | Out-File -Append -Encoding utf8 $report
Ok "workspaces installed"
Run-Check "after-OPS-1"
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git commit -q -m "P1-OPS-1: add empty workspaces" @trailer
  if ($LASTEXITCODE -ne 0) { Stop-Here "Commit failed. Send this to the Lead." }
}
git push -q -u origin $opsBranch
if ($LASTEXITCODE -ne 0) { Stop-Here "Push failed. Check internet, then run this again." }
Ok "P1-OPS-1 saved on GitHub ($opsBranch)"

# ------------------------- Part B: P1-DB-1 -------------------------
Section "6/9  P1-DB-1: new branch and files"
if ($dbExists) { git checkout -q $dbBranch } else { git checkout -q -b $dbBranch }
if ($LASTEXITCODE -ne 0) { Stop-Here "Could not switch to $dbBranch. Send this to the Lead." }
Copy-In "backend-core/prisma/schema.prisma"
Copy-In "backend-core/prisma/migrations/20261110090000_kernel_base/migration.sql"
git add -- backend-core/prisma/schema.prisma backend-core/prisma/migrations/20261110090000_kernel_base
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git commit -q -m "P1-DB-1: kernel base columns, paisa columns, event outbox, demo flag" @trailer
  if ($LASTEXITCODE -ne 0) { Stop-Here "Commit failed. Send this to the Lead." }
}
Ok "on $dbBranch, files committed"

Section "7/9  Backup, then change the database"
npm run backup -- --no-photos
if ($LASTEXITCODE -ne 0) { Stop-Here "Backup failed. Is the database running (npm run db:local)?" }
Ok "backup done"
Push-Location backend-core
npx prisma migrate deploy 2>&1 | Tee-Object -Variable dep | Out-Host
if ($LASTEXITCODE -ne 0) { Note ($dep -join "`n"); Pop-Location; Stop-Here "The migration did not apply. Send the report to the Lead." }
Note "--- prisma migrate status ---"
npx prisma migrate status 2>&1 | Out-File -Append -Encoding utf8 $report
# Only the script itself (stdout); Prisma's warnings go to stderr and are not differences.
$diff = npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script 2>$null
Note "--- prisma migrate diff (must be empty) ---"; Note ($diff -join "`n")
$sql = $diff | Where-Object { "$_" -match '^\s*(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|COMMENT)\b' }
if ($sql) { Pop-Location; Stop-Here "The database differs from the schema. Send p1-step1-report.txt to the Lead." }
Ok "database matches the schema exactly"
npx prisma generate 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Pop-Location; Stop-Here "Prisma could not rebuild. Close the API servers (Ctrl+C in the dev:api terminal) and run this again." }
Pop-Location
Ok "Prisma client rebuilt"

Section "8/9  Database spot checks (every number must be 0)"
node scripts/ops/p1-sql-checks.mjs 2>&1 | Tee-Object -Variable chk | Out-Host
Note ($chk -join "`n")
if ($LASTEXITCODE -ne 0) { Stop-Here "A database check is not 0. Send p1-step1-report.txt to the Lead." }
Ok "all spot checks are 0"

Section "9/9  Every check again, then save"
Run-Check "after-DB-1"
git add -- scripts/ops/p1-sql-checks.mjs scripts/ops/p1-step1.ps1 scripts/ops/RUN-P1-STEP-1.cmd
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git commit -q -m "P1-DB-1: step script and database spot checks" @trailer }
git push -q -u origin $dbBranch
if ($LASTEXITCODE -ne 0) { Stop-Here "Push failed. Check internet, then run: git push -u origin $dbBranch" }
Ok "P1-DB-1 saved on GitHub ($dbBranch)"
Remove-Item -Recurse -Force $payload
Note "`n--- git log ---"; git --no-pager log --oneline -6 | Out-File -Append -Encoding utf8 $report

Write-Host "`nDONE. Send Desktop\p1-step1-report.txt to the QA chat, then tell the Lead: P1 step 1 done." -ForegroundColor Cyan
