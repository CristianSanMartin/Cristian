@echo off
rem Revision de Proformas - doble clic para publicar la ultima version de la web.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0actualizar.ps1"
echo.
pause
