@echo off
chcp 65001 >nul
title Por que no llegan los mensajes de los clientes

REM Averigua si el problema esta en el panel de Meta o en esta PC. La prueba que
REM lo decide: si los mensajes que mandamos figuran como "entregados", entonces
REM Meta SI llama al webhook y el problema es otro; si quedaron en "sent", Meta
REM no esta llamando y hay que revisar la configuracion en developers.facebook.com
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Diagnostico-Webhook.ps1"
