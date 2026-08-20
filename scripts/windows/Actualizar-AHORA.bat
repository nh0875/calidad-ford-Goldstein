@echo off
chcp 65001 >nul
title Actualizar el Sistema de Calidad
echo.
echo   Actualizando el sistema a la ultima version...
echo   Esto tarda varios minutos. NO cierres esta ventana.
echo.
REM %~dp0 es la carpeta de ESTE archivo, asi que no importa desde donde se abra
REM (doble clic, o PowerShell parado en cualquier lado). Ese fue justo el error
REM la primera vez: se corrio desde C:\WINDOWS\system32 y no encontraba el .ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0actualizar-sistema.ps1"
echo.
echo   ============================================================
echo    Si arriba dice "LISTO": el sistema quedo actualizado.
echo    Si aparece algo en ROJO: sacale una foto y avisale a Ignacio.
echo   ============================================================
echo.
pause
