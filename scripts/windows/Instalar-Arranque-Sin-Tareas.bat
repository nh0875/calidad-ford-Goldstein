@echo off
chcp 65001 >nul
title Arranque automatico sin tareas programadas

REM Deja el sistema arrancando solo poniendo un acceso directo en la carpeta de
REM Inicio de Windows, SIN usar tareas programadas.
REM
REM Se usa cuando Reparar-Arranque-Automatico.bat falla con "Acceso denegado":
REM hay PCs de empresa donde las politicas y el antivirus no dejan registrar
REM tareas de ninguna forma.
REM
REM NO necesita permisos de administrador si lo corre la persona que usa la PC:
REM la carpeta de Inicio es suya.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Instalar-Arranque-Sin-Tareas.ps1" %*

