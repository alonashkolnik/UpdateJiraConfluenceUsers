@echo off
title Atlassian User Manager
echo ============================================
echo   Atlassian User Manager - Starting...
echo ============================================
echo.
echo Building application...
call npx vite build
if errorlevel 1 (
    echo Build failed!
    pause
    exit /b 1
)
echo.
echo Build complete. Launching Electron...
echo Logs: %%APPDATA%%\atlassian-user-manager\logs\
echo.
del /q dist-electron\preload\preload.js 2>nul
npx electron .
echo.
echo Application closed.
pause
