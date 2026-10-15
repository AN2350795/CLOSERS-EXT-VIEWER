@echo off
setlocal
cd /d "%~dp0"
python explorer.py
if errorlevel 1 pause
