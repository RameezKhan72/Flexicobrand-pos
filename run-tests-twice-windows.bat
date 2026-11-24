@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.13+ is required.
  pause
  exit /b 1
)
echo ========= FLEXICO TEST PASS 1 =========
call npm test
if errorlevel 1 (echo FAIL - TEST PASS 1 & pause & exit /b 1)
echo.
echo ========= FLEXICO TEST PASS 2 =========
call npm test
if errorlevel 1 (echo FAIL - TEST PASS 2 & pause & exit /b 1)
echo.
echo Both automated regression passes succeeded.
pause
