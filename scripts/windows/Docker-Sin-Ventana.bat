@echo off
chcp 65001 >nul
title Que Docker no abra su ventana

REM Deja Docker Desktop arrancando SIN abrir su panel. El motor sigue andando
REM igual: lo unico que cambia es que no aparece la ventana cada vez que la
REM persona inicia sesion.
REM
REM Se puede pasar la cuenta:  Docker-Sin-Ventana.bat ldip
REM Para volver atras:         Docker-Sin-Ventana.bat -Mostrar

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Docker-Sin-Ventana.ps1" %*
