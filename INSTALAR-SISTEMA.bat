@echo off
chcp 65001 >nul
title Instalador - Sistema de Calidad Ford Goldstein

REM ==================================================================
REM  Doble clic para instalar TODO: token de ngrok, Docker, build,
REM  restaurar los datos y dejar el arranque automatico.
REM
REM  IMPORTANTE: corre en modo NORMAL (asi Docker responde). El propio
REM  script pide permisos de administrador SOLO para el pedacito del
REM  arranque automatico (energia + vigilante).
REM  --> NO lo ejecutes "como administrador": tiene que ir con doble clic.
REM ==================================================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\instalar-todo.ps1"

echo.
echo Si algo salio en ROJO arriba, sacale una foto y avisale a Sistemas.
pause
