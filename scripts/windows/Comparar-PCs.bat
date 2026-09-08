@echo off
chcp 65001 >nul
title Comparar esta PC con la otra

REM ---------------------------------------------------------------------------
REM  Junta en un archivo de texto todo lo que hace falta para comparar la PC de
REM  Ford (donde el tunel anda) con la de Volkswagen (donde el antivirus borra el
REM  ngrok.exe). Se corre en LAS DOS y se comparan los dos archivos.
REM
REM  POR QUE EXISTE ESTE .BAT Y NO SE CORRE EL .PS1 A MANO.
REM  Abrir PowerShell "como administrador" arranca en C:\Windows\System32 y con
REM  el PATH del ADMINISTRADOR, no el de la persona. Ahi fallan dos cosas
REM  seguidas: git "no se reconoce" (esta instalado en el perfil de la persona) y
REM  despues el .ps1 "no se encuentra" (porque la carpeta actual es System32, no
REM  la del sistema). Este .bat usa %~dp0, que es SU PROPIA carpeta, asi que
REM  encuentra el script sin importar desde donde se lo llame ni con que cuenta.
REM
REM  Se eleva solo: las exclusiones del antivirus no se pueden leer sin permisos.
REM  Windows va a pedir la contrasena de administrador; es lo esperado.
REM
REM  NO TOCA NADA. Solo lee y deja un .txt en el Escritorio.
REM ---------------------------------------------------------------------------

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo.
  echo   Pidiendo permisos de administrador...
  echo   Sin ellos no se pueden leer las exclusiones del antivirus,
  echo   que es justo lo que hay que comparar entre las dos PCs.
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Comparar-PCs.ps1"
