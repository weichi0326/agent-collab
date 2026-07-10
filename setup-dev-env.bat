@echo off
setlocal
cd /d "%~dp0"

echo Multi-Agent Tool - development environment setup
echo This will check Python, Node.js, Rust, project dependencies, and build tools.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-dev-env.ps1"
set EXIT_CODE=%ERRORLEVEL%

echo.
if not "%EXIT_CODE%"=="0" (
  echo Setup did not finish successfully. Please read the message above.
) else (
  echo Setup finished successfully.
)
pause
exit /b %EXIT_CODE%
