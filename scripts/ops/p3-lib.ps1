# Shared helpers of the Phase 3 owner scripts (p3-step1.ps1, p3-step2.ps1, p3-cutover.ps1). Not run on its own.
# What it gives: a report file on the Desktop, Stop-Here / Ok / Run-Step (run one command, keep its output in the report, show the last
# lines), Hide (a database address can carry the password: it never reaches the screen or the report), Ask-Yes (the typed YES), and
# Ends-With-Pass (our scripts end their last line with PASS or FAIL).
# How to use: . (Join-Path $PSScriptRoot "p3-lib.ps1"); Start-Report "p3-step1-report.txt" "Phase 3 step 1"
Set-Location (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$desk = Join-Path $HOME "Desktop"
$script:report = $null

function Hide($lines) { $lines | ForEach-Object { "$_" -replace 'postgres(ql)?://\S+', '[database address hidden]' } }
function Start-Report($file, $title) {
  $script:report = Join-Path $desk $file
  "$title  $(Get-Date -Format 'yyyy-MM-dd HH:mm')" | Out-File -Encoding utf8 $script:report
}
function Stop-Here($msg) {
  Write-Host "`nSTOP: $msg" -ForegroundColor Red
  "`nSTOPPED: $msg" | Out-File -Append -Encoding utf8 $script:report
  Write-Host "The full output is in $script:report" -ForegroundColor Yellow
  exit 1
}
function Ok($msg) { Write-Host "OK   $msg" -ForegroundColor Green; "OK   $msg" | Out-File -Append -Encoding utf8 $script:report }
function Run-Step($title, $command, $tail) {
  Write-Host "`n$title" -ForegroundColor Cyan
  "`n=== $title`n> $command" | Out-File -Append -Encoding utf8 $script:report
  $out = cmd /c "$command 2>&1"
  $code = $LASTEXITCODE
  $out = Hide $out
  $out | Out-File -Append -Encoding utf8 $script:report
  $out | Select-Object -Last $tail | ForEach-Object { Write-Host "  $_" }
  return @{ code = $code; out = $out }
}
# True when the command ended well and its last line ends with PASS.
function Ends-With-Pass($r) { return ($r.code -eq 0 -and "$($r.out | Select-Object -Last 1)" -match 'PASS$') }
function Ask-Yes($question) {
  $answer = Read-Host "`n$question Type YES"
  return ($answer -ceq "YES")
}
function Need-Database() {
  if (-not (Test-NetConnection -ComputerName 127.0.0.1 -Port 5433 -InformationLevel Quiet -WarningAction SilentlyContinue)) {
    Stop-Here "The database is not running. Start it (npm run db:local) and run this again."
  }
}
# The three APIs must be stopped while a mode changes (they remember a business for a short time).
function Need-Servers-Stopped() {
  foreach ($port in 4000, 4001, 4002) {
    if (Test-NetConnection -ComputerName 127.0.0.1 -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue) {
      Stop-Here "An API server is still running (port $port). Close the server windows, then run this again."
    }
  }
}
