@echo off
rem Try a branch for a hand test: RUN-TRY.cmd <branch>. Stop the API servers first (Ctrl+C in the dev:api terminal).
cd /d "%~dp0..\.."
title Sheetal - try a branch
if "%~1"=="" (
  echo Give the branch name, for example: .\scripts\ops\RUN-TRY.cmd phase-1/P1-FE-1-kit
  pause
  exit /b 1
)
echo.
echo Checking the database (port 5433)...
powershell -NoProfile -Command "if (Test-NetConnection -ComputerName localhost -Port 5433 -InformationLevel Quiet -WarningAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo Starting the database in a new window. Leave that window open.
  start "Sheetal database - leave open" cmd /k "npm run db:local"
  echo Waiting 25 seconds for it to start...
  timeout /t 25 /nobreak >nul
)
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\ops\try-branch.ps1" -Branch "%~1"
echo.
echo Take a screenshot of this window and send it to the Lead.
pause
