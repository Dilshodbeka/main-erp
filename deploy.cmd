@echo off
setlocal
cd /d "%~dp0"

echo Checking Cloudflare access...
call npx wrangler whoami >nul 2>&1
if errorlevel 1 (
  echo Not logged in. A browser window will open for Cloudflare login.
  call npx wrangler login
  if errorlevel 1 goto fail
)

echo Building and uploading...
call npm run deploy
if errorlevel 1 goto fail

echo.
echo Done. Open https://erp-tizim.doybek5557.workers.dev and press Ctrl+F5.
pause
exit /b 0

:fail
echo.
echo Deploy failed. Read the messages above.
echo If login failed, run this file again or run: npx wrangler login
pause
exit /b 1
