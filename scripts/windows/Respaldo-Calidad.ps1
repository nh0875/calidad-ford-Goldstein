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
$destinosOk = @()
$archivosHechos = @()   # un dump por base

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

  # 2) TODAS las bases del contenedor, no solo una.
  #
  # Antes se dumpeaba la base de la variable POSTGRES_DB del contenedor, que es
  # una sola. Con dos marcas conviviendo en el mismo Postgres (calidad_ford y
  # calidad_vw), eso respaldaba Ford y dejaba Volkswagen afuera SIN AVISAR: el
  # respaldo seguía diciendo "ok" todas las noches. Ahora se pregunta la lista y
  # se dumpea cada una, así una marca nueva queda cubierta sola.
  # Se usa "psql -lqtA" (listar bases, sin encabezados, separado por "|") y NO una
  # consulta SQL: PowerShell rompe los argumentos que llevan espacios dentro de
  # comillas al pasárselos a docker.exe, y un "SELECT ... FROM ..." llegaba partido
  # al contenedor. Sin SQL no hay nada que romper.
  $listado = & docker exec $Contenedor sh -c 'psql -U "$POSTGRES_USER" -lqtA'
  if ($LASTEXITCODE -ne 0) { throw "No pude listar las bases del contenedor (código $LASTEXITCODE)." }
  # Solo las líneas que TIENEN "|" son una base: las plantillas imprimen una
  # segunda línea con sus permisos (ej. "calidad=CTc/calidad") que, sin este
  # filtro, se tomaría como el nombre de una base inexistente.
  $bases = @(
    $listado |
      Where-Object { $_ -match '\|' } |
      ForEach-Object { ($_ -split '\|')[0].Trim() } |
      Where-Object { $_ -and $_ -ne "postgres" -and $_ -notlike "template*" }
  )
  if ($bases.Count -eq 0) { throw "El contenedor no tiene ninguna base de datos para respaldar." }
  Log ("Bases a respaldar: {0}" -f ($bases -join ", "))

  foreach ($base in $bases) {
    $nombreBase = "${base}_$fecha.dump"
    $archivoBase = Join-Path $localDir $nombreBase

    # El nombre de la base viaja como variable de entorno del contenedor: así no
    # hay que pelear con el escapado de comillas entre PowerShell y sh.
    & docker exec -e BASE_A_RESPALDAR=$base $Contenedor sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$BASE_A_RESPALDAR" -f /tmp/cal.dump'
    if ($LASTEXITCODE -ne 0) { throw "Falló pg_dump de '$base' (código $LASTEXITCODE)." }
    & docker cp "${Contenedor}:/tmp/cal.dump" $archivoBase
    if ($LASTEXITCODE -ne 0) { throw "Falló 'docker cp' del dump de '$base' (código $LASTEXITCODE)." }
    & docker exec $Contenedor rm -f /tmp/cal.dump | Out-Null

    # 3) Verificación mínima por base: que exista y no esté vacío.
    if (-not (Test-Path $archivoBase)) { throw "El dump de '$base' no se generó." }
    $bytesBase = (Get-Item $archivoBase).Length
    if ($bytesBase -lt 1024) { throw "El dump de '$base' quedó vacío o demasiado chico ($bytesBase bytes)." }
    Log ("Dump local OK: {0} ({1:N0} bytes)" -f $nombreBase, $bytesBase)
    # PSCustomObject y no una tabla hash: en PowerShell 5.1 Measure-Object no ve
    # las claves de un hashtable como propiedades y la suma de bytes falla.
    $archivosHechos += [PSCustomObject]@{
      base = $base; nombre = $nombreBase; ruta = $archivoBase; bytes = $bytesBase
    }
  }

  $bytes = ($archivosHechos | Measure-Object -Property bytes -Sum).Sum
  $nombre = ($archivosHechos | ForEach-Object { $_.nombre }) -join ", "

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
      foreach ($a in $archivosHechos) {
        Copy-Item $a.ruta (Join-Path $ruta $a.nombre) -Force
      }
      $destinosOk += $etiqueta
      Log ("Copia offsite OK -> {0} : {1} ({2} archivo/s)" -f $etiqueta, $ruta, $archivosHechos.Count)

      # Clave para restaurar: el .env.prod tiene CONFIG_ENCRYPTION_KEY, sin la
      # cual el token de Meta guardado en la base no se puede descifrar. Va a una
      # subcarpeta aparte que DEBE tener permisos restringidos (ver README).
      if (-not $SinClave -and (Test-Path $EnvFile)) {
        $restaurarDir = Join-Path $ruta "_RESTAURAR-NO-BORRAR"
        if (-not (Test-Path $restaurarDir)) { New-Item -ItemType Directory -Force $restaurarDir | Out-Null }
        Copy-Item $EnvFile (Join-Path $restaurarDir "env.prod.copia") -Force
      }

      # Rotación en el destino: N copias POR BASE, no N en total. Si se contaran
      # todas juntas, con dos marcas cada una conservaría la mitad de los días.
      foreach ($base in $bases) {
        Get-ChildItem $ruta -Filter "$base`_*.dump" -ErrorAction SilentlyContinue |
          Sort-Object LastWriteTime -Descending | Select-Object -Skip $Retencion |
          Remove-Item -Force -ErrorAction SilentlyContinue
      }
    } catch {
      Log "ERROR copiando a $etiqueta ($ruta): $($_.Exception.Message)"
    }
  }

  # 5) Rotación local, también por base.
  foreach ($base in $bases) {
    Get-ChildItem $localDir -Filter "$base`_*.dump" -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -Skip $Retencion |
      Remove-Item -Force -ErrorAction SilentlyContinue
  }
  # Dumps con el nombre VIEJO (calidad_<fecha>.dump, de una sola base): ya no se
  # generan, pero los que quedaron de antes hay que seguir rotándolos o se
  # acumulan para siempre.
  Get-ChildItem $localDir -Filter "calidad_20*.dump" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -Skip $Retencion |
    Remove-Item -Force -ErrorAction SilentlyContinue

  # 6) Estado OK (lo puede leer un monitoreo o una alerta por mail).
  $estado = [ordered]@{
    fecha = (Get-Date -Format "s"); ok = $true; archivo = $nombre; bytes = $bytes
    # Qué bases se respaldaron y cuánto pesó cada una. Sirve para darse cuenta de
    # que falta una: si un día aparece solo calidad_ford, algo pasó con la otra.
    bases = @($archivosHechos | ForEach-Object { [PSCustomObject]@{ base = $_.base; archivo = $_.nombre; bytes = $_.bytes } })
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
