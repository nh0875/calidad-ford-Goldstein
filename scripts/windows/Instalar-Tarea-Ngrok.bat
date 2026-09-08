@echo off
chcp 65001 >nul
title Tarea propia para ngrok

REM Le da a ngrok su propia tarea programada, para que NO muera cuando se
REM reinicia la del vigilante. Sin esto, ngrok queda como proceso hijo y Windows
REM se lo lleva puesto con todo el arbol: el tunel muere y quien abre el link ve
REM el error ERR_NGROK_3200 de ngrok ("el endpoint esta offline").
REM
REM Hay que correrlo COMO ADMINISTRADOR: la cuenta de todos los dias no puede
REM crear tareas. Cambia "ldip" si la cuenta se llama distinto.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Instalar-Tarea-Ngrok.ps1" -Usuario ldip
