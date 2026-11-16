# Phase 3 cutover on the REAL data (P3-OPS-2; MARKETPLACE-AND-BILLING.md section 8.6; the runbook is docs/p3-cutover-runbook.md).
# One file, five steps; each RUN-P3-CUTOVER-*.cmd runs one. Every step: backup first, a preview that writes nothing, then your typed YES.
#   -Step 1     the migration writes the app rows. Every business stays on "plans": nobody sees a change.
#   -Step 2     every business with app rows moves to "shadow": the plan still answers, differences are recorded. Wait 7 days.
#   -Step 3     the pilot: the businesses you name move to "apps" (they see the marketplace). Their open plan invoices are voided.
#   -Step 4     everyone moves to "apps" (needs 7 days on shadow with no difference where the new system gives less).
#   -Step back  go back to "plans": for the businesses you name, or for everyone. Refused for a business that bought on the new system.
#   -Step status  the list only. Changes nothing, asks nothing.
# To undo step 1 (nothing sold yet): npm run billing:migrate -- --restore     To undo everything: npm run restore -- <backup name> --yes
# How to run: close the server windows first, then .\scripts\ops\RUN-P3-CUTOVER-1.cmd (and so on). Report: Desktop\p3-cutover-report.txt
param([Parameter(Mandatory = $true)][ValidateSet("1", "2", "3", "4", "back", "status")][string]$Step)
. (Join-Path $PSScriptRoot "p3-lib.ps1")
Start-Report "p3-cutover-$Step-report.txt" "Phase 3 cutover, step $Step"
Need-Database
$send = "Send Desktop\p3-cutover-$Step-report.txt."

if ($Step -eq "status") {
  $r = Run-Step "The billing modes (changes nothing)" "npm run -s billing:mode" 40
  if (Ends-With-Pass $r) { Ok "no business gets less than its plan gave" } else { Stop-Here "A business would get less than its plan gave (the lines with LESS). Do not go on. $send" }
  exit 0
}

Need-Servers-Stopped
function Backup-First() {
  $r = Run-Step "Backup" "npm run -s backup -- --no-photos" 4
  if ($r.code -ne 0) { Stop-Here "Backup failed. Nothing was changed." }
  $savedIn = ($r.out | Select-String -Pattern "saved in (.+)$" | Select-Object -First 1)
  $where = if ($savedIn) { $savedIn.Matches[0].Groups[1].Value.Trim() } else { "(see the backup lines above)" }
  Ok "backup done: to undo everything, restore $where"
}
# Asks for business ids (letters, digits, - and _ only; commas between them).
function Ask-Businesses($question) {
  $ids = (Read-Host "`n$question").Trim() -replace '\s', ''
  if ($ids -notmatch '^[A-Za-z0-9_-]+(,[A-Za-z0-9_-]+)*$') { Stop-Here "That is not a list of business ids (letters and digits, commas between). Nothing was changed." }
  return $ids
}
# Preview (must pass), typed YES, then the same command with --apply (must pass).
function Preview-Then-Apply($what, $command, $question) {
  $r = Run-Step "Preview: $what (writes nothing)" $command 25
  if (-not (Ends-With-Pass $r)) { Stop-Here "The preview did not end with PASS, so nothing was changed. $send" }
  Ok "preview passed"
  if (-not (Ask-Yes $question)) { Stop-Here "Nothing was changed. Run this again when you are ready." }
  $r = Run-Step "Now for real: $what" "$command --apply" 25
  if (-not (Ends-With-Pass $r)) { Stop-Here "It did not end with PASS. What was written is listed above (each business is all-or-nothing). $send" }
}

switch ($Step) {
  "1" {
    Backup-First
    Preview-Then-Apply "the migration writes the app rows" "npm run -s billing:migrate --" "The preview passed. Write the app rows now? (Nobody sees a change: every business stays on plans.)"
    Ok "app rows written; every business is still on plans"
    Write-Host "`nDONE. Start the servers again. Next, when you are ready: RUN-P3-CUTOVER-2.cmd" -ForegroundColor Cyan
  }
  "2" {
    Backup-First
    Preview-Then-Apply "every business with app rows moves to shadow" "npm run -s billing:mode -- --to=shadow --all" "Move them to shadow now? (Nobody sees a change: the plan still answers.)"
    Ok "shadow is on from today. Wait 7 days, then RUN-P3-CUTOVER-STATUS.cmd"
    Write-Host "`nDONE. Start the servers again. In Admin, Billing, the shadow counter must stay at zero 'less' for 7 days." -ForegroundColor Cyan
  }
  "3" {
    $ids = Ask-Businesses "Which businesses are the pilot? Paste their ids with commas between (Sheetal's own business first)"
    Backup-First
    Preview-Then-Apply "the pilot moves to apps" "npm run -s billing:mode -- --to=apps --business=$ids --min-days=0" "Move the pilot to apps now? (They will see the marketplace; their open plan invoices are voided.)"
    Ok "the pilot is on apps"
    Write-Host "`nDONE. Start the servers again. Switch sales on in Admin, Pricing, Billing rules when you want the pilot to be able to pay." -ForegroundColor Cyan
  }
  "4" {
    Backup-First
    Preview-Then-Apply "everyone moves to apps" "npm run -s billing:mode -- --to=apps --all" "Move EVERY business to apps now? (Everyone sees the marketplace; open plan invoices are voided.)"
    Ok "every business with app rows is on apps"
    Write-Host "`nDONE. Start the servers again. The old plans are no longer used." -ForegroundColor Cyan
  }
  "back" {
    $ids = (Read-Host "`nGo back to plans for which businesses? Paste ids with commas between, or type ALL").Trim() -replace '\s', ''
    $who = if ($ids -ceq "ALL") { "--all" } elseif ($ids -match '^[A-Za-z0-9_-]+(,[A-Za-z0-9_-]+)*$') { "--business=$ids" } else { Stop-Here "That is not a list of business ids, and not ALL. Nothing was changed." }
    Backup-First
    Preview-Then-Apply "go back to plans" "npm run -s billing:mode -- --to=plans $who" "Go back to plans now?"
    Ok "they are on plans again (their app rows stay, unused; an invoice that was voided stays void; a new one is made at the next reminder or when the business pays from its Billing page)"
    Write-Host "`nDONE. Start the servers again." -ForegroundColor Cyan
  }
}
