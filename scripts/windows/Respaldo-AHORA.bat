@echo off
chcp 65001 >nul
title Respaldo del Sistema de Calidad
echo.
echo   Haciendo una copia de seguridad de la base de datos...
echo   (no cierres esta ventana hasta que termine)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Respaldo-Calidad.ps1"
echo.
echo   ============================================================
echo    Si arriba dice "Respaldo terminado": quedo guardado. OK.
echo    Si aparece algo en ROJO: sacale una foto y avisale a Ignacio.
echo   ============================================================
echo.
pause
