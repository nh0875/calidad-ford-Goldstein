@echo off
chcp 65001 >nul
title Reparar el arranque automatico

REM ---------------------------------------------------------------------------
REM  Deja las DOS tareas del sistema bien creadas y verificadas: la del vigilante
REM  (cada 5 minutos) y la de ngrok (el tunel).
REM
REM  SE ELEVA SOLO. Crear tareas programadas necesita permisos de administrador,
REM  y depender de que alguien se acuerde de hacer clic derecho -> "ejecutar como
REM  administrador" es justamente lo que venia fallando. Windows va a pedir la
REM  contrasena de administrador: es lo esperado.
REM ---------------------------------------------------------------------------

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo.
  echo   Pidiendo permisos de administrador...
  echo   Windows va a preguntar. Es normal: crear tareas los necesita.
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

REM Ya elevados. Se le pasa la cuenta que TENIA la sesion abierta, no la de
REM administrador: el sistema y Docker viven en la sesion de esa persona.
for /f "tokens=2 delims==" %%u in ('wmic computersystem get username /value 2^>nul ^| find "="') do set "SESION=%%u"
for /f "tokens=2 delims=\" %%u in ("%SESION%") do set "CUENTA=%%u"

if "%CUENTA%"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Reparar-Arranque.ps1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Reparar-Arranque.ps1" -Usuario "%CUENTA%"
)
