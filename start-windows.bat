@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERROR: Node.js is not installed or not in PATH.
  echo Install Node.js 22.13 or newer from https://nodejs.org/
  echo Then close this window and start again.
  pause
  exit /b 1
)
node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=13)?0:1)" >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERROR: Flexico POS needs Node.js version 22.13 or newer.
  node -v
  echo Download the current LTS installer from https://nodejs.org/
  pause
  exit /b 1
)
echo.
echo =========================================================
echo           FLEXICO POS - v1.4 SHOPIFY AUTH + CREAM GOLD RC

echo                 LOCAL-FIRST POS + WEBSITE CATALOGUE SYNC

echo =========================================================
echo.
echo Local address: http://localhost:3147
echo KEEP THIS WINDOW OPEN WHILE WORKING.
echo CLOSE WITH Ctrl+C AFTER WORKING.
echo.
start "" "http://localhost:3147"
node server.js
if errorlevel 1 (
  echo.
  echo FLEXICO POS stopped due to an error. Read the above text.
)
pause
