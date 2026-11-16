@echo off
rem Phase 3 cutover on the REAL data: step 2, every business with app rows moves to shadow. Nobody sees a change; differences are recorded for 7 days.
rem Close the server windows first. It takes a backup, shows a preview, and writes only after you type YES.
cd /d "%~dp0..\.."
title Sheetal - Phase 3 cutover (2: shadow)
echo.
echo Checking the database (port 5433)...
powershell -NoProfile -Command "if (Test-NetConnection -ComputerName 127.0.0.1 -Port 5433 -InformationLevel Quiet -WarningAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo Starting the database in a new window. Leave that window open.
  start "Sheetal database - leave open" cmd /k "npm run db:local"
  echo Waiting 25 seconds for it to start...
  timeout /t 25 /nobreak >nul
)
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\ops\p3-cutover.ps1" -Step 2
echo.
echo Take a screenshot of this window and send it.
pause