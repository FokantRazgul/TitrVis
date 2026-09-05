@echo off
setlocal enabledelayedexpansion

echo.
echo 🧪 TitrVis Setup
echo ================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Node.js is not installed. Please install from https://nodejs.org/
    pause
    exit /b 1
)

echo ✓ Node.js %NODE_VERSION%
node -v

echo.
echo 📦 Installing dependencies...
call npm install --prefer-offline --no-audit

if %ERRORLEVEL% NEQ 0 (
    echo ❌ Installation failed. Please check your internet connection and try again.
    pause
    exit /b 1
)

echo.
echo ✓ Installation complete!
echo.
echo 📖 Quick start:
echo    npm run dev          # Start development server
echo    npm run build        # Build for production
echo    npm test             # Run unit tests
echo    npm run test:e2e     # Run browser tests
echo.
echo 🎮 Controls:
echo    Space (hold)  → titrate
echo    Shift (hold)  → swirl
echo    1/2/3         → lighting
echo    R             → reset
echo    S             → screenshot
echo.
echo Ready to go! Run 'npm run dev' to start.
pause
