@echo off
chcp 65001 >nul
title Sistema de Calidad - Levantar
echo.
echo    ================================================
echo      LEVANTAR EL SISTEMA DE CALIDAD
echo    ================================================
echo.
echo    Estoy levantando el sistema. Puede tardar 1 a 2 minutos.
echo    No cierres esta ventana hasta que diga LISTO.
echo.

REM Corre el "vigilante": arranca Docker si hace falta, levanta los
REM contenedores y ngrok, y espera a que el sistema responda. La carpeta se
REM detecta sola desde la ubicacion de este archivo (%~dp0).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\vigilante.ps1"

echo.
echo    Verificando que el sistema responda...
curl -s -m 6 http://localhost/api/health | findstr "ok" >nul
if %errorlevel%==0 (
  echo.
  echo    ================================================
  echo      LISTO. El sistema esta andando.
  echo      Abri el navegador en:   http://localhost
  echo    ================================================
) else (
  echo.
  echo    El sistema todavia esta arrancando.
  echo    Espera 1 minuto mas y abri:   http://localhost
  echo    Si despues de unos minutos sigue sin andar, avisa al soporte.
)
echo.
pause
