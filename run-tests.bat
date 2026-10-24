@echo off
chcp 65001 >nul
title Stock Tool - full test run
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 ( echo [x] Node.js not found. Install Node.js 22 LTS or newer from https://nodejs.org & pause & exit /b 1 )
rem Install / update dependencies when package-lock.json changed since the last install.
node -e "const f=require('fs');try{process.exit(f.statSync('package-lock.json').mtimeMs>f.statSync('node_modules/.package-lock.json').mtimeMs?1:0)}catch{process.exit(1)}"
if errorlevel 1 (
  echo Installing / updating dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 ( echo [x] npm install failed. & pause & exit /b 1 )
  rem A running start-localhost.bat restarts itself when next.config.ts changes, so it picks up the new packages.
  node -e "const f=require('fs');const t=new Date();f.utimesSync('next.config.ts',t,t)"
)
echo Checking the test browser (the first time this downloads Chromium, about 150 MB)...
call npx playwright install chromium
if errorlevel 1 ( echo [x] Could not install the test browser. & pause & exit /b 1 )
echo.
echo Running all checks. Your data folder and a running start-localhost.bat are not touched.
echo Takes about 6-10 minutes. Add --quick to skip the browser suites.
echo.
call node scripts\run-tests.mjs --live %*
set RESULT=%errorlevel%
if exist "test-results\report.html" start "" "test-results\report.html"
echo.
if "%RESULT%"=="0" ( echo All checks passed. Report: test-results\report.html ) else ( echo Some checks failed - see test-results\report.html )
pause
