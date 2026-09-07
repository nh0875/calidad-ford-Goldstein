@echo off
chcp 65001 >nul
title Respaldo del Sistema de Calidad
echo.
echo   Haciendo una copia de seguridad de la base de datos...
echo   (no cierres esta ventana hasta que termine)
echo.

REM ------------------------------------------------------------------
REM  Mismo criterio que Actualizar-AHORA.bat: el .ps1 normalmente esta al lado
REM  (%~dp0), pero si alguien copia SOLO este .bat al Escritorio, el .ps1 no
REM  viaja con el y PowerShell falla con un error que no explica nada.
REM ------------------------------------------------------------------
set "PS1=%~dp0Respaldo-Calidad.ps1"
if not exist "%PS1%" set "PS1=%~dp0scripts\windows\Respaldo-Calidad.ps1"
if not exist "%PS1%" set "PS1=C:\Calidad\Vanina\scripts\windows\Respaldo-Calidad.ps1"

if not exist "%PS1%" (
  echo   No encuentro el sistema desde aca.
  echo.
  echo   Este archivo parece ser una COPIA suelta. Abri el ORIGINAL, que vive en
  echo   la carpeta del sistema, normalmente:
  echo.
  echo       C:\Calidad\Vanina\scripts\windows\Respaldo-AHORA.bat
  echo.
  echo   Para tenerlo a mano en el Escritorio NO lo copies: clic derecho sobre el
  echo   original y "Enviar a" ^> "Escritorio (crear acceso directo)".
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
echo.
echo   ============================================================
echo    Si dice "Respaldo terminado OK (offsite: ...)": salio de esta PC.
echo    Si dice "SOLO LOCAL": NO subio a la nube. Avisale a Ignacio.
echo    Si aparece algo en ROJO: sacale una foto y avisale a Ignacio.
echo   ============================================================
echo.
pause
