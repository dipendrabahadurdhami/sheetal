@echo off
rem One time, after the update that ends Phase 1: rewrites the permissions stored on every role to the new names
rem (backup, preview, rewrite after you type YES, check), then copies the connection settings and refreshes the test accounts.
rem Stop the API servers first (Ctrl+C in the dev:api window).
cd /d "%~dp0..\.."
title Sheetal - role rewrite
echo.
echo Checking the database (port 5433)...
powershell -NoProfile -Command "if (Test-NetConnection -ComputerName localhost -Port 5433 -InformationLevel Quiet -WarningAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo Starting the database in a new window. Leave that window open.
  start "Sheetal database - leave open" cmd /k "npm run db:local"
  echo Waiting 25 seconds for it to start...
  timeout /t 25 /nobreak >nul
)
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\ops\p1-roles.ps1"
echo.
echo Take a screenshot of this window and send it to the Lead.
pause
