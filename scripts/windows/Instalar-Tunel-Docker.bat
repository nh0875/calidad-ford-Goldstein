@echo off
chcp 65001 >nul
title Levantar el tunel de ngrok en Docker

REM ---------------------------------------------------------------------------
REM  Deja el tunel andando adentro de un contenedor, donde el antivirus no lo
REM  puede borrar. Ver docker-compose.tunel.yml para el por que.
REM
REM  NO se eleva. A diferencia del resto de los scripts, este no necesita
REM  permisos de administrador: no crea tareas programadas ni toca el registro,
REM  solo habla con Docker. Y conviene que corra con la cuenta de la persona,
REM  porque Docker Desktop solo le responde a la sesion que lo tiene abierto --
REM  elevado con otra cuenta, "docker ps" no ve nada.
REM
REM  Usa %~dp0 (su propia carpeta) asi que se puede hacer doble clic desde el
REM  Explorador sin escribir ninguna ruta.
REM ---------------------------------------------------------------------------

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Instalar-Tunel-Docker.ps1" %*
