@echo off
chcp 65001 >nul
title Sistema de Calidad - Arreglar el arranque de Ford
REM Doble clic con la sesion de Yesica abierta. SIN "Ejecutar como administrador":
REM un proceso elevado no llega a Docker Desktop. Ver Arreglar-Arranque-Ford.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Arreglar-Arranque-Ford.ps1"
