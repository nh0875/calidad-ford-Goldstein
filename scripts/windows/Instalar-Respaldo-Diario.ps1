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
  [string]$Proyecto              # carpeta del sistema (si no, se detecta sola)
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
#    LogonType Interactive = corre solo cuando la cuenta está con sesión iniciada,
#    así OneDrive está corriendo y sube el archivo a la nube. RunLevel Highest =
#    con permisos para hablar con Docker.
$taskName  = "Respaldo Calidad M365"
$accion    = New-ScheduledTaskAction -Execute "powershell.exe" `
             -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $respaldoPs1)
$trigger   = New-ScheduledTaskTrigger -Daily -At $Hora
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $taskName -Action $accion -Trigger $trigger -Principal $principal `
  -Settings $settings -Description "Copia diaria de la base del Sistema de Calidad a SharePoint (M365)." | Out-Null
Write-Host "Tarea '$taskName' registrada: todos los días a las $Hora."

# 3) Prueba inmediata: hace un respaldo ahora para confirmar que todo el circuito anda.
Write-Host "`nProbando un respaldo ahora mismo..."
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $respaldoPs1
Write-Host "`n---------------------------------------------------------------"
Write-Host "LISTO. En 1-2 minutos revisá que el archivo 'calidad_*.dump' aparezca"
Write-Host "en la biblioteca de SharePoint (en el navegador). Si está: quedó andando."
Write-Host "El log queda en: $(Join-Path $Proyecto 'Respaldos\respaldo.log')"
