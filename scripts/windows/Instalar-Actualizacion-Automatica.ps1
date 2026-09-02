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
    # Cuenta que va a correr la actualizacion: la que usa la PC todos los dias.
    # Vacio = la del que corre esto. Hace falta cuando instala un administrador
    # para otra persona, que es lo normal en la empresa.
    [string]$Usuario = "",
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
    $null = & schtasks /delete /TN $NombreTarea /F 2>&1
    if ($LASTEXITCODE -eq 0) {
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
# CORRE COMO EL USUARIO, NO COMO SYSTEM.
#
# Antes esto se registraba con -UserId "SYSTEM" para que corriera aunque no
# hubiera nadie con la sesion iniciada. Estaba MAL y nunca se noto porque la
# tarea no llego a instalarse en ninguna PC: el actualizador hace
# "docker compose build" y "up -d", y Docker Desktop solo le responde a la sesion
# del usuario. Como SYSTEM habria fallado todos los dias a las 13:00.
#
# Por eso ahora corre como el usuario y con /IT (interactive only): solo se
# ejecuta cuando esa persona tiene la sesion abierta. A las 13:00 la tiene, y sin
# su sesion la actualizacion no podria funcionar igual.
#
# Y se usa schtasks en vez de los cmdlets por lo mismo que en instalar-todo.ps1:
# los cmdlets hablan por WMI y en algunas PCs esa capa esta rota.
$argumento = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command & '$Script' -HoraPrevista $Hora"
$parametros = @("/create", "/TN", $NombreTarea,
                "/TR", "powershell.exe $argumento",
                "/SC", "DAILY", "/ST", $Hora)
$propio = (-not $Usuario) -or ($Usuario -eq "$env:USERDOMAIN\$env:USERNAME")
if (-not $propio) { $parametros += @("/RU", $Usuario, "/IT") }
$parametros += "/F"

$salida = & schtasks @parametros 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "  No se pudo registrar la tarea:" -ForegroundColor Red
    Write-Host "  $(($salida | Out-String).Trim())" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  En algunas PCs de empresa no se pueden crear tareas programadas." -ForegroundColor Yellow
    Write-Host "  Ahi la actualizacion va enganchada al vigilante; se instala con:" -ForegroundColor Yellow
    Write-Host "     scripts\windows\Instalar-Arranque-Sin-Tareas.bat" -ForegroundColor Gray
    Write-Host "  (revisa que el bucle ya este instalado y listo, no hace falta nada mas)" -ForegroundColor Gray
    Write-Host ""
    Read-Host "Enter para cerrar"; exit 1
}

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
