# ============================================================================
# Respaldo-Calidad.ps1
# Copia de seguridad DIARIA de la base del Sistema de Calidad a una ubicación
# FUERA de la PC, para no perder NADA si el disco falla.
#
# Destino principal: una carpeta de SharePoint/OneDrive (M365) que el cliente de
# OneDrive sincroniza a la nube de la empresa. Con eso, si esta PC se rompe, la
# copia ya está arriba. (También soporta una carpeta de red por UNC, opcional.)
#
# Corre solo todos los días (lo registra Instalar-Respaldo-Diario.ps1) y también
# se puede correr a mano con Respaldo-AHORA.bat. Sin argumentos, lee la config
# que dejó el instalador en Respaldo-Config.json (misma carpeta).
#
# NUNCA usa el ">" de PowerShell para el dump (corrompe binarios): hace pg_dump
# DENTRO del contenedor y lo saca con "docker cp".
# ============================================================================
[CmdletBinding()]
param(
  [string]$DestinoNube,   # carpeta local que OneDrive sincroniza a SharePoint (M365)
  [string]$DestinoRed,    # carpeta de red UNC opcional (\\servidor\...)
  [string]$Proyecto,      # carpeta del sistema (donde está docker-compose)
  [string]$EnvFile,       # .env.prod (se copia para poder restaurar el token de Meta)
  [int]$Retencion = 0,    # cuántas copias diarias conservar
  [string]$Contenedor,    # nombre del contenedor de Postgres (si no, se detecta solo)
  [switch]$SinClave       # NO copiar el .env.prod a la nube (guardás la clave aparte)
)
$ErrorActionPreference = "Stop"

# ---------- Config guardada por el instalador (si existe) ----------
$cfgPath = Join-Path $PSScriptRoot "Respaldo-Config.json"
$cfg = $null
if (Test-Path $cfgPath) {
  try { $cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $cfg = $null }
}
if (-not $Proyecto)    { if ($cfg -and $cfg.proyecto)    { $Proyecto = $cfg.proyecto }    else { $Proyecto = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent } }
if (-not $DestinoNube) { if ($cfg -and $cfg.destinoNube) { $DestinoNube = $cfg.destinoNube } }
if (-not $DestinoRed)  { if ($cfg -and $cfg.destinoRed)  { $DestinoRed  = $cfg.destinoRed } }
if (-not $EnvFile)     { if ($cfg -and $cfg.envFile)     { $EnvFile = $cfg.envFile }       else { $EnvFile = Join-Path $Proyecto ".env.prod" } }
if (-not $Contenedor)  { if ($cfg -and $cfg.contenedor)  { $Contenedor = $cfg.contenedor } }
if ($Retencion -le 0)  { if ($cfg -and $cfg.retencion)   { $Retencion = [int]$cfg.retencion } else { $Retencion = 14 } }

# ---------- Log y estado ----------
$localDir = Join-Path $Proyecto "Respaldos"
if (-not (Test-Path $localDir)) { New-Item -ItemType Directory -Force $localDir | Out-Null }
$logFile    = Join-Path $localDir "respaldo.log"
$statusFile = Join-Path $localDir "ultimo-respaldo.json"

function Log($msg) {
  $linea = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Add-Content -Path $logFile -Value $linea -Encoding UTF8
  Write-Host $linea
}

$fecha     = Get-Date -Format "yyyy-MM-dd_HHmm"
$nombre    = "calidad_$fecha.dump"
$localFile = Join-Path $localDir $nombre
$destinosOk = @()

try {
  Log "=== Iniciando respaldo ==="

  # 1) Detectar el contenedor de Postgres si no vino por config/parámetro.
  if (-not $Contenedor) {
    $Contenedor = (& docker ps --filter "name=postgres" --format "{{.Names}}" | Select-Object -First 1)
  }
  if (-not $Contenedor) {
    throw "No encontré el contenedor de Postgres corriendo. ¿Está prendido Docker y el sistema? (probá 'docker ps')."
  }
  Log "Contenedor Postgres: $Contenedor"

  # 2) Dump binario (-Fc) DENTRO del contenedor y afuera con 'docker cp'.
  & docker exec $Contenedor sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" -f /tmp/cal.dump'
  if ($LASTEXITCODE -ne 0) { throw "Falló pg_dump dentro del contenedor (código $LASTEXITCODE)." }
  & docker cp "${Contenedor}:/tmp/cal.dump" $localFile
  if ($LASTEXITCODE -ne 0) { throw "Falló 'docker cp' del dump (código $LASTEXITCODE)." }
  & docker exec $Contenedor rm -f /tmp/cal.dump | Out-Null

  # 3) Verificación de integridad mínima: que exista y no esté vacío.
  if (-not (Test-Path $localFile)) { throw "El dump no se generó." }
  $bytes = (Get-Item $localFile).Length
  if ($bytes -lt 1024) { throw "El dump quedó vacío o demasiado chico ($bytes bytes): algo falló." }
  Log ("Dump local OK: {0} ({1:N0} bytes)" -f $nombre, $bytes)

  # 4) Copias offsite (nube M365 y/o red). Cada destino falla de forma aislada.
  $destinos = @()
  if ($DestinoNube) { $destinos += ,@("nube (M365/SharePoint)", $DestinoNube) }
  if ($DestinoRed)  { $destinos += ,@("red", $DestinoRed) }
  if ($destinos.Count -eq 0) {
    Log "AVISO: no hay destino offsite configurado. La copia quedó SOLO en esta PC ($localDir)."
    Log "AVISO: configurá el destino de nube con Instalar-Respaldo-Diario.ps1 para que sobreviva a una falla de disco."
  }
  foreach ($d in $destinos) {
    $etiqueta = $d[0]; $ruta = $d[1]
    try {
      if (-not (Test-Path $ruta)) { New-Item -ItemType Directory -Force $ruta | Out-Null }
      Copy-Item $localFile (Join-Path $ruta $nombre) -Force
      $destinosOk += $etiqueta
      Log "Copia offsite OK -> $etiqueta : $ruta"

      # Clave para restaurar: el .env.prod tiene CONFIG_ENCRYPTION_KEY, sin la
      # cual el token de Meta guardado en la base no se puede descifrar. Va a una
      # subcarpeta aparte que DEBE tener permisos restringidos (ver README).
      if (-not $SinClave -and (Test-Path $EnvFile)) {
        $restaurarDir = Join-Path $ruta "_RESTAURAR-NO-BORRAR"
        if (-not (Test-Path $restaurarDir)) { New-Item -ItemType Directory -Force $restaurarDir | Out-Null }
        Copy-Item $EnvFile (Join-Path $restaurarDir "env.prod.copia") -Force
      }

      # Rotación en el destino: conservar solo las últimas N copias.
      Get-ChildItem $ruta -Filter "calidad_*.dump" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -Skip $Retencion |
        Remove-Item -Force -ErrorAction SilentlyContinue
    } catch {
      Log "ERROR copiando a $etiqueta ($ruta): $($_.Exception.Message)"
    }
  }

  # 5) Rotación local.
  Get-ChildItem $localDir -Filter "calidad_*.dump" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -Skip $Retencion |
    Remove-Item -Force -ErrorAction SilentlyContinue

  # 6) Estado OK (lo puede leer un monitoreo o una alerta por mail).
  $estado = [ordered]@{
    fecha = (Get-Date -Format "s"); ok = $true; archivo = $nombre; bytes = $bytes
    destinosOffsite = $destinosOk; contenedor = $Contenedor; error = $null
  }
  $estado | ConvertTo-Json | Set-Content -Path $statusFile -Encoding UTF8
  if ($destinosOk.Count -gt 0) {
    Log "=== Respaldo terminado OK (offsite: $($destinosOk -join ', ')) ==="
  } else {
    Log "=== Respaldo terminado (SOLO LOCAL: sin copia fuera de la PC) ==="
  }
}
catch {
  $err = $_.Exception.Message
  $estado = [ordered]@{
    fecha = (Get-Date -Format "s"); ok = $false; archivo = $nombre; bytes = 0
    destinosOffsite = $destinosOk; error = $err
  }
  try { $estado | ConvertTo-Json | Set-Content -Path $statusFile -Encoding UTF8 } catch {}
  Log "ERROR: $err"
  throw
}
