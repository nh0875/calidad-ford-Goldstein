@echo off
REM Diagnostico del arranque automatico del Sistema de Calidad.
REM No toca nada: junta informacion y deja un archivo en el Escritorio.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Diagnostico-Arranque.ps1"
echo.
pause
