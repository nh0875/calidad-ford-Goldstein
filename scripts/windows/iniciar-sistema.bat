@echo off
REM ==================================================================
REM  Arranque automatico del Sistema de Calidad (Windows + Docker)
REM  Pensado para el Programador de tareas ("Al iniciar el sistema").
REM
REM  No hace falta editar nada: la carpeta del proyecto se detecta sola.
REM ==================================================================

REM (1) Carpeta del proyecto: se calcula desde la ubicacion de este .bat
REM     (scripts\windows\ -> sube dos niveles). Copiar la carpeta a CUALQUIER
REM     ruta funciona sin editar nada.
set "PROJECT_DIR=%~dp0..\.."

REM (2) Segundos a esperar para que Docker Desktop termine de arrancar
REM     antes de levantar los contenedores (subir si tu maquina es lenta)
set "WAIT_SECONDS=60"

REM (3) Ruta completa al ejecutable de ngrok.
REM     OJO: si lo instalaste con winget, NO esta en C:\ngrok. Para saber la ruta
REM     real: abrir PowerShell y correr  (Get-Command ngrok).Source
set "NGROK_PATH=%LOCALAPPDATA%\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe"

REM (4) Dominio ESTATICO de ngrok (reservado en tu cuenta de ngrok).
REM     Es el que va en la URL del webhook de Meta.
REM     CADA PC TIENE EL SUYO: si hay una PC por marca, cada una necesita su
REM     propio tunel (y su propia cuenta de ngrok, porque el plan gratis da un
REM     solo dominio por cuenta). Se toma de NGROK_DOMAIN del .env.prod si esta
REM     definido; si no, se usa este valor.
set "NGROK_DOMAIN=dealer-occupant-brigade.ngrok-free.dev"

REM (5) Puerto local del sistema (nginx). Debe coincidir con HTTP_PORT del .env
set "PORT=80"

REM ==================================================================
REM  A partir de aca no hace falta tocar nada.
REM ==================================================================

REM El .env.prod de ESTA PC manda sobre el dominio y el puerto de arriba: asi el
REM mismo .bat sirve en las dos maquinas sin editarlo.
cd /d "%PROJECT_DIR%"
if exist ".env.prod" (
  for /f "usebackq tokens=1,* delims==" %%A in (".env.prod") do (
    if /i "%%A"=="NGROK_DOMAIN" if not "%%B"=="" set "NGROK_DOMAIN=%%B"
    if /i "%%A"=="HTTP_PORT"    if not "%%B"=="" set "PORT=%%B"
  )
)

echo [%date% %time%] Esperando %WAIT_SECONDS%s a que Docker Desktop arranque...
timeout /t %WAIT_SECONDS% /nobreak >nul

echo [%date% %time%] Levantando los contenedores del sistema (stack de PRODUCCION)...
cd /d "%PROJECT_DIR%"
REM Stack de produccion: frontend compilado servido por nginx (sin dev server),
REM migraciones automaticas al arrancar. La PRIMERA vez correr a mano con --build
REM (ver PRODUCCION.md); en los arranques siguientes alcanza con up -d.
REM
REM SEGUNDA MARCA (Volkswagen): NO se agrega un --profile vw aca. Se prende con
REM COMPOSE_PROFILES=vw dentro de .env.prod, que docker compose lee solo. Asi
REM levanta igual desde este .bat, desde el vigilante y a mano, sin que haya que
REM acordarse de escribir el perfil en cada lugar (si falta en uno, despues de un
REM reinicio VW no vuelve y nadie se entera).
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d

echo [%date% %time%] Lanzando ngrok: https://%NGROK_DOMAIN%  ->  localhost:%PORT%
start "" "%NGROK_PATH%" http --domain=%NGROK_DOMAIN% %PORT%

echo [%date% %time%] Listo. El sistema queda accesible en https://%NGROK_DOMAIN%
echo (Esta ventana se puede cerrar; los contenedores y ngrok siguen corriendo.)
