@echo off
chcp 65001 >nul
title Sistema de Calidad - Migrar al servidor
REM Doble clic, SIN "Ejecutar como administrador": un proceso elevado no llega a
REM Docker Desktop. Ver Migrar-A-Servidor.ps1 para lo que hace.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Migrar-A-Servidor.ps1"
echo.
pause
