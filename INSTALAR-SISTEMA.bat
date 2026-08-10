@echo off
chcp 65001 >nul
title Instalador - Sistema de Calidad Ford Goldstein

REM ==================================================================
REM  Doble clic para instalar TODO: ngrok + token, Docker, el sistema,
REM  restaurar los datos (si hay un .dump en esta carpeta) y dejar el
REM  vigilante andando. Se auto-eleva a administrador.
REM ==================================================================

REM -- Pedir permisos de administrador si no los tenemos --
net session >nul 2>&1
if %errorLevel% neq 0 (
  echo Pidiendo permisos de administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

REM -- Ya somos admin: correr el instalador --
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\instalar-todo.ps1"

echo.
echo Si algo salio en ROJO arriba, sacale una foto y avisale a Sistemas.
pause
