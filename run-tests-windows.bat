@echo off
cd /d "%~dp0"
echo Flexico POS - automated integration checks (temporary data only)
node --test tests/*.test.js
if errorlevel 1 (
  echo Some tests FAILED. Please send a screenshot of this window.
) else (
  echo All automated tests PASSED.
)
pause
