# ============================================================================
#  Retirar esta PC: el sistema ya corre en el servidor
# ============================================================================
#  Se corre DESPUÉS de comprobar que el servidor anda (WhatsApp de prueba ida y
#  vuelta, usuarios entrando). Doble clic en Retirar-PC.bat, sin administrador.
#
#  Qué hace:
#    - Saca todo lo que levanta el sistema solo: tareas programadas, el acceso
#      directo de Inicio y la entrada del registro.
#    - Cierra ngrok (el .exe y el contenedor del túnel).
#    - Baja los contenedores del sistema.
#
#  Lo que NO hace, a propósito: borrar la base de esta PC. Queda en el disco de
#  Docker como respaldo por si hiciera falta volver. Conviene dejarla un mes.
#
#  La marca SISTEMA-EN-SERVIDOR.txt queda puesta: aunque alguien apriete un botón
#  viejo, esta PC no vuelve a levantar el sistema.
# ============================================================================

param([switch]$SinConfirmar)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$ProjectDir = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $ProjectDir
$Marcador = Join-Path $ProjectDir "SISTEMA-EN-SERVIDOR.txt"

function Bien($t) { Write-Host "  [OK]  $t" -ForegroundColor Green }
function Mal($t)  { Write-Host "  [!]   $t" -ForegroundColor Red }
function Info($t) { Write-Host "        $t" -ForegroundColor Gray }

Write-Host ""
Write-Host "  ================================================" -ForegroundColor Cyan
Write-Host "    RETIRAR ESTA PC" -ForegroundColor Cyan
Write-Host "  ================================================" -ForegroundColor Cyan

if (-not (Test-Path $Marcador)) {
    Write-Host ""
    Mal "Esta PC todavia no se migro (no existe SISTEMA-EN-SERVIDOR.txt)."
    Info "Primero Migrar-A-Servidor.bat, despues comprobar que el servidor ande, y recien ahi esto."
    exit 1
}

if (-not $SinConfirmar) {
    Write-Host ""
    Write-Host "  Hacelo SOLO si ya comprobaste que el servidor anda: un WhatsApp de prueba" -ForegroundColor Yellow
    Write-Host "  que sale, la respuesta que vuelve, y la gente entrando al sistema nuevo." -ForegroundColor Yellow
    $r = Read-Host "  Escribi RETIRAR para seguir"
    if ($r -ne "RETIRAR") { Write-Host "  Cancelado. No se toco nada."; exit 0 }
}

$pendientes = 0

# --- Tareas programadas -------------------------------------------------------
# Todos los nombres que se usaron en algún momento (Reparar-Arranque.ps1 usaba
# uno sin el "de").
$tareas = @(
    "Sistema de Calidad - Vigilante",
    "Sistema Calidad - Vigilante",
    "Sistema de Calidad - ngrok",
    "Sistema de Calidad - actualizacion automatica",
    "Respaldo Calidad M365"
)
foreach ($t in $tareas) {
    & schtasks /query /TN "$t" 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { continue }
    & schtasks /delete /TN "$t" /F 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { Bien "Tarea sacada: $t" }
    else { Mal "No pude sacar la tarea '$t' (la creo un administrador)."; $pendientes++ }
}

# --- Arranque sin tareas (carpeta de Inicio + registro) -----------------------
$acceso = Join-Path ([Environment]::GetFolderPath("Startup")) "Sistema de Calidad.lnk"
if (Test-Path $acceso) { Remove-Item $acceso -Force; Bien "Acceso directo de Inicio sacado." }
$claveRun = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
if (Get-ItemProperty $claveRun -Name "Sistema de Calidad" -ErrorAction SilentlyContinue) {
    Remove-ItemProperty $claveRun -Name "Sistema de Calidad" -Force -ErrorAction SilentlyContinue
    Bien "Entrada del registro sacada."
}

# --- ngrok ----------------------------------------------------------------------
$ng = @(Get-Process ngrok -ErrorAction SilentlyContinue)
if ($ng.Count -gt 0) { $ng | Stop-Process -Force -ErrorAction SilentlyContinue; Bien "ngrok cerrado." }
& docker rm -f calidad-tunel-ngrok 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { Bien "Contenedor del tunel sacado." }

# --- Contenedores del sistema ---------------------------------------------------
# Se busca el proyecto que ya está andando con este compose (cada PC tiene su
# nombre de carpeta). "down" SIN -v: saca los contenedores y deja la base.
$rutaCompose = (Resolve-Path (Join-Path $ProjectDir "docker-compose.prod.yml") -ErrorAction SilentlyContinue).Path
$proyecto = $null
try {
    $crudo = (& docker compose ls --format json --all) -join ""
    if ($crudo) {
        foreach ($p in ($crudo | ConvertFrom-Json)) {
            foreach ($cf in ("$($p.ConfigFiles)" -split ",")) { if ("$cf".Trim() -eq $rutaCompose) { $proyecto = "$($p.Name)" } }
        }
    }
} catch { }
$args2 = @()
if ($proyecto) { $args2 = @("-p", $proyecto) }
& docker compose @args2 -f docker-compose.prod.yml --env-file .env.prod down
if ($LASTEXITCODE -eq 0) { Bien "Contenedores del sistema bajados (la base queda guardada en Docker)." }
else { Mal "No pude bajar los contenedores. ¿Esta abierto Docker Desktop?"; $pendientes++ }

# --- Lo que no debería quedar en esta PC ----------------------------------------
$vars = @(Get-ChildItem (Join-Path $ProjectDir "Migracion") -Filter "variables-servidor-*.env" -ErrorAction SilentlyContinue)
if ($vars.Count -gt 0) {
    Mal "Sigue en esta PC el archivo con las claves: $($vars[0].FullName)"
    Info "Si ya se paso al servidor, borralo."
    $pendientes++
}

Write-Host ""
if ($pendientes -eq 0) {
    Write-Host "  LISTO. Esta PC ya no corre el sistema." -ForegroundColor Green
} else {
    Write-Host "  Quedaron $pendientes cosa(s) sin hacer (arriba, en rojo)." -ForegroundColor Yellow
    Write-Host "  Las tareas programadas igual ya no hacen nada: la marca SISTEMA-EN-SERVIDOR.txt las frena." -ForegroundColor Gray
    Write-Host "  Para sacarlas: Retirar-PC.bat con clic derecho -> Ejecutar como administrador." -ForegroundColor Gray
}
Write-Host ""
Info "La base de esta PC queda en Docker como respaldo. Pasado un mes sin problemas se puede borrar:"
Info "  docker compose -f docker-compose.prod.yml --env-file .env.prod down -v   (BORRA LA BASE)"
Write-Host ""
