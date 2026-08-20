# ============================================================================
#  Actualizar el Sistema de Calidad a la última versión
# ============================================================================
#  Trae los cambios, reconstruye y verifica QUE HAYAN QUEDADO PUESTOS.
#
#  Por qué existe: actualizar a mano son tres pasos y si se saltea el primero
#  (`git pull`) el rebuild funciona igual — reconstruye el código VIEJO. Todo se
#  ve bien, no hay ningún error, y el arreglo que se estaba esperando no está.
#  Pasó, y costó horas darse cuenta. Este script no deja que pase: compara el
#  commit que quedó corriendo contra el que se acaba de traer.
#
#  Uso, desde la carpeta del proyecto:
#      powershell -ExecutionPolicy Bypass -File scripts\windows\actualizar-sistema.ps1
# ============================================================================

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$ProjectDir = if ($PSScriptRoot) { Split-Path (Split-Path $PSScriptRoot -Parent) -Parent } else { (Get-Location).Path }
$ComposeFile = "docker-compose.prod.yml"
$EnvFile = ".env.prod"

Set-Location $ProjectDir
Write-Host ""
Write-Host "  Carpeta: $ProjectDir" -ForegroundColor Gray

if (-not (Test-Path $EnvFile)) {
    Write-Host "  No existe $EnvFile en esta carpeta. Nada que actualizar." -ForegroundColor Red
    exit 1
}

# --- Puerto y marca de ESTA PC, para poder verificar al final --------------
$Puerto = "80"
foreach ($linea in (Get-Content $EnvFile -ErrorAction SilentlyContinue)) {
    $t = "$linea".Trim()
    if ($t -eq "" -or $t.StartsWith("#")) { continue }
    $i = $t.IndexOf("=")
    if ($i -lt 1) { continue }
    if ($t.Substring(0, $i).Trim() -eq "HTTP_PORT") { $Puerto = $t.Substring($i + 1).Trim() }
}

# --- 1. Qué versión está corriendo AHORA ------------------------------------
function Version-Corriendo {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:$Puerto/api/health" -TimeoutSec 10 -UseBasicParsing
        $j = $r.Content | ConvertFrom-Json
        return @{ version = "$($j.version)"; marca = "$($j.marca)" }
    } catch {
        return @{ version = "(el sistema no responde)"; marca = "?" }
    }
}

$antes = Version-Corriendo
Write-Host ""
Write-Host "  Antes de actualizar" -ForegroundColor Cyan
Write-Host "    marca   : $($antes.marca)"
Write-Host "    version : $($antes.version)"

# --- 2. Traer los cambios ---------------------------------------------------
Write-Host ""
Write-Host "  Trayendo los cambios de GitHub..." -ForegroundColor Cyan

$sucio = (& git status --porcelain) | Where-Object { $_ -notmatch "^\?\?" }
if ($sucio) {
    Write-Host "    Hay cambios locales sin guardar en estos archivos:" -ForegroundColor Yellow
    $sucio | ForEach-Object { Write-Host "      $_" -ForegroundColor Yellow }
    Write-Host "    Se actualiza igual, pero si el pull falla es por esto." -ForegroundColor Yellow
}

& git pull --ff-only
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "  NO SE PUDO TRAER LA VERSION NUEVA. No se reconstruye nada: el sistema" -ForegroundColor Red
    Write-Host "  sigue funcionando con la version de antes, que es lo correcto." -ForegroundColor Red
    Write-Host "  Suele ser por cambios locales; resolverlos y volver a correr esto." -ForegroundColor Red
    exit 1
}

$commit = (& git rev-parse --short HEAD).Trim()
$titulo = (& git log -1 --pretty=%s).Trim()
Write-Host "    Ultima version: $commit  $titulo" -ForegroundColor Gray

if ($antes.version -eq $commit) {
    Write-Host ""
    Write-Host "  Ya estaba en la ultima version ($commit). No hay nada que hacer." -ForegroundColor Green
    exit 0
}

# --- 3. Reconstruir y levantar ----------------------------------------------
# El commit se mete DENTRO de la imagen para poder verificar al final.
$env:GIT_COMMIT = $commit

Write-Host ""
Write-Host "  Reconstruyendo (esto tarda varios minutos)..." -ForegroundColor Cyan
& docker compose -f $ComposeFile --env-file $EnvFile build
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Fallo la reconstruccion. El sistema sigue con la version anterior." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "  Levantando..." -ForegroundColor Cyan
& docker compose -f $ComposeFile --env-file $EnvFile up -d
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Fallo al levantar los contenedores." -ForegroundColor Red
    exit 1
}

# --- 4. Verificar QUE HAYA QUEDADO PUESTA -----------------------------------
Write-Host ""
Write-Host "  Esperando a que el sistema arranque (aplica las migraciones)..." -ForegroundColor Cyan

$despues = @{ version = "(el sistema no responde)"; marca = "?" }
$limite = (Get-Date).AddMinutes(5)
while ((Get-Date) -lt $limite) {
    Start-Sleep -Seconds 10
    $despues = Version-Corriendo
    if ($despues.version -eq $commit) { break }
}

Write-Host ""
if ($despues.version -eq $commit) {
    Write-Host "  LISTO. El sistema esta corriendo la version nueva." -ForegroundColor Green
    Write-Host "    marca   : $($despues.marca)"
    Write-Host "    version : $($despues.version)  ($titulo)"
} else {
    Write-Host "  ATENCION: se reconstruyo, pero el sistema NO esta reportando la" -ForegroundColor Red
    Write-Host "  version nueva." -ForegroundColor Red
    Write-Host "    se esperaba : $commit"
    Write-Host "    responde    : $($despues.version)"
    Write-Host ""
    Write-Host "  Puede ser que todavia este arrancando (mirar en un minuto), o que" -ForegroundColor Yellow
    Write-Host "  algo haya fallado. Para ver que paso:" -ForegroundColor Yellow
    Write-Host "    docker compose -f $ComposeFile --env-file $EnvFile logs --tail 50 backend" -ForegroundColor Gray
    exit 1
}
Write-Host ""
