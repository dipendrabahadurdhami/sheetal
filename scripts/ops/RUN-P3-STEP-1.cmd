@echo off
rem Phase 3, step 1: the dry run of "plans to apps" on a COPY of your data (backup, scratch copy, catalog check, dry run, price report).
rem Your real data is only read. The servers may stay open. Running it again is safe.
cd /d "%~dp0..\.."
title Sheetal - Phase 3 step 1 (dry run on a copy)
echo.
echo Checking the database (port 5433)...
powershell -NoProfile -Command "if (Test-NetConnection -ComputerName 127.0.0.1 -Port 5433 -InformationLevel Quiet -WarningAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo Starting the database in a new window. Leave that window open.
  start "Sheetal database - leave open" cmd /k "npm run db:local"
  echo Waiting 25 seconds for it to start...
  timeout /t 25 /nobreak >nul
)
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\ops\p3-step1.ps1"
echo.
echo Take a screenshot of this window and send it.
pause
