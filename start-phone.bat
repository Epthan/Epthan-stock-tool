@echo off
title Stock Tool - phone access (port 3001)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [x] Node.js not found. Install Node.js 22 LTS or newer from https://nodejs.org then run this again.
  pause
  exit /b 1
)
echo Node: & node -v
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>23||(a===22&&b>=13)||(a===23&&b>=4)?0:1)"
if errorlevel 1 echo [!] This Node has no built-in SQLite: data is saved as data\store.json, without history or price archive. Install Node 22.13+ to enable them.
rem Install / update dependencies when package-lock.json changed since the last install.
node -e "const f=require('fs');try{process.exit(f.statSync('package-lock.json').mtimeMs>f.statSync('node_modules/.package-lock.json').mtimeMs?1:0)}catch{process.exit(1)}"
if errorlevel 1 (
  echo Installing / updating dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 ( echo [x] npm install failed. & pause & exit /b 1 )
)
echo Building the optimized version, about 1 minute...
call npm run build
if errorlevel 1 ( echo [x] Build failed. & pause & exit /b 1 )
echo.
echo ============================================================
echo  On your phone, connected to the SAME Wi-Fi, open one of:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do for /f "tokens=* delims= " %%b in ("%%a") do echo     http://%%b:3001
echo.
echo  If the phone cannot connect: when Windows asks, allow Node.js
echo  on Private networks (or allow port 3001 in Windows Firewall).
echo  Keep this window open while using the app. Close it to stop.
echo ============================================================
echo.
call npx next start -H 0.0.0.0 -p 3001
pause
