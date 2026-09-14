@echo off
chcp 65001 >nul
title Sistema de Calidad - Retirar esta PC
REM Doble clic, SIN administrador: un proceso elevado no llega a Docker Desktop.
REM Si alguna tarea programada no se deja sacar, se vuelve a correr como
REM administrador SOLO para eso. Ver Retirar-PC.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Retirar-PC.ps1"
echo.
pause
