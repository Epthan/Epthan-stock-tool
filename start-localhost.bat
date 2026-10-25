@echo off
title Stock Tool - localhost:3000
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
echo Starting dev server on http://localhost:3000 ...
call npx next dev -H 127.0.0.1
pause
