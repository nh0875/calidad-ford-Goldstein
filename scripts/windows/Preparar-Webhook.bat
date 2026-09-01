@echo off
chcp 65001 >nul
title Preparar el webhook de Meta

REM Deja el tunel de ngrok vivo y comprueba que Meta va a poder verificar la URL
REM ANTES de que lo intentes en el panel. Correr esto justo antes de configurar
REM el webhook, y NO cerrar la ventana hasta que Meta lo haya aceptado.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Preparar-Webhook.ps1"
