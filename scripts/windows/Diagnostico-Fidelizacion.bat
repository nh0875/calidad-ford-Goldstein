@echo off
chcp 65001 >nul
title Por que Seguimiento esta vacio para Fidelizacion

REM ---------------------------------------------------------------------------
REM  Averigua cual de los tres motivos posibles deja vacia la pantalla de
REM  Seguimiento para los usuarios con rol FIDELIZACION: que nunca haya salido un
REM  mensaje, que los mensajes no hayan quedado atados al cliente, o que la
REM  provincia los este escondiendo.
REM
REM  NO se eleva: habla con Docker, y Docker Desktop solo le responde a la sesion
REM  que lo tiene abierto. Elevado con otra cuenta, "docker ps" no ve nada.
REM
REM  NO TOCA NADA: solo lee y cuenta.
REM ---------------------------------------------------------------------------

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Diagnostico-Fidelizacion.ps1"
