@echo off
chcp 65001 >nul
title Actualizar el Sistema de Calidad
echo.
echo   Actualizando el sistema a la ultima version...
echo   Esto tarda varios minutos. NO cierres esta ventana.
echo.

REM ------------------------------------------------------------------
REM  Donde esta el .ps1 que hace el trabajo.
REM
REM  Lo normal es que este AL LADO de este archivo (%~dp0), asi no importa
REM  desde donde se abra: doble clic, o una consola parada en cualquier lado.
REM  Ese fue el primer error que aparecio: correrlo desde C:\WINDOWS\system32.
REM
REM  Pero si alguien COPIA este .bat a otro lado (tipico: al Escritorio, para
REM  tenerlo a mano), el .ps1 no viaja con el y PowerShell tira un error que no
REM  explica nada: "El argumento ...\actualizar-sistema.ps1 para el parametro
REM  -File no existe". Paso en la PC de Ford. Por eso ahora se lo busca tambien
REM  en las ubicaciones habituales, y si no aparece se dice QUE hacer.
REM ------------------------------------------------------------------
set "PS1=%~dp0actualizar-sistema.ps1"
if not exist "%PS1%" set "PS1=%~dp0scripts\windows\actualizar-sistema.ps1"
if not exist "%PS1%" set "PS1=C:\Calidad\Vanina\scripts\windows\actualizar-sistema.ps1"

if not exist "%PS1%" (
  echo   No encuentro el sistema desde aca.
  echo.
  echo   Este archivo parece ser una COPIA suelta. Abri el ORIGINAL, que vive en
  echo   la carpeta del sistema, normalmente:
  echo.
  echo       C:\Calidad\Vanina\scripts\windows\Actualizar-AHORA.bat
  echo.
  echo   Para tenerlo a mano en el Escritorio NO lo copies: clic derecho sobre el
  echo   original y "Enviar a" ^> "Escritorio (crear acceso directo)".
  echo   Un acceso directo siempre apunta al original; una copia no.
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
echo.
echo   ============================================================
echo    Si arriba dice "LISTO": el sistema quedo actualizado.
echo    Si aparece algo en ROJO: sacale una foto y avisale a Ignacio.
echo   ============================================================
echo.
pause
