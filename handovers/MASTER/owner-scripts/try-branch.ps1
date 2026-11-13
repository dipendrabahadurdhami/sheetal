# Try a branch: switches this computer to a branch the Lead pushed for a hand test, and starts the servers.
# Nothing is merged; when the test is done, run RUN-UPDATE.cmd to go back to main.
# How to run: .\scripts\ops\RUN-TRY.cmd <branch name the Lead gives you>
param([Parameter(Mandatory = $true)][string]$Branch)

Set-Location (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$desk = Join-Path $HOME "Desktop"
function Stop-Here($msg) { Write-Host "`nSTOP: $msg" -ForegroundColor Red; exit 1 }
function Ok($msg) { Write-Host "OK   $msg" -ForegroundColor Green }

Write-Host "`n1/3  Getting $Branch from GitHub" -ForegroundColor Cyan
# npm install on Windows sometimes rewrites package-lock.json; GitHub's copy is the right one, so put it back.
git checkout -q -- package-lock.json 2>$null
$dirty = git status --porcelain | Where-Object { $_ -notmatch 'scripts/ops/' }
if ($dirty) { $dirty; Stop-Here "There are unsaved changes (listed above). Send a screenshot to the Lead." }
git fetch -q origin $Branch
if ($LASTEXITCODE -ne 0) { Stop-Here "Branch $Branch is not on GitHub. Check the name the Lead gave you." }
git checkout -q -B $Branch FETCH_HEAD
if ($LASTEXITCODE -ne 0) { Stop-Here "Could not switch to $Branch. Send a screenshot to the Lead." }
Ok "on $Branch $((git rev-parse --short HEAD).Trim())"

Write-Host "`n2/3  Packages and database" -ForegroundColor Cyan
npm install 2>&1 | Out-File -Encoding utf8 (Join-Path $desk "try-npm-install.txt")
if ($LASTEXITCODE -ne 0) { Stop-Here "npm install failed. Send Desktop\try-npm-install.txt to the Lead." }
Push-Location backend-core
$pending = npx prisma migrate status 2>$null | Select-String "not yet been applied"
if ($pending) { Pop-Location; Stop-Here "This branch has database changes that are not applied. Tell the Lead (it should not happen for a hand test)." }
npx prisma generate 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Pop-Location; Stop-Here "Prisma could not rebuild. Close the API servers (Ctrl+C in the dev:api terminal) and run this again." }
Pop-Location
Ok "packages installed, database matches"

Write-Host "`n3/3  Starting the servers in two new windows (leave them open)" -ForegroundColor Cyan
# Any API still running from before would hold the ports: stop it first.
foreach ($port in 4000, 4001, 4002, 5173, 5174, 5175) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}
# The API output also goes to Desktop\try-api.txt, so the Lead can read it if something fails.
$apiLog = Join-Path $desk "try-api.txt"
Start-Process cmd.exe -ArgumentList "/k", "title Sheetal APIs - leave open && npm run dev:api > `"$apiLog`" 2>&1"
Start-Process cmd.exe -ArgumentList "/k", "title Sheetal screens - leave open && npm run dev"
Write-Host "  waiting for the APIs to answer (up to 90 seconds)..."
$up = @{}
for ($i = 0; $i -lt 45 -and $up.Count -lt 3; $i++) {
  Start-Sleep -Seconds 2
  foreach ($port in 4000, 4001, 4002) {
    if (-not $up.ContainsKey($port)) {
      try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$port/health" | Out-Null; $up[$port] = $true }
      catch { if ($_.Exception.Response) { $up[$port] = $true } }
    }
  }
}
if ($up.Count -lt 3) {
  Write-Host "`nLast lines of the API window:" -ForegroundColor Yellow
  Get-Content $apiLog -Tail 30 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $_" }
  Stop-Here "An API did not start (details in Desktop\try-api.txt). Tell the Lead: api failed."
}
Ok "all three APIs answer; screens at http://localhost:5173 (website), /business, /admin"
Write-Host "`nDONE. Tell the Lead: try ready. (When the test is over: close the two windows, then run RUN-UPDATE.cmd.)" -ForegroundColor Cyan
