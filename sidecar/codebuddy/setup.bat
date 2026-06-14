@echo off
REM CodeBuddy Sidecar — Setup Script (Windows)
REM Usage: setup.bat

setlocal enabledelayedexpansion
cd /d "%~dp0"

echo === CodeBuddy Sidecar Setup ===

REM 1. Check Python
set "PYTHON="
where python >nul 2>&1
if %errorlevel%==0 (
    for /f "tokens=2 delims= " %%v in ('python --version 2^>^&1') do set "PYVER=%%v"
    set "PYTHON=python"
)

if not defined PYTHON (
    echo ❌ Python 3.11+ required but not found.
    echo    Install via: winget install Python.Python.3.11
    exit /b 1
)

echo ✓ Python: %PYVER%

REM 2. Create venv
if not exist ".venv" (
    echo → Creating virtual environment...
    %PYTHON% -m venv .venv
) else (
    echo ✓ venv already exists
)

REM 3. Install dependencies
echo → Installing dependencies...
.venv\Scripts\pip.exe install -r requirements.txt --quiet

REM 4. Install Playwright Firefox
echo → Installing Playwright Firefox browser...
.venv\Scripts\python.exe -m playwright install firefox

REM 5. Install Camoufox binary + GeoIP
echo → Installing Camoufox binary...
.venv\Scripts\python.exe -m camoufox fetch

REM 6. Create cookies directory
if not exist "cookies" mkdir cookies

REM 7. Verify
echo → Verifying sidecar...
echo {"cmd": "shutdown"} | .venv\Scripts\python.exe main.py 2>nul | findstr "shutdown_ack" >nul
if %errorlevel%==0 (
    echo ✓ Sidecar verified — ready!
) else (
    echo ❌ Verification failed.
    exit /b 1
)

echo.
echo === Setup Complete ===
echo Sidecar path: %~dp0
echo Python venv:  %~dp0.venv
echo Run with:     echo {"cmd": "shutdown"} ^| .venv\Scripts\python.exe main.py

endlocal
