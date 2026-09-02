# ============================================================================
#  Reparar el arranque automático
# ============================================================================
#  Registra las dos tareas programadas (vigilante y ngrok) sin pasar por WMI.
#
#  PARA QUÉ SIRVE: en algunas PCs los cmdlets New-ScheduledTaskAction /
#  -Trigger / -SettingsSet fallan con "No se puede conectar al servidor CIM",
#  aunque el servicio Programador de tareas esté corriendo perfecto. Es la capa
#  WMI la que está rota, no el Programador. Pasó en la PC de Volkswagen.
#
#  schtasks.exe habla con el Programador por RPC, sin tocar WMI, así que funciona
#  igual. Este script hace SOLO esa parte: sirve cuando la instalación anduvo
#  bien pero quedó sin el arranque automático.
#
#  Se corre COMO ADMINISTRADOR (registrar tareas lo exige).
# ============================================================================

param(
    # Cuenta que va a CORRER las tareas: la que usa la PC todos los dias.
    # Si se omite, se usa la cuenta desde la que se corre el script.
    #
    # Existe porque en la empresa instala un administrador con SU cuenta, pero
    # quien usa la PC es otra persona que no puede ser administrador por politica
    # del dominio. Ejemplo:
    #     .\Reparar-Arranque-Automatico.ps1 -Usuario MARIOGOLDSTEIN\ldip
    [string]$Usuario = ""
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$ProjectDir = if ($PSScriptRoot) { Split-Path (Split-Path $PSScriptRoot -Parent) -Parent } else { (Get-Location).Path }
$EnvFile   = Join-Path $ProjectDir ".env.prod"
$Vigilante = Join-Path $PSScriptRoot "vigilante.ps1"

function Bien($t) { Write-Host "  [OK]  $t" -ForegroundColor Green }
function Mal($t)  { Write-Host "  [!]   $t" -ForegroundColor Red }
function Info($t) { Write-Host "        $t" -ForegroundColor Gray }

function EsAdmin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

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

# Misma función que usa instalar-todo.ps1. Ver ahí el porqué del XML y del UTF-16.
function Registrar-Tarea {
  param(
    [string]$Nombre, [string]$Comando, [string]$Argumentos,
    [string]$Usuario, [string]$Descripcion, [string]$LimiteTiempo = "PT30M"
  )
  $argEsc = [System.Security.SecurityElement]::Escape($Argumentos)
  $desEsc = [System.Security.SecurityElement]::Escape($Descripcion)
  $xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>$desEsc</Description></RegistrationInfo>
  <Principals>
    <Principal id="Author">
      <UserId>$Usuario</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <ExecutionTimeLimit>$LimiteTiempo</ExecutionTimeLimit>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
  </Settings>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$Usuario</UserId>
      <Repetition>
        <Interval>PT5M</Interval>
        <Duration>P3650D</Duration>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </LogonTrigger>
  </Triggers>
  <Actions Context="Author">
    <Exec>
      <Command>$Comando</Command>
      <Arguments>$argEsc</Arguments>
    </Exec>
  </Actions>
</Task>
"@
  $tmp = Join-Path $env:TEMP ("calidad-tarea-" + ($Nombre -replace '[^A-Za-z0-9]', '') + ".xml")
  $xml | Out-File $tmp -Encoding unicode   # UTF-16: con utf8 schtasks lo rechaza
  # /RU + /IT: registra la tarea A NOMBRE DE OTRO USUARIO sin pedir su contrasena.
  #
  # Hace falta porque en la empresa el que instala es un administrador (una cuenta
  # distinta de la que usa la PC todos los dias), y las politicas del dominio no
  # dejan hacer administrador al usuario comun. Sin /RU la tarea queda a nombre
  # del que instalo, que no es quien va a tener la sesion abierta: el vigilante
  # nunca correria, y encima no llegaria a Docker.
  #
  # /IT (interactive only) es lo que evita tener que pedir la contrasena: la
  # tarea SOLO corre cuando ese usuario tiene sesion iniciada. Que es justo lo
  # que se quiere, porque fuera de su sesion no llegaria a Docker igual.
  $salida = schtasks /create /TN "$Nombre" /XML "$tmp" /RU "$Usuario" /IT /F 2>&1
  $codigo = $LASTEXITCODE
  if ($codigo -ne 0) {
    # Reintento sin /RU, por si en esta PC el que instala ES el usuario de todos
    # los dias: ahi /RU sobra y alguna politica puede rechazarlo.
    $salida2 = schtasks /create /TN "$Nombre" /XML "$tmp" /F 2>&1
    if ($LASTEXITCODE -eq 0) { $codigo = 0; $salida = $salida2 }
    else { $salida = (($salida | Out-String) + "`n" + ($salida2 | Out-String)) }
  }
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  if ($codigo -ne 0) { return @{ ok = $false; detalle = ($salida | Out-String).Trim() } }
  return @{ ok = $true; detalle = "" }
}

Write-Host ""
Write-Host "  Reparando el arranque automatico..." -ForegroundColor Cyan
Write-Host ""

if (-not (EsAdmin)) {
  Mal "Hay que abrir PowerShell COMO ADMINISTRADOR."
  Info "(clic derecho en PowerShell -> Ejecutar como administrador)"
  Read-Host "`nEnter para cerrar"; exit 1
}

# La cuenta que va a correr las tareas. Tiene que ser la que USA la PC todos los
# días, no la que eleva: el vigilante corre en SU sesión, que es la única que
# llega a Docker.
$usuarioDestino = if ($Usuario) { $Usuario } else { "$env:USERDOMAIN\$env:USERNAME" }
Write-Host "  Las tareas van a correr como: $usuarioDestino" -ForegroundColor White
if (-not $Usuario) {
  Write-Host "  Si esa NO es la cuenta que usa la PC todos los dias, corre en su lugar:" -ForegroundColor Gray
  Write-Host "     .\Reparar-Arranque-Automatico.ps1 -Usuario DOMINIO\usuario" -ForegroundColor Gray
}
Write-Host ""

$errores = 0

# ---------- Vigilante ----------
if (Test-Path $Vigilante) {
  $argVig = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $Vigilante + '"'
  $r = Registrar-Tarea -Nombre "Sistema de Calidad - Vigilante" -Comando "powershell.exe" `
    -Argumentos $argVig -Usuario $usuarioDestino -LimiteTiempo "PT30M" `
    -Descripcion "Vigilante del Sistema de Calidad: levanta y repara el stack cada 5 minutos."
  if ($r.ok) { Bien "Vigilante registrado (arranca y repara solo)."; schtasks /run /TN "Sistema de Calidad - Vigilante" 2>&1 | Out-Null }
  else { Mal "No pude registrar el vigilante: $($r.detalle)"; $errores++ }
} else {
  Mal "No encuentro vigilante.ps1 en $PSScriptRoot"; $errores++
}

# ---------- ngrok ----------
# Se busca ngrok tambien en el perfil del usuario DESTINO: winget instala POR
# USUARIO, asi que si lo instalo el, el administrador no lo ve en el suyo. Eso
# ya paso una vez y el script dijo "no encuentro ngrok" estando instalado.
$ngrok = (Get-Command ngrok -ErrorAction SilentlyContinue).Source
if (-not $ngrok) {
  $sufijo = "AppData\Local\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe"
  $cuenta = ($usuarioDestino -split "\\")[-1]
  foreach ($c in @("$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe",
                   "C:\Users\$cuenta\$sufijo")) {
    if (Test-Path $c) { $ngrok = $c; break }
  }
}
if (-not $ngrok) {
  $hallado = Get-ChildItem "C:\Users" -Filter "ngrok.exe" -Recurse -ErrorAction SilentlyContinue -Depth 6 |
             Select-Object -First 1
  if ($hallado) { $ngrok = $hallado.FullName }
}
if ($ngrok) {
  $dominio = Leer "NGROK_DOMAIN"
  $puerto  = Leer "HTTP_PORT" "80"
  if (-not $dominio) {
    Mal "Falta NGROK_DOMAIN en el .env.prod: no registro la tarea de ngrok."
    Info "Sin eso, el tunel apuntaria a un dominio equivocado."
    $errores++
  } else {
    Info "Tunel: https://$dominio -> localhost:$puerto"
    $argNg = "-NoProfile -NonInteractive -WindowStyle Hidden -Command `"& '$ngrok' http --domain=$dominio $puerto`""
    $r = Registrar-Tarea -Nombre "Sistema de Calidad - ngrok" -Comando "powershell.exe" `
      -Argumentos $argNg -Usuario $usuarioDestino -LimiteTiempo "PT0S" `
      -Descripcion "Tunel ngrok del Sistema de Calidad. Se mantiene vivo solo."
    if ($r.ok) { Bien "ngrok registrado (se mantiene vivo solo)."; schtasks /run /TN "Sistema de Calidad - ngrok" 2>&1 | Out-Null }
    else { Mal "No pude registrar la tarea de ngrok: $($r.detalle)"; $errores++ }
  }
} else {
  Mal "No encuentro ngrok instalado: no registro su tarea."
  Info "winget install --id Ngrok.Ngrok -e --source winget"
  $errores++
}

# ---------- Verificacion, sin CIM ----------
Write-Host ""
Write-Host "  Como quedaron:" -ForegroundColor White
foreach ($n in @("Sistema de Calidad - Vigilante", "Sistema de Calidad - ngrok")) {
  $q = schtasks /query /TN "$n" /XML 2>&1
  if ($LASTEXITCODE -eq 0) {
    $txt = ($q | Out-String)
    $rep = if ($txt -match "<Interval>([^<]+)</Interval>") { $matches[1] } else { "?" }
    $niv = if ($txt -match "<RunLevel>([^<]+)</RunLevel>") { $matches[1] } else { "?" }
    $lim = if ($txt -match "<ExecutionTimeLimit>([^<]+)</ExecutionTimeLimit>") { $matches[1] } else { "?" }
    Bien "$n  -> repite cada $rep, privilegios $niv, limite $lim"
  } else {
    Mal "$n  -> no quedo registrada"
  }
}

Write-Host ""
if ($errores -eq 0) {
  Write-Host "  Listo. El sistema va a arrancar solo cuando esta cuenta inicie sesion." -ForegroundColor Green
  Write-Host "  Para probarlo de verdad: reinicia la PC, inicia sesion y espera 2-3 minutos." -ForegroundColor Gray
} else {
  Write-Host "  Quedaron $errores cosa(s) sin resolver. Sacale una foto a esta pantalla." -ForegroundColor Yellow
}
Write-Host ""
Read-Host "Enter para cerrar"
