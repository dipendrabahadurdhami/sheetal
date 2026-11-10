@echo off
rem Phase 1, step 1: applies P1-OPS-1 and P1-DB-1. It starts the database if needed, then runs the script.
rem Stop the API servers first (Ctrl+C in the dev:api terminal).
cd /d "%~dp0..\.."
title Sheetal - Phase 1 step 1
echo.
echo Checking the database (port 5433)...
powershell -NoProfile -Command "if (Test-NetConnection -ComputerName localhost -Port 5433 -InformationLevel Quiet -WarningAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo Starting the database in a new window. Leave that window open.
  start "Sheetal database - leave open" cmd /k "npm run db:local"
  echo Waiting 25 seconds for it to start...
  timeout /t 25 /nobreak >nul
)
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\ops\p1-step1.ps1"
echo.
echo Take a screenshot of this window and send it to the Lead.
pause
