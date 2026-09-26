@echo off
REM Repara el repositorio git del Sistema de Calidad cuando la actualizacion
REM falla siempre con errores de git. No toca la configuracion ni los datos.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Reparar-Git.ps1"
echo.
pause
