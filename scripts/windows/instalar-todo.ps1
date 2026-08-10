<#
  instalar-todo.ps1 — Instalador TODO-EN-UNO del Sistema de Calidad.

  Hace, en orden:
    1) ngrok: lo instala (winget con los flags que evitan el error de "origen", o
       descarga directa si winget falla) y configura el token.
    2) Docker: verifica que esté corriendo (lo abre y espera si hace falta).
    3) .env.prod: confirma que esté.
    4) Construye y levanta el sistema (docker compose up -d --build).
    5) Restaura los datos si hay un .dump en la carpeta (con confirmación si la
       base ya tenía datos, para no pisar nada sin querer) y reinicia el backend.
    6) Deja todo automático (vigilante + anti-suspensión + arranque) llamando a
       configurar-pc.ps1.

  Se ejecuta desde INSTALAR-SISTEMA.bat (que pide permisos de administrador).
  Es IDEMPOTENTE: se puede volver a correr sin romper nada.

  ErrorActionPreference = Continue A PROPÓSITO: los comandos nativos (docker,
  winget, ngrok) escriben en stderr y en Windows PowerShell 5.1 con "Stop" eso
  puede cortar el script; se chequea el resultado con $LASTEXITCODE a mano.
#>
[CmdletBinding()]
param(
  [string]$NgrokToken,   # token de ngrok; si no se pasa y no hay uno cargado, se pide
  [switch]$SinRestore    # no restaurar datos aunque haya un .dump
)
$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

function Titulo($t) { Write-Host "`n===== $t =====" -ForegroundColor Cyan }
function Ok($t)     { Write-Host "  [OK]  $t" -ForegroundColor Green }
function Info($t)   { Write-Host "  $t" -ForegroundColor Gray }
function Aviso($t)  { Write-Host "  [!]   $t" -ForegroundColor Yellow }
function Fatal($t)  { Write-Host "  [ERROR] $t" -ForegroundColor Red; Read-Host "`nEnter para salir"; exit 1 }

# ---- ¿Administrador? ----
$id = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $id.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Fatal "Hay que correr esto COMO ADMINISTRADOR. Cerrá y usá INSTALAR-SISTEMA.bat (doble clic)."
}

# ---- Carpeta del proyecto (dos niveles arriba de scripts\windows) ----
$Proyecto    = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$ComposeFile = Join-Path $Proyecto "docker-compose.prod.yml"
$EnvFile     = Join-Path $Proyecto ".env.prod"
Set-Location $Proyecto
Write-Host "Instalador del Sistema de Calidad" -ForegroundColor White
Info "Proyecto: $Proyecto"

# =========================================================================
Titulo "1/6  ngrok (instalar + token)"

function Buscar-Ngrok {
  $c = Get-Command ngrok -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $wg = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe"
  if (Test-Path $wg) { return $wg }
  return $null
}

$ngrok = Buscar-Ngrok
if (-not $ngrok) {
  Info "Instalando ngrok con winget..."
  winget install --id Ngrok.Ngrok -e --source winget --accept-source-agreements --accept-package-agreements
  $ngrok = Buscar-Ngrok
}
if (-not $ngrok) {
  Aviso "winget no pudo. Descargando ngrok directo de ngrok.com..."
  try {
    $zip  = Join-Path $env:TEMP "ngrok.zip"
    $dest = "C:\ngrok"
    Invoke-WebRequest "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip" -OutFile $zip -UseBasicParsing
    New-Item -ItemType Directory -Force $dest | Out-Null
    Expand-Archive -Path $zip -DestinationPath $dest -Force
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    $rutaPc = [Environment]::GetEnvironmentVariable("Path", "Machine")
    if ($rutaPc -notlike "*$dest*") { [Environment]::SetEnvironmentVariable("Path", "$rutaPc;$dest", "Machine") }
    $env:Path = "$env:Path;$dest"
    $ngrok = Join-Path $dest "ngrok.exe"
  } catch {
    Fatal "No se pudo instalar ngrok automáticamente: $($_.Exception.Message). Instalalo a mano desde https://ngrok.com/download y volvé a correr."
  }
}
if (-not (Test-Path $ngrok)) { Fatal "ngrok no quedó instalado." }
Ok "ngrok: $ngrok"

# Token: 1) parámetro -NgrokToken  2) archivo ngrok-token.txt (al lado de este
# script, NO va a git)  3) el que ya tenga ngrok configurado  4) preguntarlo.
if (-not $NgrokToken) {
  $tokenFile = Join-Path $PSScriptRoot "ngrok-token.txt"
  if (Test-Path $tokenFile) {
    $NgrokToken = ((Get-Content $tokenFile -Raw -ErrorAction SilentlyContinue) -replace '\s', '')
    if ($NgrokToken) { Info "Token de ngrok tomado de ngrok-token.txt." }
  }
}
if (-not $NgrokToken) {
  $tieneToken = $false
  foreach ($cfg in @("$env:LOCALAPPDATA\ngrok\ngrok.yml", "$env:USERPROFILE\.config\ngrok\ngrok.yml", "$env:USERPROFILE\.ngrok2\ngrok.yml")) {
    if ((Test-Path $cfg) -and (Select-String -Path $cfg -Pattern "authtoken" -Quiet -ErrorAction SilentlyContinue)) { $tieneToken = $true }
  }
  if ($tieneToken) {
    Info "ngrok ya tiene un token configurado (se deja el actual)."
  } else {
    $NgrokToken = Read-Host "  Pegá tu TOKEN de ngrok (del dashboard) y Enter"
  }
}
if ($NgrokToken) {
  & $ngrok config add-authtoken ($NgrokToken.Trim())
  if ($LASTEXITCODE -eq 0) { Ok "Token de ngrok configurado." } else { Aviso "ngrok rechazó el token (revisá que sea el correcto)." }
}

# =========================================================================
Titulo "2/6  Docker"

function Docker-Vivo {
  cmd /c "docker info >nul 2>&1"
  return ($LASTEXITCODE -eq 0)
}

if (-not (Docker-Vivo)) {
  Aviso "Docker no responde. Intento abrir Docker Desktop y esperar (hasta 4 min)..."
  $exe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  if (Test-Path $exe) { Start-Process $exe }
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep 6
    if (Docker-Vivo) { break }
  }
}
if (-not (Docker-Vivo)) {
  Fatal "Docker no arrancó. Abrí Docker Desktop a mano, esperá la ballena verde ('Engine running') y volvé a correr el instalador."
}
Ok "Docker está corriendo."

# =========================================================================
Titulo "3/6  Configuración (.env.prod)"
if (-not (Test-Path $EnvFile)) {
  Fatal "Falta el archivo .env.prod en la carpeta del proyecto. Copialo del paquete y volvé a correr."
}
Ok ".env.prod encontrado."

# =========================================================================
Titulo "4/6  Construir y levantar el sistema (la 1ra vez tarda VARIOS MINUTOS)"
docker compose -f $ComposeFile --env-file $EnvFile up -d --build
if ($LASTEXITCODE -ne 0) { Fatal "Falló el build/arranque de los contenedores. Revisá el error de arriba." }
Ok "Contenedores levantados."

# =========================================================================
Titulo "5/6  Restaurar datos"

# Cuenta filas de tablas con datos REALES (no la tabla de usuarios, que en una
# instalación fresca ya trae el admin sembrado). El SQL va por STDIN a propósito:
# pasar el -c "SELECT ... \"Caso\" ..." como ARGUMENTO se parte en PowerShell 5.1
# y el conteo nunca corre. Por stdin no hay quoting que se rompa.
function Contar-Datos($contenedor) {
  $sql = 'SELECT COALESCE((SELECT count(*) FROM "Caso"),0) + COALESCE((SELECT count(*) FROM "WhatsappMessage"),0) + COALESCE((SELECT count(*) FROM "ClienteFidelizacion"),0);'
  $out = ($sql | docker exec -i $contenedor sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA 2>/dev/null')
  return ("" + $out).Trim()
}

$dump = Get-ChildItem -Path $Proyecto -Filter "*.dump" -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1

if ($SinRestore)    { Info "Restauración omitida (-SinRestore)." }
elseif (-not $dump) { Info "No hay ningún archivo .dump en la carpeta: la base queda como está (sin datos previos)." }
else {
  # Esperar a que el BACKEND esté sano: recién ahí existe el esquema (lo crea
  # 'prisma migrate deploy' al arrancar) y el conteo da un número confiable.
  $be = $null
  for ($i = 0; $i -lt 36; $i++) {
    $be = (docker ps --filter "name=backend" --format "{{.Names}}" | Select-Object -First 1)
    if ($be -and ((docker inspect -f "{{.State.Health.Status}}" $be 2>$null) -eq "healthy")) { break }
    Start-Sleep 5
  }
  $pg = (docker ps --filter "name=postgres" --format "{{.Names}}" | Select-Object -First 1)
  if (-not $pg) {
    Aviso "No encontré el contenedor de Postgres; salteo el restore. Podés hacerlo a mano después."
  } else {
    # ¿la base YA tiene datos? FAIL-CLOSED: solo se saltea la confirmación si el
    # conteo da EXACTAMENTE "0". Vacío, error o un número >0 → se PREGUNTA, para
    # nunca pisar datos productivos sin aviso (ej. re-corrida con otro .dump).
    $conteo = Contar-Datos $pg
    $hacer  = $true
    if ($conteo -ne "0") {
      $detalle = if ($conteo -match '^\d+$') { "La base YA tiene datos ($conteo registros)." }
                 else { "No pude verificar si la base tiene datos (por las dudas, confirmá)." }
      Aviso $detalle
      $resp = Read-Host "  ¿Restaurar '$($dump.Name)' y PISAR lo que haya en la base? Escribí SI (en MAYÚSCULAS) para confirmar"
      if ($resp -cne "SI") { $hacer = $false; Info "Restauración CANCELADA: se dejan los datos actuales." }
    }

    if ($hacer) {
      Info "Restaurando desde: $($dump.Name) ..."
      docker cp $dump.FullName "${pg}:/tmp/mig.dump"
      if ($LASTEXITCODE -ne 0) { Fatal "No se pudo copiar el dump al contenedor (docker cp falló)." }
      # pg_restore con --clean --if-exists devuelve !=0 hasta por warnings
      # inofensivos, así que NO nos guiamos por el código: verificamos DESPUÉS
      # que efectivamente entraron datos.
      docker exec $pg sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists /tmp/mig.dump' 2>&1 | Out-Null
      docker exec $pg rm -f /tmp/mig.dump 2>&1 | Out-Null

      # VERIFICACIÓN POSITIVA: si ahora hay datos, salió bien.
      $post = Contar-Datos $pg
      if ($post -match '^\d+$' -and [int]$post -gt 0) {
        Ok "Datos restaurados: $post registros en la base (los warnings 'already exists' son normales)."
        # Marca el dump como usado: una re-corrida del instalador NO lo re-restaura.
        try { Rename-Item $dump.FullName ($dump.Name + ".restaurado") -Force -ErrorAction SilentlyContinue } catch {}
        # Reiniciar el backend: pone el esquema al día tras restaurar un dump viejo.
        $beReinicio = (docker ps -a --filter "name=backend" --format "{{.Names}}" | Select-Object -First 1)
        if ($beReinicio) { docker restart $beReinicio | Out-Null; Info "Backend reiniciado (deja el esquema al día)." }
      } else {
        Aviso "El restore NO dejó datos en la base (conteo: '$post'). Revisá que el .dump sea válido o restauralo a mano."
      }
    }
  }
}

# =========================================================================
Titulo "6/6  Dejar todo automático (vigilante + anti-suspensión + arranque solo)"
$cfg = Join-Path $PSScriptRoot "configurar-pc.ps1"
if (Test-Path $cfg) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $cfg
} else {
  Aviso "No encontré configurar-pc.ps1; el vigilante no quedó registrado (el sistema igual está levantado)."
}

# =========================================================================
Write-Host "`n=========================================================" -ForegroundColor Cyan
Write-Host "  INSTALACIÓN TERMINADA — 2 pasos manuales que quedan:" -ForegroundColor White
Write-Host ""
Write-Host "  1) Abrí http://localhost  ->  tiene que aparecer el login." -ForegroundColor White
Write-Host ""
Write-Host "  2) Actualizá el WEBHOOK en Meta (porque cambió el dominio de ngrok):" -ForegroundColor White
Write-Host "       URL:          https://dealer-occupant-brigade.ngrok-free.dev/api/webhooks/whatsapp" -ForegroundColor Gray
Write-Host "       Verify token: calidad-ford-2026-xK9m" -ForegroundColor Gray
Write-Host "=========================================================" -ForegroundColor Cyan
Read-Host "`nEnter para cerrar"
