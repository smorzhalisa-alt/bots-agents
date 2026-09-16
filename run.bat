@echo off
title Goose School Sync
cd /d "%~dp0"

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo Python not found. Install from https://python.org
    pause
    exit /b 1
)

if not exist "venv" (
    echo Setting up for the first time...
    python -m venv venv
    call venv\Scripts\activate
    pip install -r requirements.txt
) else (
    call venv\Scripts\activate
)

echo.
echo Starting Goose School Sync...
echo Open http://127.0.0.1:5050 in your browser
echo.
start http://127.0.0.1:5050
python app.py
pause
