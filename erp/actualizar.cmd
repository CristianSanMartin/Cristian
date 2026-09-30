@echo off
rem GS Prime ERP - doble clic para actualizar a la ultima version.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0actualizar.ps1"
echo.
pause
