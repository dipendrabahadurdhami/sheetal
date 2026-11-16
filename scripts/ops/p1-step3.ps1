# Phase 1, step 3: apply P1-DB-1b (review audit columns, Lead) and then P1-BE-1 (core primitives in platform/,
# plus the Lead's read-only support-session fix). QA: approve with fixes; this is the first real run of the new tests.
#   Branch 1: phase-1/P1-DB-1b-review-audit   (from main)
#   Branch 2: phase-1/P1-BE-1-core-primitives (from branch 1)
# How to run: .\scripts\ops\RUN-P1-STEP-3.cmd   (stop the API servers first: Ctrl+C in the dev:api terminal)
# Writes Desktop\p1-step3-report.txt. Stops at the first problem. Running it again is safe.

Set-Location (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$repo = (Get-Location).Path
$desk = Join-Path $HOME "Desktop"
$report = Join-Path $desk "p1-step3-report.txt"
$dbBranch = "phase-1/P1-DB-1b-review-audit"
$beBranch = "phase-1/P1-BE-1-core-primitives"
$trailer = @()
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
# Adds up the "Tests  N passed (M failed)" lines of every test run in a log (colour codes removed).
function Count-Tests($log) {
  $p = 0; $f = 0
  $esc = [string][char]27
  foreach ($line in (Get-Content $log)) {
    $l = $line -replace ([regex]::Escape($esc) + '\[[0-9;]*m'), ''
    if ($l -match '^\s*Tests\s') {
      if ($l -match '(\d+) passed') { $p += [int]$Matches[1] }
      if ($l -match '(\d+) failed') { $f += [int]$Matches[1] }
    }
  }
  return "passed $p, failed $f"
}

"Sheetal Phase 1 step 3 report - $(Get-Date -Format 'yyyy-MM-dd HH:mm')" | Out-File -Encoding utf8 $report
# The reviewed files wait in scripts/ops/p1-step3; move them to the Desktop so lint and tests never scan them.
$waiting = Join-Path $repo "scripts/ops/p1-step3"
$payload = Join-Path $desk "sheetal-p1-step3-files"
if (Test-Path $waiting) {
  if (Test-Path $payload) { Remove-Item -Recurse -Force $payload }
  Move-Item $waiting $payload
}
if (-not (Test-Path $payload)) { Stop-Here "The Lead's files are missing (scripts/ops/p1-step3). Tell the Lead." }

Section "1/8  Where we are"
$cur = (git branch --show-current).Trim()
git show-ref --verify --quiet "refs/heads/$dbBranch"; $dbExists = ($LASTEXITCODE -eq 0)
git show-ref --verify --quiet "refs/heads/$beBranch"; $beExists = ($LASTEXITCODE -eq 0)
Note "branch: $cur"
if (-not $dbExists) {
  if ($cur -ne "main") { Stop-Here "Expected branch main, found $cur. Run RUN-P1-STEP-2.cmd first, or send a screenshot to the Lead." }
  git pull -q
  if ($LASTEXITCODE -ne 0) { Stop-Here "git pull failed. Check internet, then run this again." }
  $dirty = git status --porcelain | Where-Object { $_ -notmatch 'scripts/ops/' }
  if ($dirty) { Note ($dirty -join "`n"); Stop-Here "There are unsaved changes on main (listed in the report)." }
  Ok "on main, up to date, nothing unsaved"
} else { Ok "continuing" }

Section "2/8  P1-DB-1b: review audit columns (branch and commit)"
if ($dbExists) { git checkout -q $dbBranch } else { git checkout -q -b $dbBranch }
if ($LASTEXITCODE -ne 0) { Stop-Here "Could not switch to $dbBranch." }
Copy-In "backend-core/prisma/schema.prisma"
Copy-In "backend-core/prisma/migrations/20261110120000_review_audit_columns/migration.sql"
git add -- backend-core/prisma/schema.prisma backend-core/prisma/migrations/20261110120000_review_audit_columns
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git commit -q -m "P1-DB-1b: created_by and updated_by on reviews (kernel columns)" @trailer
  if ($LASTEXITCODE -ne 0) { Stop-Here "Commit failed." }
}
Ok "on $dbBranch, files committed"

Section "3/8  Backup, then change the database"
npm run backup -- --no-photos
if ($LASTEXITCODE -ne 0) { Stop-Here "Backup failed. Is the database running (npm run db:local)?" }
Ok "backup done"
Push-Location backend-core
npx prisma migrate deploy 2>&1 | Tee-Object -Variable dep | Out-Host
if ($LASTEXITCODE -ne 0) { Note ($dep -join "`n"); Pop-Location; Stop-Here "The migration did not apply. Send the report to the Lead." }
# Only the script itself (stdout); Prisma's warnings go to stderr and are not differences.
$diff = npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script 2>$null
Note "--- prisma migrate diff (must be empty) ---"; Note ($diff -join "`n")
$sql = $diff | Where-Object { "$_" -match '^\s*(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|COMMENT)\b' }
if ($sql) { Pop-Location; Stop-Here "The database differs from the schema. Send p1-step3-report.txt to the Lead." }
Ok "database matches the schema exactly"
npx prisma generate 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Pop-Location; Stop-Here "Prisma could not rebuild. Close the API servers (Ctrl+C in the dev:api terminal) and run this again." }
Pop-Location
Ok "Prisma client rebuilt"
git push -q -u origin $dbBranch
if ($LASTEXITCODE -ne 0) { Stop-Here "Push failed. Check internet, then run this again." }
Ok "P1-DB-1b on GitHub"

Section "4/8  P1-BE-1: branch and files"
if ($beExists) { git checkout -q $beBranch } else { git checkout -q -b $beBranch }
if ($LASTEXITCODE -ne 0) { Stop-Here "Could not switch to $beBranch." }
$beFiles = @(
  "backend-core/package.json", "backend-core/src/config.ts", "backend-core/src/lib/db.ts", "backend-core/src/lib/errors.ts",
  "backend-core/src/lib/secrets.ts", "backend-core/src/lib/vault.ts", "eslint.config.js",
  "platform/package.json", "platform/vitest.config.js", "platform/src/auth/secrets.ts", "platform/src/auth/vault.ts",
  "platform/src/core/config.ts", "platform/src/core/context.ts", "platform/src/core/controller.ts", "platform/src/core/errors.ts",
  "platform/src/core/events.ts", "platform/src/core/money.ts", "platform/src/core/repository.ts", "platform/src/core/service.ts",
  "platform/src/core/testing/context.ts", "platform/src/core/testing/isolation.ts", "platform/src/core/validation.ts",
  "platform/src/db/client.ts",
  "platform/test/config.test.ts", "platform/test/errors.test.ts", "platform/test/events.test.ts", "platform/test/expense-fixture.ts",
  "platform/test/impersonation.test.ts", "platform/test/money.test.ts", "platform/test/repository.test.ts", "platform/test/validation.test.ts"
)
foreach ($f in $beFiles) { Copy-In $f }
Write-Host "  npm install (platform gets its packages)..."
npm install 2>&1 | Out-File -Encoding utf8 (Join-Path $desk "p1-npm-install.txt")
if ($LASTEXITCODE -ne 0) { Stop-Here "npm install failed. Send p1-npm-install.txt (Desktop) to the Lead." }
Ok "files in place, packages installed"

$passed = Join-Path $desk "p1-step3-checks-passed.txt"
if (Test-Path $passed) {
  Section "5-6/8  Tests already passed on this branch: $(Get-Content $passed -Raw)"
  # Keep the earlier results in this report for QA.
  foreach ($old in @("p1-platform-test.txt", "p1-check-step3.txt")) {
    $f = Join-Path $desk $old
    if (Test-Path $f) { Note "--- last 60 lines of $old (earlier run) ---"; Get-Content $f -Tail 60 | Out-File -Append -Encoding utf8 $report }
  }
} else {
Section "5/8  Platform tests alone (the new kernel tests)"
$plog = Join-Path $desk "p1-platform-test.txt"
npm run test -w @sheetal/platform 2>&1 | Out-File -Encoding utf8 $plog
$pcode = $LASTEXITCODE
$pcount = Count-Tests $plog
Note "platform tests: $pcount, exit code $pcode"
Get-Content $plog -Tail 40 | Out-File -Append -Encoding utf8 $report
if ($pcode -ne 0) { Stop-Here "Some platform tests failed ($pcount). Send p1-step3-report.txt and p1-platform-test.txt (Desktop) to the Lead." }
Ok "platform tests passed ($pcount)"

Section "6/8  Every check (about 6-8 minutes)"
$clog = Join-Path $desk "p1-check-step3.txt"
npm run check 2>&1 | Out-File -Encoding utf8 $clog
$ccode = $LASTEXITCODE
$ccount = Count-Tests $clog
Note "npm run check: $ccount, exit code $ccode  (old tests were 481)"
Get-Content $clog -Tail 60 | Out-File -Append -Encoding utf8 $report
if ($ccode -ne 0) { Stop-Here "npm run check failed ($ccount). Send p1-step3-report.txt and p1-check-step3.txt (Desktop) to the Lead." }
Ok "npm run check passed ($ccount)"
"platform $pcount; all checks $ccount ($(Get-Date -Format 'HH:mm'))" | Out-File -Encoding utf8 $passed
}

Section "7/8  Start the three APIs once (old code now loads through the shims)"
$apiLog = Join-Path $desk "p1-api-start.txt"
$api = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run dev:api > `"$apiLog`" 2>&1" -PassThru -WindowStyle Hidden
$up = @{}
for ($i = 0; $i -lt 30 -and $up.Count -lt 3; $i++) {
  Start-Sleep -Seconds 2
  foreach ($port in 4000, 4001, 4002) {
    if (-not $up.ContainsKey($port)) {
      try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$port/health" | Out-Null; $up[$port] = "ok" }
      catch { if ($_.Exception.Response) { $up[$port] = "answers ($([int]$_.Exception.Response.StatusCode))" } }
    }
  }
}
taskkill /PID $api.Id /T /F 2>&1 | Out-Null
foreach ($port in 4000, 4001, 4002) {
  $state = if ($up.ContainsKey($port)) { $up[$port] } else { "NO ANSWER" }
  Note "port ${port}: $state"
}
foreach ($port in 4000, 4001, 4002) { if (-not $up.ContainsKey($port)) { Note "  (log) $(Select-String -Path $apiLog -Pattern "listening at http://127.0.0.1:$port" -SimpleMatch | Select-Object -First 1)" } }
if ($up.Count -lt 3) { Stop-Here "An API did not start. Send p1-step3-report.txt and p1-api-start.txt (Desktop) to the Lead." }
Ok "all three APIs started and answered"

Section "8/8  Save on GitHub"
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git commit -q -m "P1-BE-1: core primitives in platform (errors, db, config, vault, secrets moved with shims; Money, repository, service, controller, events)" @trailer
  if ($LASTEXITCODE -ne 0) { Stop-Here "Commit failed." }
}
git push -q -u origin $beBranch
if ($LASTEXITCODE -ne 0) { Stop-Here "Push failed. Check internet, then run: git push -u origin $beBranch" }
Remove-Item -Recurse -Force $payload
Remove-Item -Force $passed -ErrorAction SilentlyContinue
Note "`n--- git log ---"; git --no-pager log --oneline -4 | Out-File -Append -Encoding utf8 $report
Ok "P1-BE-1 on GitHub ($beBranch)"
Write-Host "`nDONE. Send Desktop\p1-step3-report.txt to QA, then tell the Lead: step 3 done." -ForegroundColor Cyan
