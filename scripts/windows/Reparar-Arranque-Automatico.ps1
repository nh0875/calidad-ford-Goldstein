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

# ---------------------------------------------------------------------------
#  Registrar una tarea programada
# ---------------------------------------------------------------------------
#  DOS COSAS QUE NO SE PUEDEN USAR ACA, Y POR QUE:
#
#  1. Los cmdlets New-ScheduledTaskAction / -Trigger / -SettingsSet.
#     Hablan con el Programador a traves de WMI, y en la PC de Volkswagen esa
#     capa esta rota: todos fallan con "No se puede conectar al servidor CIM"
#     aunque el servicio Programador de tareas este corriendo perfecto.
#
#  2. schtasks /create /XML.
#     Probado en esa misma PC: devuelve "Acceso denegado", con y sin /RU. En
#     cambio schtasks con PARAMETROS SUELTOS funciona sin problema; se comprobo
#     creando tareas de prueba con cmd.exe y con powershell -ExecutionPolicy
#     Bypass, y las dos se crearon bien. Asi que el problema es el XML: no son
#     los permisos, ni el antivirus, ni una politica de dominio.
#
#  Por eso: parametros sueltos. Lo que se pierde con ellos, y como queda cubierto:
#
#    - IgnoreNew (no arrancar una segunda instancia): NO hace falta. El propio
#      vigilante.ps1 se protege con un archivo de candado (vigilante-calidad.lock,
#      con vencimiento por si queda huerfano).
#    - StartWhenAvailable: irrelevante con /SC MINUTE, que vuelve a intentar a los
#      5 minutos de todas formas.
#    - ExecutionTimeLimit: schtasks no tiene flag para esto, asi que las tareas
#      quedan con el limite por defecto de 72 horas. Para el vigilante da igual
#      (una corrida dura segundos). Para ngrok significa que a los 3 dias Windows
#      lo corta; lo revive el vigilante en la pasada siguiente, que es el
#      comportamiento que ya estaba previsto.
#
#  /RU + /IT registra la tarea A NOMBRE DE OTRO USUARIO sin pedir su contrasena.
#  Hace falta porque en la empresa el que instala es un administrador y el que usa
#  la PC es otra persona que, por politica del dominio, no puede ser
#  administrador. /IT (interactive only) es lo que evita la contrasena: la tarea
#  corre solo cuando ese usuario tiene sesion iniciada, que es justo lo que se
#  quiere, porque fuera de su sesion no llegaria a Docker igual.
function Registrar-Tarea {
  param(
    [string]$Nombre,
    [string]$Comando,
    [string]$Argumentos,
    [string]$Usuario,
    [string]$Descripcion,
    [int]$CadaMinutos = 0   # 0 = al iniciar sesion; >0 = cada N minutos
  )

  $tr = "$Comando $Argumentos"
  $parametros = @("/create", "/TN", $Nombre, "/TR", $tr)
  if ($CadaMinutos -gt 0) { $parametros += @("/SC", "MINUTE", "/MO", "$CadaMinutos") }
  else                    { $parametros += @("/SC", "ONLOGON") }

  # Si la tarea es para OTRA cuenta hace falta /RU. Si es para uno mismo, /RU
  # sobra y en algunas PCs molesta, asi que se omite.
  $propio = (-not $Usuario) -or ($Usuario -eq "$env:USERDOMAIN\$env:USERNAME")
  if (-not $propio) { $parametros += @("/RU", $Usuario, "/IT") }
  $parametros += "/F"

  $salida = & schtasks @parametros 2>&1
  if ($LASTEXITCODE -eq 0) { return @{ ok = $true; detalle = "" } }

  # Reintento sin /RU: sirve cuando el que instala ES el usuario de todos los dias.
  if (-not $propio) {
    $p2 = @("/create", "/TN", $Nombre, "/TR", $tr)
    if ($CadaMinutos -gt 0) { $p2 += @("/SC", "MINUTE", "/MO", "$CadaMinutos") }
    else                    { $p2 += @("/SC", "ONLOGON") }
    $p2 += "/F"
    $salida2 = & schtasks @p2 2>&1
    if ($LASTEXITCODE -eq 0) {
      return @{ ok = $true; detalle = "OJO: quedo a nombre de $env:USERNAME, no de $Usuario" }
    }
    $salida = (($salida | Out-String) + ($salida2 | Out-String))
  }
  return @{ ok = $false; detalle = ($salida | Out-String).Trim() }
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
  $argVig = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command & '$Vigilante'"
  $r = Registrar-Tarea -Nombre "Sistema de Calidad - Vigilante" -Comando "powershell.exe" `
    -Argumentos $argVig -Usuario $usuarioDestino -CadaMinutos 5 `
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
    $argNg = "-NoProfile -NonInteractive -WindowStyle Hidden -Command & '$ngrok' http --domain=$dominio $puerto"
    $r = Registrar-Tarea -Nombre "Sistema de Calidad - ngrok" -Comando "powershell.exe" `
      -Argumentos $argNg -Usuario $usuarioDestino -CadaMinutos 0 `
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
  $q = schtasks /query /TN "$n" /FO LIST /V 2>&1
  if ($LASTEXITCODE -eq 0) {
    $txt = ($q | Out-String)
    $usr = if ($txt -match "(?m)^\s*(?:Ejecutar como usuario|Run As User)\s*:\s*(.+)$") { $matches[1].Trim() } else { "?" }
    $est = if ($txt -match "(?m)^\s*(?:Estado|Status)\s*:\s*(.+)$") { $matches[1].Trim() } else { "?" }
    Bien "$n  -> corre como $usr  (estado: $est)"
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
