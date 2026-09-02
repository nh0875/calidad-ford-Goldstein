@echo off
chcp 65001 >nul
title Reparar el arranque automatico

REM Registra las dos tareas programadas (vigilante y ngrok) sin pasar por WMI.
REM Sirve cuando la instalacion anduvo bien pero fallo la parte del arranque
REM automatico con errores de "servidor CIM".
REM
REM Pide permisos de administrador solo, y usa -ExecutionPolicy Bypass porque en
REM las PCs de la empresa la ejecucion de scripts viene deshabilitada.

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   Pidiendo permiso de administrador...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs -ArgumentList '%1'"
    exit /b
)

REM La cuenta que va a CORRER las tareas: la que usa la PC todos los dias.
REM Puede venir como argumento (Reparar-Arranque-Automatico.bat DOMINIO\usuario)
REM o se pregunta. Importa porque el que instala suele ser un administrador
REM distinto del usuario, y la tarea tiene que quedar a nombre del usuario: es
REM en SU sesion donde corre Docker.
set "CUENTA=%~1"
if "%CUENTA%"=="" (
    echo.
    echo   Que cuenta de Windows usa esta PC todos los dias?
    echo   Escribila como DOMINIO\usuario  ^(por ejemplo MARIOGOLDSTEIN\ldip^)
    echo   Si sos vos mismo, dejalo vacio y apreta Enter.
    echo.
    set /p "CUENTA=  Cuenta: "
)

echo.
if "%CUENTA%"=="" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Reparar-Arranque-Automatico.ps1"
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Reparar-Arranque-Automatico.ps1" -Usuario "%CUENTA%"
)
