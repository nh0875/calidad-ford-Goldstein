@echo off
chcp 65001 >nul
title Sistema de Calidad - Diagnostico del tunel de Ford
REM Doble clic con la sesion de Yesica abierta. SIN "Ejecutar como administrador".
REM Ver Diagnosticar-Ngrok-Ford.ps1. Tarda unos 3 minutos.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Diagnosticar-Ngrok-Ford.ps1"
