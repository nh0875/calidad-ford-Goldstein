@echo off
chcp 65001 >nul
title Reparar el arranque automatico

REM Registra las dos tareas programadas (vigilante y ngrok) sin pasar por WMI.
REM Sirve cuando la instalacion anduvo bien pero fallo la parte del arranque
REM automatico con errores de "servidor CIM".
REM
REM Necesita permisos de administrador: se piden aca, no hace falta abrir una
REM consola especial.
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   Pidiendo permiso de administrador...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Reparar-Arranque-Automatico.ps1"
