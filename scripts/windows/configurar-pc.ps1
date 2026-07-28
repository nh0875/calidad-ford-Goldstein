<#
  configurar-pc.ps1 — Deja la PC lista para que el Sistema de Calidad arranque
  y se REPARE SOLO, sin que la usuaria (Vanina) toque nada.

  Correr UNA vez, en PowerShell ABIERTO COMO ADMINISTRADOR, al migrar el sistema
  a una PC nueva. Es idempotente: se puede volver a correr para verificar o
  reparar la configuración.

  Reemplaza los pasos manuales sueltos (registrar tareas, auto-login, ngrok) por
  uno solo, para que la migración no quede a medias. Al final imprime un
  checklist con lo que quedó OK y lo que falta.

  Uso:
    Configurar todo:   powershell -ExecutionPolicy Bypass -File .\configurar-pc.ps1
    Solo verificar:    powershell -ExecutionPolicy Bypass -File .\configurar-pc.ps1 -SoloVerificar
#>

param([switch]$SoloVerificar)

$ErrorActionPreference = "Continue"

function Ok($m)   { Write-Host ("[ OK ]   " + $m) -ForegroundColor Green }
function Warn($m) { Write-Host ("[AVISO]  " + $m) -ForegroundColor Yellow }
function Bad($m)  { Write-Host ("[FALTA]  " + $m) -ForegroundColor Red }
function Info($m) { Write-Host ("         " + $m) -ForegroundColor Gray }
function Titulo($m){ Write-Host ""; Write-Host ("== " + $m + " ==") -ForegroundColor Cyan }

# Acumula el resultado de cada verificación para el checklist final.
$global:Problemas = @()
function Marcar($cond, $okMsg, $malMsg) {
  if ($cond) { Ok $okMsg } else { Bad $malMsg; $global:Problemas += $malMsg }
  return $cond
}

# ---------- 0) Contexto ----------
$esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
$ProyectoDir = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$Vigilante   = Join-Path $PSScriptRoot "vigilante.ps1"
$NombreTarea = "Sistema de Calidad - Vigilante"

Write-Host ""
Write-Host "Configuración desatendida — Sistema de Calidad" -ForegroundColor White
Info ("Proyecto: " + $ProyectoDir)
Info ("Modo: " + $(if ($SoloVerificar) { "SOLO VERIFICAR (no cambia nada)" } else { "CONFIGURAR" }))

if (-not $esAdmin -and -not $SoloVerificar) {
  Write-Host ""
  Bad "Necesito PowerShell abierto COMO ADMINISTRADOR para registrar las tareas."
  Info "Cerrá esta ventana. Clic derecho en 'Windows PowerShell' -> 'Ejecutar como administrador'."
  Info ("Después: cd `"" + $ProyectoDir + "`"  y volvé a correr este script.")
  exit 1
}

# ---------- 1) Prerrequisitos ----------
Titulo "1. Prerrequisitos (Docker y ngrok instalados)"

$DockerExe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
Marcar (Test-Path $DockerExe) "Docker Desktop está instalado." "Docker Desktop no está instalado (instalalo antes de seguir)." | Out-Null

# ngrok: la ruta configurada en el vigilante o el PATH.
$NgrokExe = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe"
if (-not (Test-Path $NgrokExe)) {
  $cmd = Get-Command ngrok -ErrorAction SilentlyContinue
  if ($cmd) { $NgrokExe = $cmd.Source }
}
$hayNgrok = Test-Path $NgrokExe
Marcar $hayNgrok "ngrok está instalado ($NgrokExe)." "ngrok no está instalado (winget install Ngrok.Ngrok)." | Out-Null

# Authtoken de ngrok: sin esto, el túnel no levanta y NO llegan los WhatsApp.
$ngrokConfigs = @(
  "$env:LOCALAPPDATA\ngrok\ngrok.yml",
  "$env:USERPROFILE\.config\ngrok\ngrok.yml",
  "$env:USERPROFILE\.ngrok2\ngrok.yml"
)
$tieneAuth = $false
foreach ($c in $ngrokConfigs) {
  if ((Test-Path $c) -and (Select-String -Path $c -Pattern "authtoken" -Quiet -ErrorAction SilentlyContinue)) { $tieneAuth = $true; break }
}
if (Marcar $tieneAuth "ngrok tiene un authtoken configurado." "ngrok NO tiene authtoken (sin esto NO llegan los mensajes de WhatsApp).") {
} else {
  Info "Configuralo con:  ngrok config add-authtoken [TU-AUTHTOKEN]   (está en el panel de ngrok)."
}

# ---------- 2) Arranque al iniciar sesión (modo seguro: SIN auto-login) ----------
# Docker Desktop necesita una sesión de Windows abierta. En el modo elegido NO se
# usa auto-login (más seguro: la PC pide la contraseña como siempre). El sistema
# levanta solo cuando la usuaria INICIA SESIÓN (el vigilante corre "al iniciar
# sesión"). Contra aceptada: tras un reinicio sin nadie, queda abajo hasta que
# alguien inicie sesión. Por eso acá NO se marca como falta.
Titulo "2. Arranque al iniciar sesión (modo seguro, sin auto-login)"

$winlogon = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
$autoOn = $false
try {
  $val = (Get-ItemProperty -Path $winlogon -Name AutoAdminLogon -ErrorAction SilentlyContinue).AutoAdminLogon
  $usr = (Get-ItemProperty -Path $winlogon -Name DefaultUserName -ErrorAction SilentlyContinue).DefaultUserName
  $autoOn = ($val -eq "1") -and $usr
} catch {}
if ($autoOn) {
  Warn "El auto-login de Windows está ACTIVADO en esta PC."
  Info "En el modo seguro elegido no hace falta. Si querés desactivarlo: Win+R -> netplwiz."
} else {
  Ok "Sin auto-login (modo seguro): la PC pide la contraseña de la usuaria."
}
Info "El sistema levanta solo cuando la usuaria INICIA SESIÓN. Tras un reinicio,"
Info "alguien tiene que iniciar sesión (con la contraseña) para que vuelva a arrancar."

# ---------- 3) Docker Desktop arranca al iniciar sesión ----------
Titulo "3. Docker Desktop arranca solo al iniciar sesión"
$runKey = "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
$dockerAutostart = $false
try {
  $p = (Get-ItemProperty -Path $runKey -ErrorAction SilentlyContinue)."Docker Desktop"
  $dockerAutostart = [bool]$p
} catch {}
if ($SoloVerificar) {
  Marcar $dockerAutostart "Docker Desktop está en el arranque de la sesión." "Docker Desktop no está en el arranque (el vigilante igual lo levanta)." | Out-Null
} else {
  if (-not $dockerAutostart -and (Test-Path $DockerExe)) {
    try {
      Set-ItemProperty -Path $runKey -Name "Docker Desktop" -Value ("`"" + $DockerExe + "`" -Autostart") -ErrorAction Stop
      Ok "Configuré Docker Desktop para arrancar al iniciar sesión."
    } catch { Warn ("No pude configurar el autostart de Docker: " + $_.Exception.Message + " (el vigilante igual lo levanta)."); }
  } else {
    Ok "Docker Desktop ya arranca al iniciar sesión (o el vigilante lo cubre)."
  }
}

# ---------- 4) Tarea del vigilante (repara Docker + ngrok cada 5 min) ----------
Titulo "4. Vigilante automático (cada 5 minutos, repara todo lo que se caiga)"

if (-not $SoloVerificar) {
  if (-not (Test-Path $Vigilante)) {
    Bad ("No encuentro el vigilante en " + $Vigilante)
    $global:Problemas += "Falta el archivo vigilante.ps1"
  } else {
    try {
      $accion = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument ("-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"" + $Vigilante + "`"")

      # Disparadores robustos: al iniciar sesión Y al arrancar el sistema, con
      # repetición cada 5 min indefinida. Sobrevive a reinicios.
      $tLogon = New-ScheduledTaskTrigger -AtLogOn
      $rep = (New-ScheduledTaskTrigger -Once -At (Get-Date) `
                -RepetitionInterval (New-TimeSpan -Minutes 5) `
                -RepetitionDuration (New-TimeSpan -Days 3650)).Repetition
      $tLogon.Repetition = $rep

      $opts = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

      # Corre como la usuaria actual (Docker necesita su sesión), con máximos privilegios.
      $usuarioActual = "$env:USERDOMAIN\$env:USERNAME"
      Register-ScheduledTask -TaskName $NombreTarea -Action $accion -Trigger $tLogon `
        -Settings $opts -RunLevel Highest -User $usuarioActual -Force -ErrorAction Stop | Out-Null
      Ok "Vigilante registrado (al iniciar sesión + cada 5 minutos, con privilegios máximos)."
    } catch {
      Warn ("No pude registrar con Register-ScheduledTask (" + $_.Exception.Message + "). Reintento con schtasks...")
      $tr = "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"" + $Vigilante + "`""
      schtasks /Create /TN $NombreTarea /TR $tr /SC MINUTE /MO 5 /RL HIGHEST /F | Out-Null
      if ($LASTEXITCODE -eq 0) { Ok "Vigilante registrado con schtasks (cada 5 minutos)." }
      else { Bad "No se pudo registrar el vigilante."; $global:Problemas += "No se pudo registrar la tarea del vigilante." }
    }
  }
}

$tarea = Get-ScheduledTask -TaskName $NombreTarea -ErrorAction SilentlyContinue
Marcar ([bool]$tarea) "La tarea del vigilante existe y está registrada." "La tarea del vigilante NO está registrada." | Out-Null

# ---------- 5) Corrida inicial: levantar todo ahora ----------
if (-not $SoloVerificar -and (Test-Path $Vigilante)) {
  Titulo "5. Arranque inicial (levantando Docker, contenedores y ngrok)"
  Info "Esto puede tardar 1-2 minutos la primera vez..."
  try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Vigilante | Out-Null
    Ok "El vigilante corrió una vez. Revisá el detalle en scripts\windows\vigilante.log"
  } catch { Warn ("La corrida inicial devolvió un error: " + $_.Exception.Message) }
}

# ---------- 6) Verificación en vivo ----------
Titulo "6. Verificación en vivo"

# ngrok respondiendo local
$ngrokVivo = $false
try {
  $r = Invoke-WebRequest "http://localhost:4040/api/tunnels" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
  $ngrokVivo = ($r.Content -match "ngrok-free")
} catch {}
Marcar $ngrokVivo "ngrok está corriendo (túnel activo)." "ngrok no está corriendo todavía (el vigilante lo levanta en la próxima corrida)." | Out-Null

# La app responde localmente
$appViva = $false
try {
  $r = Invoke-WebRequest "http://localhost/api/health" -UseBasicParsing -TimeoutSec 8 -ErrorAction Stop
  $appViva = ($r.StatusCode -eq 200)
} catch {}
Marcar $appViva "La app responde en http://localhost/api/health" "La app no responde todavía (esperá 1-2 min a que Docker termine de arrancar)." | Out-Null

# ---------- Checklist final ----------
Write-Host ""
Write-Host "==================================================" -ForegroundColor White
if ($global:Problemas.Count -eq 0) {
  Write-Host " TODO CUBIERTO. El sistema arranca y se repara solo." -ForegroundColor Green
  Write-Host " La usuaria no tiene que tocar nada." -ForegroundColor Green
} else {
  Write-Host " FALTAN COSAS por resolver antes de dejarla sola:" -ForegroundColor Yellow
  foreach ($p in $global:Problemas) { Write-Host ("   - " + $p) -ForegroundColor Yellow }
  Write-Host ""
  Write-Host " Resolvé lo de arriba y volvé a correr:  .\configurar-pc.ps1 -SoloVerificar" -ForegroundColor Yellow
}
Write-Host "==================================================" -ForegroundColor White
Write-Host ""
Info "Monitoreo continuo: scripts\windows\vigilante.log (qué reparó y cuándo)."
