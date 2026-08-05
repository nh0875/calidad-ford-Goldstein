# ============================================================================
# Respaldo-Calidad.ps1
# Copia de seguridad de la base del Sistema de Calidad a una ubicación FUERA de
# la PC (carpeta de red de la empresa), para no perder NADA si la PC falla.
# Pensado para correr solo todos los días (Programador de tareas de Windows).
# ============================================================================
$ErrorActionPreference = "Stop"

# ---------- AJUSTAR si hace falta ----------
# Carpeta donde está el sistema en la PC de Vanina (donde está docker-compose.yml):
$proyecto   = "C:\Sistema-Calidad"
# Copia FUERA de la PC (la carpeta de red que te dio Santiago). Si da error de
# permisos con la cuenta de Vanina, avisale a INDEN o usá OneDrive / un pendrive:
$destinoRed = "\\10.10.1.2\grupos\Sistemas\Juan Ignacio\Respaldos-Calidad"
# Cuántas copias diarias conservar (borra las más viejas):
$retencion  = 14
# -------------------------------------------

$localDir  = Join-Path $proyecto "Respaldos"
$fecha     = Get-Date -Format "yyyy-MM-dd_HHmm"
$nombre    = "calidad_$fecha.dump"
$localFile = Join-Path $localDir $nombre

Set-Location $proyecto
if (-not (Test-Path $localDir)) { New-Item -ItemType Directory -Force $localDir | Out-Null }

# 1) Dump de la base DENTRO del contenedor (binario -Fc) y lo sacamos con "cp".
#    (NO se usa el ">" de PowerShell: corrompe los archivos binarios.)
docker compose -f docker-compose.yml --env-file .env.prod exec -T postgres `
  sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" -f /tmp/cal.dump'
if ($LASTEXITCODE -ne 0) { throw "Falló el pg_dump (¿está prendido Docker y el sistema?)" }

docker compose -f docker-compose.yml --env-file .env.prod cp postgres:/tmp/cal.dump $localFile
docker compose -f docker-compose.yml --env-file .env.prod exec -T postgres rm -f /tmp/cal.dump

# 2) Copia FUERA de la PC + una copia del .env.prod (hace falta para restaurar:
#    tiene la clave que descifra el token de Meta guardado en la base).
try {
  if (-not (Test-Path $destinoRed)) { New-Item -ItemType Directory -Force $destinoRed | Out-Null }
  Copy-Item $localFile (Join-Path $destinoRed $nombre) -Force
  Copy-Item (Join-Path $proyecto ".env.prod") (Join-Path $destinoRed "_env.prod.copia") -Force
  Write-Host "OK: copia fuera de la PC -> $destinoRed\$nombre"
} catch {
  Write-Warning "No se pudo copiar a la carpeta de red: $($_.Exception.Message)"
  Write-Warning "La copia LOCAL sí quedó en: $localFile  (revisá permisos de la carpeta de red)"
}

# 3) Rotación: conservar solo las últimas N copias (local y en la red).
foreach ($dir in @($localDir, $destinoRed)) {
  if (Test-Path $dir) {
    Get-ChildItem $dir -Filter "calidad_*.dump" -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -Skip $retencion |
      Remove-Item -Force -ErrorAction SilentlyContinue
  }
}
Write-Host "Respaldo terminado: $nombre"
