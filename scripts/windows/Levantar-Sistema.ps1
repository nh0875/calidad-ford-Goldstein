# ============================================================================
#  Levantar el Sistema de Calidad — el botón del escritorio
# ============================================================================
#  Esto lo aprieta la persona que usa la PC, no un técnico. Por eso:
#
#    - Muestra una ventana y va contando qué está haciendo. Un botón que no
#      muestra nada deja a la persona sin saber si funcionó, y termina
#      apretándolo cinco veces.
#    - No pide decidir nada ni escribir nada.
#    - Cuando el sistema está listo, le abre el navegador solo.
#    - Si algo falla, dice qué hacer en una línea, sin jerga.
#
#  Hace lo mismo que el arranque automático: llama al vigilante (que levanta
#  Docker, los contenedores y el túnel) y después deja el bucle corriendo para
#  que el sistema se repare solo el resto del día.
# ============================================================================

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$scriptDir  = $PSScriptRoot
$Vigilante  = Join-Path $scriptDir "vigilante.ps1"
$Bucle      = Join-Path $scriptDir "vigilante-bucle.ps1"
$ProjectDir = Split-Path (Split-Path $scriptDir -Parent) -Parent
$EnvFile    = Join-Path $ProjectDir ".env.prod"

function Leer([string]$clave, [string]$porDefecto = "") {
    if (-not (Test-Path $EnvFile)) { return $porDefecto }
    foreach ($linea in (Get-Content $EnvFile -ErrorAction SilentlyContinue)) {
        $l = "$linea".Trim()
        if ($l -eq "" -or $l.StartsWith("#")) { continue }
        $i = $l.IndexOf("=")
        if ($i -lt 1) { continue }
        if ($l.Substring(0, $i).Trim() -eq $clave) {
            $v = $l.Substring($i + 1).Trim()
            if ($v -ne "") { return $v }
        }
    }
    return $porDefecto
}

$puerto   = Leer "HTTP_PORT" "80"
$urlLocal = if ($puerto -eq "80") { "http://localhost" } else { "http://localhost:$puerto" }

# Las consultas a esta misma PC NO pasan por el proxy: en una red de empresa el
# proxy intercepta hasta lo local y da "no responde" con el sistema andando.
function Responde {
    try {
        $req = [System.Net.HttpWebRequest]::Create("$urlLocal/api/health")
        $req.Timeout = 8000
        $req.Proxy = $null
        $resp = $req.GetResponse()
        $lector = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $texto = $lector.ReadToEnd(); $lector.Close(); $resp.Close()
        return (($texto | ConvertFrom-Json).status -eq "ok")
    } catch { return $false }
}

Clear-Host
Write-Host ""
Write-Host "   ============================================" -ForegroundColor Cyan
Write-Host "      SISTEMA DE CALIDAD" -ForegroundColor Cyan
Write-Host "   ============================================" -ForegroundColor Cyan
Write-Host ""

# ---------- Si ya estaba andando, no hay nada que hacer ----------
if (Responde) {
    Write-Host "   El sistema YA estaba andando." -ForegroundColor Green
    Write-Host ""
    Write-Host "   Abriendo..." -ForegroundColor Gray
    Start-Process $urlLocal
    Start-Sleep -Seconds 3
    exit 0
}

Write-Host "   Levantando el sistema. Tarda 1 o 2 minutos." -ForegroundColor White
Write-Host "   NO cierres esta ventana; se cierra sola cuando termina." -ForegroundColor Gray
Write-Host ""

# ---------- El vigilante hace el trabajo pesado ----------
# Levanta Docker si esta apagado, los contenedores si estan caidos, y ngrok si
# no esta corriendo. Se lo llama una vez, a mano.
if (Test-Path $Vigilante) {
    Write-Host "   Preparando Docker y el sistema..." -ForegroundColor Gray
    & powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden `
        -ExecutionPolicy Bypass -File $Vigilante 2>&1 | Out-Null
} else {
    Write-Host "   [!] Falta vigilante.ps1: no puedo levantarlo." -ForegroundColor Red
    Write-Host ""
    Read-Host "   Enter para cerrar"; exit 1
}

# ---------- Esperar a que conteste ----------
Write-Host ""
$listo = $false
foreach ($i in 1..48) {          # hasta 4 minutos
    if (Responde) { $listo = $true; break }
    if ($i % 4 -eq 0) { Write-Host "   Todavia arrancando... ($([int]($i * 5 / 60)) min)" -ForegroundColor Gray }
    Start-Sleep -Seconds 5
}

# ---------- Dejar el vigilante andando el resto del dia ----------
# Si no hay ninguno corriendo, se arranca. Asi el sistema se repara solo despues,
# sin que nadie tenga que volver a apretar el boton.
$yaHay = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
         Where-Object { $_.CommandLine -like "*vigilante-bucle*" }
if (-not $yaHay -and (Test-Path $Bucle)) {
    Start-Process powershell -ArgumentList `
        "-NoProfile","-NonInteractive","-WindowStyle","Hidden","-ExecutionPolicy","Bypass","-File",$Bucle `
        -WindowStyle Hidden -ErrorAction SilentlyContinue
}

Write-Host ""
if ($listo) {
    Write-Host "   ============================================" -ForegroundColor Green
    Write-Host "      LISTO. El sistema esta andando." -ForegroundColor Green
    Write-Host "   ============================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "   Abriendo el sistema..." -ForegroundColor Gray
    Start-Process $urlLocal
    Start-Sleep -Seconds 4
} else {
    Write-Host "   ============================================" -ForegroundColor Red
    Write-Host "      NO PUDO LEVANTAR" -ForegroundColor Red
    Write-Host "   ============================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "   Proba una vez mas: cerra esta ventana y volve a" -ForegroundColor White
    Write-Host "   apretar el boton." -ForegroundColor White
    Write-Host ""
    Write-Host "   Si sigue sin andar, avisale a Ignacio y decile que" -ForegroundColor White
    Write-Host "   mire este archivo:" -ForegroundColor White
    Write-Host "   $scriptDir\vigilante.log" -ForegroundColor Gray
    Write-Host ""
    Read-Host "   Enter para cerrar"
}
