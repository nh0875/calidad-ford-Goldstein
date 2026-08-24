# ============================================================================
#  Deja la actualización automática andando sola en esta PC
# ============================================================================
#  Se corre UNA VEZ por máquina. Registra una tarea programada que revisa si hay
#  cambios nuevos en GitHub y, si los hay, actualiza el sistema.
#
#  Corre a la HORA DEL ALMUERZO a propósito: actualizar reinicia los contenedores
#  y aplica migraciones, así que hay un par de minutos sin sistema.
#
#  ¿Por qué no de madrugada, que sería más tranquilo? Porque la PC de la agencia
#  se apaga a la noche. Una tarea de las 4 AM no correría nunca, o correría al
#  prender la máquina a las 8 y media, con la agencia abriendo. Al mediodía la PC
#  seguro está prendida y los usuarios seguro no están.
#
#  Como al mediodía la ventana de envío está abierta (9 a 19), el backend hace un
#  apagado ordenado: termina el WhatsApp que tenga entre manos antes de cerrar, y
#  la cola vive en Redis con persistencia, así que lo pendiente sigue ahí.
#
#  Uso:
#      powershell -ExecutionPolicy Bypass -File Instalar-Actualizacion-Automatica.ps1
#      powershell -ExecutionPolicy Bypass -File Instalar-Actualizacion-Automatica.ps1 -Hora 13:30
#      powershell -ExecutionPolicy Bypass -File Instalar-Actualizacion-Automatica.ps1 -Quitar
# ============================================================================

param(
    [string]$Hora = "13:00",
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

# Se le pasa la hora prevista para que el script sepa reconocer una corrida
# tardía (PC que estuvo apagada al mediodía y arranca a la mañana siguiente) y la
# deje pasar en vez de actualizar con la agencia llena de gente.
$accion = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument ("-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"{0}`" -HoraPrevista {1}" -f $Script, $Hora)

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
Write-Host "    Cuando       : todos los dias a las $Hora (hora del almuerzo)"
Write-Host "    Que hace     : mira si hay algo nuevo en GitHub; si no hay, no toca nada"
Write-Host "    Si la PC estaba apagada: corre al prenderla, salvo que ya sea muy tarde"
Write-Host "                   (ahi espera al dia siguiente y no molesta en horario de trabajo)"
Write-Host "    Si algo sale mal: vuelve solo a la version anterior"
Write-Host "    Registro     : scripts\windows\actualizacion-automatica.log"
Write-Host ""
Write-Host "  Para probarlo ahora mismo, sin esperar:" -ForegroundColor Cyan
Write-Host "    powershell -ExecutionPolicy Bypass -File `"$Script`"" -ForegroundColor Gray
Write-Host ""
Write-Host "  Para desactivarla:" -ForegroundColor Cyan
Write-Host "    ...\Instalar-Actualizacion-Automatica.ps1 -Quitar" -ForegroundColor Gray
Write-Host ""
