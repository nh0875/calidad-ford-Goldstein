@echo off
chcp 65001 >nul
title Que el sistema se actualice solo

REM Registrar una tarea programada necesita permisos de administrador. En vez de
REM pedirle al usuario que abra PowerShell "como administrador" (que es justo el
REM paso donde se traba todo el mundo), se pide el permiso acá: Windows muestra
REM el cartel de siempre y listo.
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   Pidiendo permiso de administrador...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo.
echo   Dejando la actualizacion automatica andando...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Instalar-Actualizacion-Automatica.ps1"
echo.
pause
