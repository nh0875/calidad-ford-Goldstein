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
#  COMO SE CORRE: doble clic en "Actualizar-AHORA.bat", que esta al lado.
#
#  Tambien se puede desde PowerShell, pero con la RUTA COMPLETA del archivo.
#  Con la ruta relativa solo anda si la consola YA esta parada en la carpeta
#  del proyecto; abierta en system32 (lo normal al abrir PowerShell) da
#  "el argumento ... no existe". El script en si funciona desde cualquier lado:
#  se ubica solo a partir de donde esta guardado.
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

# --- Traer, resolviendo solo los dos bloqueos tipicos ------------------------
#
# 1) ARCHIVOS COPIADOS A MANO. Pasa cuando alguien recibe un script por WhatsApp
#    o por mail y lo pega en la carpeta: git no lo puede reemplazar porque no lo
#    tiene registrado, y aborta TODA la actualizacion por un archivo que
#    justamente venia a traer. Se corren a un costado (NO se borran) y sigue.
#
# 2) ARCHIVOS DEL SISTEMA EDITADOS EN ESTA PC. Ahi NO se decide solo: se muestra
#    que cambio y se corta, porque puede ser algo que alguien puso a proposito y
#    pisarlo en silencio seria peor que no actualizar.

function Intentar-Pull {
    $salida = & git pull --ff-only 2>&1
    $codigo = $LASTEXITCODE
    $salida | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
    return @{ ok = ($codigo -eq 0); texto = ($salida -join "`n") }
}

$r = Intentar-Pull

if (-not $r.ok -and $r.texto -match "untracked working tree files would be overwritten") {
    $sello = Get-Date -Format "yyyyMMdd-HHmmss"
    $backup = Join-Path $ProjectDir ("_reemplazados-" + $sello)

    $aMover = @()
    $capturando = $false
    foreach ($linea in ($r.texto -split "`n")) {
        if ($linea -match "untracked working tree files would be overwritten") { $capturando = $true; continue }
        if ($capturando) {
            $limpio = "$linea".Trim()
            if ($limpio -eq "" -or $limpio -like "Please *" -or $limpio -like "Aborting*" -or $limpio -like "error:*") { $capturando = $false; continue }
            $aMover += $limpio
        }
    }

    if ($aMover.Count -gt 0) {
        Write-Host ""
        Write-Host "  Hay archivos copiados a mano que el sistema trae por su cuenta." -ForegroundColor Yellow
        Write-Host "  Se guarda una copia en $backup y se sigue:" -ForegroundColor Yellow
        foreach ($rel in $aMover) {
            $origen = Join-Path $ProjectDir $rel
            if (-not (Test-Path $origen)) { continue }
            $destino = Join-Path $backup $rel
            $carpeta = Split-Path $destino -Parent
            if (-not (Test-Path $carpeta)) { New-Item -ItemType Directory -Path $carpeta -Force | Out-Null }
            Move-Item -Path $origen -Destination $destino -Force
            Write-Host "      $rel" -ForegroundColor Gray
        }
        Write-Host ""
        Write-Host "  Reintentando..." -ForegroundColor Cyan
        $r = Intentar-Pull
    }
}

if (-not $r.ok) {
    Write-Host ""
    Write-Host "  NO SE PUDO TRAER LA VERSION NUEVA. No se reconstruye nada: el sistema" -ForegroundColor Red
    Write-Host "  sigue funcionando con la version de antes, que es lo correcto." -ForegroundColor Red

    if ($r.texto -match "Your local changes to the following files would be overwritten") {
        Write-Host ""
        Write-Host "  Es porque estos archivos del sistema fueron editados en esta PC:" -ForegroundColor Yellow
        (& git diff --name-only) | ForEach-Object { Write-Host "      $_" -ForegroundColor Yellow }
        Write-Host ""
        Write-Host "  Que cambio en cada uno:" -ForegroundColor Yellow
        & git diff --stat | ForEach-Object { Write-Host "      $_" -ForegroundColor Gray }
        Write-Host ""
        Write-Host "  Si esos cambios NO hacen falta (lo normal: son archivos del sistema," -ForegroundColor Yellow
        Write-Host "  no configuracion tuya), se descartan asi y se vuelve a correr esto:" -ForegroundColor Yellow
        Write-Host "      git checkout -- ." -ForegroundColor Gray
        Write-Host ""
        Write-Host "  Si SI hacen falta, mandale esta pantalla a Ignacio antes de tocar nada." -ForegroundColor Yellow
    }
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
