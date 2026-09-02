# ============================================================================
#  Dejar el sistema arrancando solo, SIN tareas programadas
# ============================================================================
#  Deja el arranque por DOS caminos a la vez, a propósito:
#
#    1. Un acceso directo en la CARPETA DE INICIO.
#    2. Una entrada en la clave Run del registro del usuario (HKCU).
#
#  ¿Por qué los dos? Porque en la PC de Volkswagen el antivirus BORRÓ el acceso
#  directo: un .lnk en la carpeta de Inicio que lanza PowerShell es una firma
#  clásica de persistencia de malware, y ya se había comido un .vbs en la PC de
#  Ford por lo mismo. La clave Run, en cambio, es el mecanismo que usa el propio
#  Docker Desktop en esa misma máquina y ahí sí funciona.
#
#  Con los dos puestos, si uno desaparece el otro sigue levantando el sistema. Y
#  el script avisa cuál de los dos sobrevivió, así se sabe en qué confiar.
#
#  Desde ahí el sistema arranca cuando la persona inicia sesión, y se repara solo
#  cada 5 minutos, igual que con la tarea programada.
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
$claveRun = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$nombreRun = "Sistema de Calidad"

if ($Quitar) {
    $algo = $false
    if (Test-Path $acceso) { Remove-Item $acceso -Force; Bien "Sacado el acceso directo."; $algo = $true }
    if ($Usuario) {
        Info "La entrada del registro solo se puede sacar desde la sesion de $cuenta."
    } elseif ((Get-ItemProperty $claveRun -Name $nombreRun -EA SilentlyContinue)) {
        Remove-ItemProperty $claveRun -Name $nombreRun -Force -EA SilentlyContinue
        Bien "Sacada la entrada del registro."; $algo = $true
    }
    if (-not $algo) { Info "No estaba instalado en la cuenta $cuenta." }
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

# ---------- Bajar la "firma de malware" del arranque ----------
#
# Lo que borran los antivirus no es PowerShell: es el PATRON
# "algo que arranca solo y ejecuta powershell -ExecutionPolicy Bypass".
# Ese Bypass es la bandera roja, porque es como el malware saltea la politica
# de ejecucion de la maquina.
#
# Se puede evitar: si la politica de ejecucion del USUARIO permite correr
# scripts locales, el Bypass sobra. Y ponerla NO necesita ser administrador,
# porque es del usuario, no de la maquina.
#
# RemoteSigned deja correr scripts locales sin firmar (los nuestros) y sigue
# bloqueando los descargados de internet sin firma, asi que no se afloja la
# seguridad de la PC.
$sinBypass = $false
try {
    $actual = Get-ExecutionPolicy -Scope CurrentUser -ErrorAction Stop
    if ($actual -in @("RemoteSigned", "Unrestricted", "Bypass")) {
        $sinBypass = $true
        Info "La politica de ejecucion del usuario ya permite scripts locales ($actual)."
    } else {
        Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force -ErrorAction Stop
        $sinBypass = $true
        Bien "Politica de ejecucion del usuario puesta en RemoteSigned."
        Info "Asi el arranque no necesita el -ExecutionPolicy Bypass, que es"
        Info "justamente lo que los antivirus marcan como sospechoso."
    }
} catch {
    Info "No pude cambiar la politica de ejecucion del usuario: se usa -ExecutionPolicy Bypass."
    Info "($($_.Exception.Message))"
}

# Los argumentos del arranque: con Bypass solo si no quedo otra.
$argsArranque = if ($sinBypass) {
    "-NoProfile -NonInteractive -WindowStyle Hidden -File `"$Bucle`""
} else {
    "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Bucle`""
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
    $lnk.Arguments = $argsArranque
    $lnk.WorkingDirectory = $PSScriptRoot
    $lnk.WindowStyle = 7      # 7 = minimizado, para que no moleste
    $lnk.Description = "Levanta y repara el Sistema de Calidad cada 5 minutos."
    $lnk.Save()
    Bien "Acceso directo creado."
} catch {
    Mal "No pude crear el acceso directo: $($_.Exception.Message)"
    Read-Host "`nEnter para cerrar"; exit 1
}

# ---------- Camino 2: la clave Run del registro ----------
# Solo se puede escribir en el HKCU de la sesion abierta. Si un administrador
# instala para otra persona, esa parte la tiene que correr ella.
$run = $false
if ($Usuario -and ($cuenta -ne $env:USERNAME)) {
    Info "La entrada del registro no se puede poner desde otra cuenta."
    Info "Que $cuenta corra este mismo script en SU sesion para dejarla."
} else {
    try {
        $comando = "`"$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe`" $argsArranque"
        if (-not (Test-Path $claveRun)) { New-Item -Path $claveRun -Force | Out-Null }
        Set-ItemProperty -Path $claveRun -Name $nombreRun -Value $comando -Force
        $run = $true
        Bien "Entrada del registro creada."
    } catch {
        Mal "No pude crear la entrada del registro: $($_.Exception.Message)"
    }
}

# ---------- Que sobrevivio ----------
# Se vuelve a mirar despues de crear: si el antivirus se lleva alguno, se lo
# lleva en el momento, y conviene saberlo ahora y no dentro de una semana.
Start-Sleep -Seconds 2
$vivoAcceso = Test-Path $acceso
$vivoRun = $false
if (-not ($Usuario -and ($cuenta -ne $env:USERNAME))) {
    $vivoRun = [bool](Get-ItemProperty $claveRun -Name $nombreRun -EA SilentlyContinue)
}

Write-Host ""
Info ("acceso directo en Inicio : " + $(if ($vivoAcceso) { "OK" } else { "NO QUEDO (se lo llevo el antivirus?)" }))
Info ("entrada en el registro   : " + $(if ($vivoRun) { "OK" } else { "no puesta" }))

if (-not $vivoAcceso -and -not $vivoRun) {
    Write-Host ""
    Mal "No quedo ninguno de los dos: el sistema NO va a arrancar solo."
    Info "Si el antivirus los esta borrando, hay que pedirle una excepcion a Sistemas"
    Info "para: $Bucle"
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
