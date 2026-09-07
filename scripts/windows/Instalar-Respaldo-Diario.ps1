# ============================================================================
# Instalar-Respaldo-Diario.ps1
# Deja el respaldo diario a la nube (M365 / SharePoint) andando SOLO.
# Se corre UNA vez, como administrador, DESPUÉS de sincronizar la biblioteca de
# SharePoint en esta PC (ver README, "Respaldo automático a la nube").
#
# Ejemplo:
#   powershell -ExecutionPolicy Bypass -File .\Instalar-Respaldo-Diario.ps1 `
#     -CarpetaNube "C:\Users\vanina\Goldstein Automotores\Calidad - Respaldos"
# ============================================================================
[CmdletBinding()]
param(
  # Carpeta LOCAL que OneDrive sincroniza con SharePoint (la que aparece en el
  # Explorador después de tocar "Sincronizar" en la biblioteca del sitio).
  [Parameter(Mandatory = $true)][string]$CarpetaNube,
  [string]$Hora = "13:30",       # hora diaria del respaldo (PC prendida y con sesión iniciada)
  [int]$Retencion = 14,          # copias diarias a conservar
  [string]$DestinoRed,           # carpeta de red UNC adicional (opcional)
  [string]$Proyecto,             # carpeta del sistema (si no, se detecta sola)
  # A nombre de que cuenta queda la tarea. Vacio = la que corre este script.
  # Se usa cuando instala un administrador pero la PC la usa otra persona, que
  # es lo normal en la empresa (por politica del dominio el usuario diario no
  # es administrador).
  [string]$Usuario
)
$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot
if (-not $Proyecto) { $Proyecto = Split-Path (Split-Path $scriptDir -Parent) -Parent }
$respaldoPs1 = Join-Path $scriptDir "Respaldo-Calidad.ps1"
if (-not (Test-Path $respaldoPs1)) { throw "No encuentro Respaldo-Calidad.ps1 junto a este script." }

# La carpeta de la nube tiene que existir YA (sincronizada). Si no, avisamos.
if (-not (Test-Path $CarpetaNube)) {
  throw "La carpeta '$CarpetaNube' no existe. Primero sincronizá la biblioteca de SharePoint en esta PC (ver README), después corré esto con la ruta que quedó en el Explorador."
}

# 1) Guardar la config para que el script (y Respaldo-AHORA.bat) la usen sin argumentos.
$cfg = [ordered]@{
  destinoNube = $CarpetaNube
  destinoRed  = $DestinoRed
  proyecto    = $Proyecto
  envFile     = (Join-Path $Proyecto ".env.prod")
  retencion   = $Retencion
}
$cfgPath = Join-Path $scriptDir "Respaldo-Config.json"
$cfg | ConvertTo-Json | Set-Content -Path $cfgPath -Encoding UTF8
Write-Host "Config guardada en: $cfgPath"

# 2) Registrar la tarea programada diaria.
#
#    NO se usan los cmdlets New-ScheduledTask* / Register-ScheduledTask: hablan
#    con el Programador a traves de WMI, y en la PC de Volkswagen esa capa esta
#    rota ("No se puede conectar al servidor CIM") aunque el servicio Programador
#    de tareas ande perfecto. Las otras dos tareas del sistema ya se habian
#    migrado a schtasks con parametros sueltos (ver el helper de instalar-todo.ps1
#    y su comentario, que documenta todo lo que se probo en esa maquina); esta era
#    la ultima que quedaba con WMI, y por eso ahi el respaldo NO SE PODIA INSTALAR.
#
#    Y NO se pide nivel elevado. Antes iba con RunLevel Highest, justificado en un
#    comentario con "permisos para hablar con Docker" — que es exactamente al
#    reves de como funciona: Docker Desktop expone el pipe de su motor a la sesion
#    NORMAL del usuario y un proceso ELEVADO no llega (esta escrito en
#    configurar-pc.ps1, e instalar-todo.ps1 directamente aborta si detecta que lo
#    corrieron elevado). Con Highest, la tarea fallaba TODOS los dias con "No
#    encontre el contenedor de Postgres corriendo" mientras que a mano, con
#    Respaldo-AHORA.bat, andaba perfecto: el clasico "pero si lo probe y funciona".
#    schtasks crea en nivel normal cuando no se le pasa /RL, asi que alcanza con
#    no pedirlo.
#
#    /RU + /IT solo si se instala A NOMBRE DE OTRA CUENTA. /IT (interactive only)
#    evita tener que saber su contrasena y hace que la tarea corra unicamente con
#    esa sesion iniciada, que es justo lo que se necesita: sin sesion no hay
#    OneDrive sincronizando ni acceso a Docker.
$taskName = "Respaldo Calidad M365"
$tr = "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command & '$respaldoPs1'"
$propio = (-not $Usuario) -or ($Usuario -eq "$env:USERDOMAIN\$env:USERNAME")

# schtasks escribe por la salida de ERRORES cosas que no siempre son errores, y
# con $ErrorActionPreference = "Stop" PowerShell 5.1 las convierte en excepcion y
# mata el script en el medio. Se baja a Continue solo para estas llamadas.
$eapPrevio = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$ok = $false; $detalle = ""; $aviso = ""
try {
  $param = @("/create", "/TN", $taskName, "/TR", $tr, "/SC", "DAILY", "/ST", $Hora)
  if (-not $propio) { $param += @("/RU", $Usuario, "/IT") }
  $param += "/F"
  $salida = & schtasks @param 2>&1
  $ok = ($LASTEXITCODE -eq 0)

  # Reintento sin /RU: sirve cuando el que instala ES el usuario de todos los dias.
  if (-not $ok -and -not $propio) {
    $salida2 = & schtasks @("/create", "/TN", $taskName, "/TR", $tr, "/SC", "DAILY", "/ST", $Hora, "/F") 2>&1
    $ok = ($LASTEXITCODE -eq 0)
    if ($ok) { $aviso = "OJO: la tarea quedo a nombre de $env:USERNAME, no de $Usuario." }
    else { $salida = (($salida | Out-String) + ($salida2 | Out-String)) }
  }
  if (-not $ok) { $detalle = ($salida | Out-String).Trim() }
} finally {
  $ErrorActionPreference = $eapPrevio
}

if (-not $ok) { throw "No se pudo registrar la tarea '$taskName'.`n$detalle" }
if ($aviso) { Write-Host $aviso -ForegroundColor Yellow }
Write-Host "Tarea '$taskName' registrada: todos los dias a las $Hora, en nivel NORMAL (no elevada)."

# 3) Prueba inmediata: hace un respaldo ahora para confirmar que todo el circuito anda.
Write-Host "`nProbando un respaldo ahora mismo..."
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $respaldoPs1
Write-Host "`n---------------------------------------------------------------"
Write-Host "LISTO. En 1-2 minutos revisá que el archivo 'calidad_*.dump' aparezca"
Write-Host "en la biblioteca de SharePoint (en el navegador). Si está: quedó andando."
Write-Host "El log queda en: $(Join-Path $Proyecto 'Respaldos\respaldo.log')"
