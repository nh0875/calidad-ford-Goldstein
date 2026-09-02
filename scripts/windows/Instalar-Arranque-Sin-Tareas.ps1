# ============================================================================
#  Dejar el sistema arrancando solo, SIN tareas programadas
# ============================================================================
#  Pone un acceso directo en la CARPETA DE INICIO de Windows. Desde ahí el
#  sistema arranca cuando la persona inicia sesión, y se repara solo cada 5
#  minutos, igual que con la tarea programada.
#
#  CUANDO USAR ESTO: cuando Reparar-Arranque-Automatico falla con "Acceso
#  denegado". En algunas PCs de empresa las políticas del dominio y el antivirus
#  no dejan registrar tareas programadas de ninguna forma — se probaron todas.
#
#  NO NECESITA PERMISOS DE ADMINISTRADOR si se corre en la sesión de la persona
#  que usa la PC: la carpeta de Inicio es suya. Un administrador también puede
#  correrlo apuntando a otra cuenta con -Usuario.
#
#  Uso:
#      powershell -ExecutionPolicy Bypass -File Instalar-Arranque-Sin-Tareas.ps1
#      powershell -ExecutionPolicy Bypass -File Instalar-Arranque-Sin-Tareas.ps1 -Usuario ldip
#      powershell -ExecutionPolicy Bypass -File Instalar-Arranque-Sin-Tareas.ps1 -Quitar
# ============================================================================

param(
    # Cuenta en cuya carpeta de Inicio se instala. Vacío = la del que corre esto.
    # Solo el nombre de usuario, sin el dominio (ej: ldip).
    [string]$Usuario = "",
    [switch]$Quitar
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$Bucle = Join-Path $PSScriptRoot "vigilante-bucle.ps1"

function Bien($t) { Write-Host "  [OK]  $t" -ForegroundColor Green }
function Mal($t)  { Write-Host "  [!]   $t" -ForegroundColor Red }
function Info($t) { Write-Host "        $t" -ForegroundColor Gray }

# Carpeta de Inicio de la cuenta elegida.
if ($Usuario) {
    $cuenta = ($Usuario -split "\\")[-1]   # por si pasan DOMINIO\usuario
    $inicio = "C:\Users\$cuenta\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup"
} else {
    $cuenta = $env:USERNAME
    $inicio = [Environment]::GetFolderPath("Startup")
}
$acceso = Join-Path $inicio "Sistema de Calidad.lnk"

Write-Host ""
if ($Quitar) {
    if (Test-Path $acceso) {
        Remove-Item $acceso -Force
        Bien "Sacado el arranque automatico de la cuenta $cuenta."
    } else {
        Info "No estaba instalado en la cuenta $cuenta."
    }
    Write-Host ""
    Read-Host "Enter para cerrar"; exit 0
}

Write-Host "  Instalando el arranque automatico" -ForegroundColor Cyan
Write-Host "    cuenta  : $cuenta" -ForegroundColor White
Write-Host "    carpeta : $inicio" -ForegroundColor Gray
Write-Host ""

if (-not (Test-Path $Bucle)) {
    Mal "No encuentro vigilante-bucle.ps1 en $PSScriptRoot"
    Read-Host "`nEnter para cerrar"; exit 1
}
if (-not (Test-Path $inicio)) {
    Mal "No existe la carpeta de Inicio de '$cuenta': $inicio"
    Info "Revisá que el nombre de usuario este bien escrito."
    Read-Host "`nEnter para cerrar"; exit 1
}

# Se crea un ACCESO DIRECTO, no un .bat ni un .vbs.
#
# Un .lnk apuntando a powershell.exe es lo que menos se parece a malware de todas
# las opciones: no es un script suelto en disco que el antivirus pueda marcar
# (que fue exactamente lo que pasó en la PC de Ford, donde se comió un .vbs), y
# la ventana se oculta con la propiedad del propio acceso directo.
try {
    $sh = New-Object -ComObject WScript.Shell
    $lnk = $sh.CreateShortcut($acceso)
    $lnk.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $lnk.Arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Bucle`""
    $lnk.WorkingDirectory = $PSScriptRoot
    $lnk.WindowStyle = 7      # 7 = minimizado, para que no moleste
    $lnk.Description = "Levanta y repara el Sistema de Calidad cada 5 minutos."
    $lnk.Save()
    Bien "Acceso directo creado."
} catch {
    Mal "No pude crear el acceso directo: $($_.Exception.Message)"
    Read-Host "`nEnter para cerrar"; exit 1
}

if (-not (Test-Path $acceso)) {
    Mal "El acceso directo no quedo escrito. Revisá los permisos sobre esa carpeta."
    Read-Host "`nEnter para cerrar"; exit 1
}

Write-Host ""
Write-Host "  =========================================================" -ForegroundColor Green
Write-Host "   Listo. El sistema va a arrancar solo cuando $cuenta" -ForegroundColor Green
Write-Host "   inicie sesion en Windows." -ForegroundColor Green
Write-Host "  =========================================================" -ForegroundColor Green
Write-Host ""
Info "Se revisa y se repara cada 5 minutos, igual que antes."
Info "Queda anotado en: scripts\windows\vigilante-bucle.log"
Write-Host ""
Write-Host "  Para probarlo sin reiniciar, arrancalo ahora:" -ForegroundColor Cyan
Write-Host "    powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Bucle`"" -ForegroundColor Gray
Write-Host ""
Write-Host "  Para sacarlo:" -ForegroundColor Cyan
Write-Host "    ...\Instalar-Arranque-Sin-Tareas.ps1 -Quitar" -ForegroundColor Gray
Write-Host ""
Read-Host "Enter para cerrar"
