@echo off
title Goose School
cd /d "%~dp0"

pip install flask octodiary 2>nul

echo.
echo  Goose School starting...
echo  Open http://localhost:5050
echo.

timeout /t 2 /nobreak >nul
start http://localhost:5050

python app.py
pause
