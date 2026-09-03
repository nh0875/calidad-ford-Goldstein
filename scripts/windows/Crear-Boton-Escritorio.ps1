# ============================================================================
#  Un botón en el escritorio para levantar el sistema
# ============================================================================
#  PARA QUÉ: que la persona que usa la PC tenga UNA cosa que hacer si el sistema
#  no está andando — un doble clic — sin depender de que el arranque automático
#  funcione, sin consolas y sin comandos.
#
#  En la PC de Volkswagen el arranque automático viene siendo una pelea: no se
#  pueden crear tareas programadas, el antivirus borra los accesos directos de la
#  carpeta de Inicio, y hay políticas de dominio de por medio. Mientras eso se
#  resuelve, esto garantiza que el sistema se pueda levantar en dos segundos.
#
#  El botón hace lo mismo que haría el arranque automático: deja corriendo el
#  bucle del vigilante, que levanta Docker, los contenedores y el túnel, y después
#  los vigila cada 5 minutos.
#
#  Uso:
#      powershell -ExecutionPolicy Bypass -File Crear-Boton-Escritorio.ps1
#      powershell -ExecutionPolicy Bypass -File Crear-Boton-Escritorio.ps1 -Usuario ldip
# ============================================================================

param(
    [string]$Usuario = ""
)

$ErrorActionPreference = "Continue"

$Levantar = Join-Path $PSScriptRoot "Levantar-Sistema.ps1"

function Bien($t) { Write-Host "  [OK]  $t" -ForegroundColor Green }
function Mal($t)  { Write-Host "  [!]   $t" -ForegroundColor Red }
function Ojo($t)  { Write-Host "  [?]   $t" -ForegroundColor Yellow }
function Info($t) { Write-Host "        $t" -ForegroundColor Gray }

# ---------- Encontrar el escritorio DE VERDAD ----------
#
# Esto ya fallo una vez: el boton "se creaba bien" y no aparecia por ningun lado.
# Motivo: OneDrive redirige el Escritorio. La carpeta real pasa a ser
# ...\OneDrive\Escritorio (o "Desktop", segun el idioma del perfil), y a veces
# ...\OneDrive - Mario Goldstein\Escritorio cuando la cuenta es corporativa.
# El C:\Users\<cuenta>\Desktop de toda la vida queda ahi, vacio y sin mirar.
#
# Y hay un agravante: cuando esto se corre ELEVADO con otra cuenta (en la PC de
# Volkswagen el unico admin es Ignacio, no la persona que usa la maquina),
# GetFolderPath("Desktop") devuelve el escritorio del ADMINISTRADOR, no el de
# quien va a apretar el boton.
#
# Por eso no se elige "el" escritorio: se juntan todos los candidatos que
# existen de verdad y el acceso directo se deja en TODOS. Tener el icono
# repetido no molesta a nadie; no tenerlo deja a la persona sin poder levantar
# el sistema.
if ($Usuario) {
    $cuenta = ($Usuario -split "\\")[-1]   # por si pasan DOMINIO\usuario
    $perfil = "C:\Users\$cuenta"
} else {
    $cuenta = $env:USERNAME
    $perfil = $env:USERPROFILE
}

$escritorios = @()

# 1) Lo que diga el registro del usuario, que es la fuente autoritativa.
#    Solo sirve si estamos en SU sesion: HKCU es el del que corre el script.
if (-not $Usuario -or $cuenta -eq $env:USERNAME) {
    try {
        $clave = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders" -ErrorAction Stop
        if ($clave.Desktop) {
            $escritorios += [Environment]::ExpandEnvironmentVariables($clave.Desktop)
        }
    } catch { }
    $escritorios += [Environment]::GetFolderPath("Desktop")
}

# 2) Los lugares habituales, incluido OneDrive en sus variantes.
$escritorios += "$perfil\Desktop"
$escritorios += "$perfil\Escritorio"
foreach ($od in @(Get-ChildItem -Path $perfil -Filter "OneDrive*" -Directory -ErrorAction SilentlyContinue)) {
    $escritorios += (Join-Path $od.FullName "Desktop")
    $escritorios += (Join-Path $od.FullName "Escritorio")
}

# Solo los que existen de verdad, sin repetir.
$escritorios = @($escritorios | Where-Object { $_ -and (Test-Path $_) } |
                 ForEach-Object { (Resolve-Path $_).Path } | Select-Object -Unique)

Write-Host ""
if (-not (Test-Path $Levantar)) {
    Mal "No encuentro Levantar-Sistema.ps1 en $PSScriptRoot"
    Read-Host "`nEnter para cerrar"; exit 1
}
if ($escritorios.Count -eq 0) {
    Mal "No encuentro ningun escritorio de la cuenta '$cuenta'."
    Info "Buscado en: $perfil (Desktop, Escritorio y OneDrive*)"
    Read-Host "`nEnter para cerrar"; exit 1
}

# OJO: la variable NO puede llamarse $args. En PowerShell $args es automatica
# (los argumentos de la funcion o el script) y pisarla trae sorpresas.
#
# A diferencia del arranque automatico, aca el -ExecutionPolicy Bypass se deja
# siempre: lo que los antivirus marcan es un Bypass que se dispara SOLO al
# iniciar sesion. Un acceso directo que aprieta una persona no es ese patron, y
# sacarlo obligaria a depender de la politica de ejecucion del usuario, que en
# esta PC vuelve sola a Undefined.
$argumentos = "-NoProfile -ExecutionPolicy Bypass -File `"$Levantar`""

# El icono de Docker, si esta: se reconoce de un vistazo entre los del escritorio.
$icono = $null
foreach ($i in @("$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
                 "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe")) {
    if (Test-Path $i) { $icono = "$i,0"; break }
}

Info ("Escritorios encontrados de '{0}': {1}" -f $cuenta, $escritorios.Count)
Write-Host ""

$creados = @()
foreach ($carpeta in $escritorios) {
    $destino = Join-Path $carpeta "Iniciar Sistema de Calidad.lnk"
    try {
        $sh = New-Object -ComObject WScript.Shell
        $lnk = $sh.CreateShortcut($destino)
        $lnk.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
        $lnk.Arguments = $argumentos
        $lnk.WorkingDirectory = $PSScriptRoot
        $lnk.WindowStyle = 1      # 1 = normal: la ventana SE VE, a proposito
        $lnk.Description = "Levanta el Sistema de Calidad y lo mantiene andando."
        if ($icono) { $lnk.IconLocation = $icono }
        $lnk.Save()
        $creados += $destino
        Bien "Creado en: $carpeta"
    } catch {
        Mal "No pude crear en $carpeta"
        Info "($($_.Exception.Message))"
    }
}

if ($creados.Count -eq 0) {
    Write-Host ""
    Mal "No se pudo crear el boton en ningun escritorio."
    Read-Host "`nEnter para cerrar"; exit 1
}

# Se vuelve a mirar: si el antivirus se lo lleva, se lo lleva en el momento, y
# conviene enterarse ahora y no cuando la persona lo necesite.
Start-Sleep -Seconds 2
$vivos = @($creados | Where-Object { Test-Path $_ })

Write-Host ""
if ($vivos.Count -eq 0) {
    Mal "El boton no quedo: se lo llevo el antivirus."
    Info "Sin arranque automatico y sin boton, el sistema hay que levantarlo con:"
    Info "   cd C:\Calidad\Volkswagen"
    Info "   docker compose -f docker-compose.prod.yml --env-file .env.prod up -d"
    Read-Host "`nEnter para cerrar"; exit 1
}
if ($vivos.Count -lt $creados.Count) {
    Ojo "De $($creados.Count) copias sobrevivieron $($vivos.Count): el antivirus se llevo alguna."
    Info "Igual alcanza con una."
}

Write-Host ""
Write-Host "  =========================================================" -ForegroundColor Green
Write-Host "   Si el sistema no responde, doble clic en el boton" -ForegroundColor Green
Write-Host "   'Iniciar Sistema de Calidad' del escritorio." -ForegroundColor Green
Write-Host "  =========================================================" -ForegroundColor Green
Write-Host ""
Info "Abre una ventana que va contando que hace, y cuando termina"
Info "le abre el sistema en el navegador."
Write-Host ""
Read-Host "Enter para cerrar"
