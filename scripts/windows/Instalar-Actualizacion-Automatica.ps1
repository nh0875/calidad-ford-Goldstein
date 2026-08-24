# ============================================================================
#  Deja la actualización automática andando sola en esta PC
# ============================================================================
#  Se corre UNA VEZ por máquina. Registra una tarea programada que revisa si hay
#  cambios nuevos en GitHub y, si los hay, actualiza el sistema.
#
#  Se corre en horario de MADRUGADA a propósito: actualizar reinicia los
#  contenedores y aplica migraciones, así que hay un par de minutos sin sistema.
#  A las 4 de la mañana no hay nadie usándolo y los WhatsApp tampoco salen (la
#  ventana de envío arranca a las 9).
#
#  Uso:
#      powershell -ExecutionPolicy Bypass -File Instalar-Actualizacion-Automatica.ps1
#      powershell -ExecutionPolicy Bypass -File Instalar-Actualizacion-Automatica.ps1 -Hora 05:30
#      powershell -ExecutionPolicy Bypass -File Instalar-Actualizacion-Automatica.ps1 -Quitar
# ============================================================================

param(
    [string]$Hora = "04:00",
    [switch]$Quitar
)

$ErrorActionPreference = "Stop"

$NombreTarea = "Sistema de Calidad - actualizacion automatica"
$Script = Join-Path $PSScriptRoot "Actualizacion-Automatica.ps1"

function EsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (EsAdmin)) {
    Write-Host ""
    Write-Host "  Hay que abrir PowerShell COMO ADMINISTRADOR para registrar la tarea." -ForegroundColor Red
    Write-Host "  (clic derecho en PowerShell -> Ejecutar como administrador)" -ForegroundColor Red
    Write-Host ""
    exit 1
}

if ($Quitar) {
    $t = Get-ScheduledTask -TaskName $NombreTarea -ErrorAction SilentlyContinue
    if ($t) {
        Unregister-ScheduledTask -TaskName $NombreTarea -Confirm:$false
        Write-Host "  Listo: la actualizacion automatica quedo desactivada." -ForegroundColor Green
    } else {
        Write-Host "  No estaba instalada." -ForegroundColor Yellow
    }
    exit 0
}

if (-not (Test-Path $Script)) {
    Write-Host "  No encuentro $Script" -ForegroundColor Red
    exit 1
}

if ($Hora -notmatch '^\d{1,2}:\d{2}$') {
    Write-Host "  La hora tiene que ser tipo 04:00" -ForegroundColor Red
    exit 1
}

$accion = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument ("-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"{0}`"" -f $Script)

# Diaria a la hora elegida. Si la PC estaba apagada, se corre cuando prende.
$disparador = New-ScheduledTaskTrigger -Daily -At $Hora

$config = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

# SYSTEM para que corra aunque no haya nadie con sesión iniciada.
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $NombreTarea -Action $accion -Trigger $disparador `
    -Settings $config -Principal $principal -Force | Out-Null

Write-Host ""
Write-Host "  Listo. El sistema se va a actualizar solo." -ForegroundColor Green
Write-Host ""
Write-Host "    Cuando       : todos los dias a las $Hora"
Write-Host "    Que hace     : mira si hay algo nuevo en GitHub; si no hay, no toca nada"
Write-Host "    Si algo sale mal: vuelve solo a la version anterior"
Write-Host "    Registro     : scripts\windows\actualizacion-automatica.log"
Write-Host ""
Write-Host "  Para probarlo ahora mismo, sin esperar:" -ForegroundColor Cyan
Write-Host "    powershell -ExecutionPolicy Bypass -File `"$Script`"" -ForegroundColor Gray
Write-Host ""
Write-Host "  Para desactivarla:" -ForegroundColor Cyan
Write-Host "    ...\Instalar-Actualizacion-Automatica.ps1 -Quitar" -ForegroundColor Gray
Write-Host ""
