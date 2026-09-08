# ============================================================================
#  Dejar el arranque automático bien, de una sola vez
# ============================================================================
#  QUÉ HACE. Crea (o rehace) las DOS tareas programadas que el sistema necesita,
#  las dispara, y después VERIFICA que hayan quedado como corresponde. No hay que
#  tocar nada a mano en la ventana del Programador de tareas.
#
#    1. "Sistema Calidad - Vigilante" — cada 5 minutos. Levanta Docker si está
#       apagado, los contenedores si están caídos, y se ocupa del respaldo y de
#       la actualización diaria.
#    2. "Sistema de Calidad - ngrok"  — mantiene vivo el túnel.
#
#  POR QUÉ HACE FALTA ESTE SCRIPT. Configurar esto a mano tiene tres trampas que
#  no se ven, y las tres aparecieron de verdad en la PC de Volkswagen:
#
#    · La regla "si la tarea ya se está ejecutando" venía en "detener la
#      instancia existente", así que cada 5 minutos Windows MATABA al vigilante
#      para arrancar otro. Acá eso deja de importar: el vigilante se llama con
#      -UnaPasada, hace una pasada corta y termina solo. La tarea ES el bucle.
#
#    · ngrok quedaba como proceso HIJO del vigilante, así que moría con él cada
#      vez. Por eso ngrok lleva su PROPIA tarea: una tarea disparada con
#      "schtasks /run" la lanza el servicio de Windows, no quien la pide, y nace
#      como proceso de primera clase.
#
#    · /SC ONLOGON es la ÚNICA variante que la política de esa PC bloquea. Si
#      falla, se cae solo a /SC ONCE con fecha lejana, que se crea sin problema.
#
#  CÓMO SE CORRE. PowerShell COMO ADMINISTRADOR (la cuenta de todos los días no
#  puede crear tareas), y se le dice para qué cuenta son:
#
#      powershell -ExecutionPolicy Bypass -File Reparar-Arranque.ps1 -Usuario ldip
#
#  Para sacar todo:
#      powershell -ExecutionPolicy Bypass -File Reparar-Arranque.ps1 -Quitar
# ============================================================================

param(
    # Cuenta en cuya sesión tiene que correr todo. IMPORTANTE: Docker solo le
    # responde a la sesión interactiva de esa persona, así que si esto queda a
    # nombre de otro usuario el vigilante no puede levantar nada.
    [string]$Usuario = "",
    [switch]$Quitar
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$TareaVigilante = "Sistema Calidad - Vigilante"
$TareaNgrok     = "Sistema de Calidad - ngrok"

$ProjectDir = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$EnvFile    = Join-Path $ProjectDir ".env.prod"
$Bucle      = Join-Path $PSScriptRoot "vigilante-bucle.ps1"
$PowerShell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

function Bien($t)  { Write-Host "  [OK]  $t" -ForegroundColor Green }
function Mal($t)   { Write-Host "  [!]   $t" -ForegroundColor Red }
function Ojo($t)   { Write-Host "  [?]   $t" -ForegroundColor Yellow }
function Info($t)  { Write-Host "        $t" -ForegroundColor Gray }
function Titulo($t) {
    Write-Host ""
    Write-Host "  ---------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host "   $t" -ForegroundColor Cyan
    Write-Host "  ---------------------------------------------------------" -ForegroundColor DarkGray
}

Clear-Host
Write-Host ""
Write-Host "   =========================================================" -ForegroundColor Cyan
Write-Host "      ARRANQUE AUTOMATICO DEL SISTEMA DE CALIDAD" -ForegroundColor Cyan
Write-Host "   =========================================================" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
#  ¿Estamos elevados?
# ---------------------------------------------------------------------------
# Sin esto el script "anda" y falla tarea por tarea con "Acceso denegado", que no
# le dice a nadie cuál era el problema real.
$identidad = [Security.Principal.WindowsIdentity]::GetCurrent()
$esAdmin = (New-Object Security.Principal.WindowsPrincipal($identidad)).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdmin) {
    Write-Host ""
    Mal "Esta ventana NO es de administrador."
    Info "Crear tareas programadas necesita permisos de administrador."
    Info ""
    Info "Cerrá esta ventana, buscá 'PowerShell' en el menú Inicio, hacé clic"
    Info "DERECHO y elegí 'Ejecutar como administrador'. Después volvé a correr"
    Info "este mismo comando."
    Write-Host ""
    Read-Host "Enter para cerrar"; exit 1
}
Bien "Ventana de administrador."

# ---------------------------------------------------------------------------
#  Quitar
# ---------------------------------------------------------------------------
if ($Quitar) {
    Titulo "Sacando las tareas"
    foreach ($t in @($TareaVigilante, $TareaNgrok)) {
        $null = & schtasks /delete /TN $t /F 2>&1
        if ($LASTEXITCODE -eq 0) { Bien "Sacada: $t" } else { Info "No estaba: $t" }
    }
    Write-Host ""
    Read-Host "Enter para cerrar"; exit 0
}

# ---------------------------------------------------------------------------
#  Comprobaciones antes de tocar nada
# ---------------------------------------------------------------------------
Titulo "Revisando que este todo en su lugar"

if (-not (Test-Path $Bucle)) {
    Mal "No encuentro vigilante-bucle.ps1 en $PSScriptRoot"
    Info "¿Estás corriendo esto desde la carpeta del sistema?"
    Write-Host ""
    Read-Host "Enter para cerrar"; exit 1
}
Bien "vigilante-bucle.ps1 encontrado."

if (-not (Test-Path $EnvFile)) {
    Mal "No encuentro .env.prod en $ProjectDir"
    Write-Host ""
    Read-Host "Enter para cerrar"; exit 1
}
Bien ".env.prod encontrado."

# El vigilante nuevo acepta -UnaPasada. Si el archivo en disco es el viejo, la
# tarea quedaría creada con un parámetro que el script ignora y volvería a ser un
# bucle infinito peleando con la tarea, que es exactamente el problema a evitar.
if (-not (Select-String -Path $Bucle -Pattern "UnaPasada" -Quiet)) {
    Mal "El vigilante que hay en disco es una version VIEJA (no entiende -UnaPasada)."
    Info "Actualizá primero con Actualizar-AHORA.bat y volvé a correr esto."
    Write-Host ""
    Read-Host "Enter para cerrar"; exit 1
}
Bien "El vigilante es la version nueva."

function Leer-EnvProd([string]$clave) {
    foreach ($linea in (Get-Content $EnvFile -ErrorAction SilentlyContinue)) {
        $l = "$linea".Trim()
        if ($l -eq "" -or $l.StartsWith("#")) { continue }
        $i = $l.IndexOf("=")
        if ($i -lt 1) { continue }
        if ($l.Substring(0, $i).Trim() -eq $clave) { return $l.Substring($i + 1).Trim() }
    }
    return ""
}

$dominio = Leer-EnvProd "NGROK_DOMAIN"
$puerto  = Leer-EnvProd "HTTP_PORT"
if (-not $puerto) { $puerto = "80" }

# Si no se dijo la cuenta, se toma la que tiene sesión abierta ahora. Casi
# siempre es la correcta y evita un error tonto por no pasar el parámetro.
if (-not $Usuario) {
    $sesion = (Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue).UserName
    if ($sesion) { $Usuario = ($sesion -split "\\")[-1] }
}
if ($Usuario) { Info "Cuenta para la que se instala: $Usuario" }
else { Ojo "No pude deducir la cuenta: las tareas quedan a nombre de $env:USERNAME." }

# ---------------------------------------------------------------------------
#  Crear una tarea, probando variantes hasta que una entre
# ---------------------------------------------------------------------------
#  Se prueban EN ORDEN y se corta en la primera que funciona. Cada variante está
#  acá porque alguna PC rechazó la anterior:
#    · con /RU y /IT     : registra a nombre de otra cuenta sin pedir su contraseña
#    · sin /RU           : cuando quien instala ES la persona que usa la PC
function Crear-Tarea {
    param([string]$Nombre, [string]$Comando, [string[]]$Programacion, [string]$Como)

    # OJO CON LA COMA. Escrito como
    #     $intentos += ,@("a","b") + $Programacion + @("c")
    # la coma envuelve SOLO al primer arreglo y el resto queda SUELTO: $intentos
    # termina con 9 elementos en vez de 1, y el foreach le pasa a schtasks pedazos
    # sueltos como "/SC". Error real en la PC de Volkswagen:
    #     Argumento u opcion no valido - "/"
    # Hay que armar el arreglo COMPLETO y recien despues envolverlo con la coma.
    $intentos = @()
    $base = @("/create", "/TN", $Nombre, "/TR", $Comando) + $Programacion
    if ($Usuario -and $Usuario -ne $env:USERNAME) {
        $conUsuario = $base + @("/RU", $Usuario, "/IT", "/F")
        $intentos += ,$conUsuario
    }
    $sinUsuario = $base + @("/F")
    $intentos += ,$sinUsuario

    foreach ($p in $intentos) {
        $salida = & schtasks @p 2>&1
        if ($LASTEXITCODE -eq 0) { return @{ ok = $true; como = $Como } }
        $ultimo = ($salida | Select-Object -First 1)
    }
    return @{ ok = $false; detalle = "$ultimo" }
}

# ---------------------------------------------------------------------------
#  1. El vigilante
# ---------------------------------------------------------------------------
Titulo "1. Tarea del vigilante (cada 5 minutos)"

# -UnaPasada es la clave: una corrida corta que termina sola. Así da lo mismo
# cómo esté la regla de "si ya se está ejecutando", y tampoco importa el límite
# de 3 días que Windows le pone a las tareas y que schtasks no sabe cambiar.
$cmdVigilante = "`"$PowerShell`" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Bucle`" -UnaPasada"

$r = Crear-Tarea -Nombre $TareaVigilante -Comando $cmdVigilante -Programacion @("/SC", "MINUTE", "/MO", "5") -Como "cada 5 minutos"
$vigilanteListo = $r.ok
if ($r.ok) { Bien "Creada: $TareaVigilante ($($r.como))." }
else {
    Mal "No se pudo crear la tarea del vigilante."
    Info $r.detalle
    Info "Sin ella el sistema no arranca solo. Avisale a Ignacio con esta pantalla."
}

# ---------------------------------------------------------------------------
#  2. ngrok
# ---------------------------------------------------------------------------
Titulo "2. Tarea de ngrok (el tunel)"

# Se busca EN SERIO. La lista corta de antes no lo encontro en la PC de
# Volkswagen y el script se salteo la tarea del tunel sin mas, que es justo lo que
# habia que arreglar. Ahora: rutas conocidas, el PATH, where.exe, y si nada de eso
# da, una busqueda en las carpetas donde la gente suele dejarlo.
$rutasNgrok = @(
    "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe",
    "$env:ProgramFiles\ngrok\ngrok.exe",
    "${env:ProgramFiles(x86)}\ngrok\ngrok.exe",
    "$env:LOCALAPPDATA\ngrok\ngrok.exe",
    "$env:USERPROFILE\ngrok\ngrok.exe",
    "$env:USERPROFILE\Downloads\ngrok.exe",
    "$env:USERPROFILE\Desktop\ngrok.exe",
    "C:\ngrok\ngrok.exe",
    "C:\Calidad\ngrok.exe",
    (Join-Path $ProjectDir "ngrok.exe"),
    (Join-Path $PSScriptRoot "ngrok.exe")
)
$ngrokExe = $rutasNgrok | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $ngrokExe) {
    $c = Get-Command ngrok -ErrorAction SilentlyContinue
    if ($c) { $ngrokExe = $c.Source }
}
if (-not $ngrokExe) {
    # where.exe mira el PATH de la MAQUINA, que puede no ser el de esta ventana.
    $w = (& where.exe ngrok.exe 2>$null | Select-Object -First 1)
    if ($w -and (Test-Path $w)) { $ngrokExe = $w }
}
if (-not $ngrokExe) {
    Info "No esta en las rutas conocidas: buscando en el disco (tarda un momento)..."
    foreach ($raiz in @("$env:LOCALAPPDATA", "$env:USERPROFILE\Downloads", "$env:ProgramFiles", "C:\Calidad")) {
        if (-not (Test-Path $raiz)) { continue }
        $hallado = Get-ChildItem -Path $raiz -Filter "ngrok.exe" -Recurse -ErrorAction SilentlyContinue |
                   Select-Object -First 1
        if ($hallado) { $ngrokExe = $hallado.FullName; break }
    }
}

$ngrokListo = $false
if (-not $ngrokExe) {
    Ojo "No encuentro ngrok.exe: se saltea su tarea."
    Info "El sistema va a andar en localhost, pero el link de afuera no."
} elseif (-not $dominio) {
    Ojo "No hay NGROK_DOMAIN en .env.prod: se saltea su tarea."
} else {
    Info "ngrok   : $ngrokExe"
    Info "dominio : $dominio"
    $cmdNgrok = "`"$ngrokExe`" http --domain=$dominio $puerto"

    # ONLOGON primero (arranca sola al iniciar sesión). Si la política la bloquea
    # —pasa en esta PC—, ONCE con fecha lejana: no se dispara nunca sola, pero
    # queda registrada y el vigilante la corre con "schtasks /run" cuando ve el
    # túnel caído, que es el camino que el vigilante ya tenía.
    $r2 = Crear-Tarea -Nombre $TareaNgrok -Comando $cmdNgrok -Programacion @("/SC", "ONLOGON") -Como "al iniciar sesion"
    if (-not $r2.ok) {
        Info "La politica bloquea el arranque al iniciar sesion; se usa la otra forma."
        # "01/01/2099" a mano y con ceros: schtasks rechaza el formato corto de
        # Windows ("1/1/2099"), y el 1 de enero se escribe igual en dd/mm que en
        # mm/dd, así que no depende del idioma del sistema.
        $r2 = Crear-Tarea -Nombre $TareaNgrok -Comando $cmdNgrok `
            -Programacion @("/SC", "ONCE", "/SD", "01/01/2099", "/ST", "00:00") -Como "a pedido del vigilante"
    }
    if ($r2.ok) { Bien "Creada: $TareaNgrok ($($r2.como))."; $ngrokListo = $true }
    else { Mal "No se pudo crear la tarea de ngrok."; Info $r2.detalle }
}

# ---------------------------------------------------------------------------
#  3. Arrancar y verificar de verdad
# ---------------------------------------------------------------------------
Titulo "3. Arrancando y comprobando"

if ($ngrokListo) { $null = & schtasks /run /TN $TareaNgrok 2>&1 }
$null = & schtasks /run /TN $TareaVigilante 2>&1
Info "Tareas disparadas. Dando tiempo a que levanten..."

# Se verifica con /XML y NO con "/query /V /FO LIST": el formato de lista MIENTE
# sobre la repeticion (muestra N/A aunque este configurada). Solo el XML dice la
# verdad, y esto tiene que informar la verdad o no sirve para nada.
$xml = (& schtasks /query /TN $TareaVigilante /XML 2>&1) -join "`n"
$repite = $xml -match "PT5M"
$conUnaPasada = $xml -match "UnaPasada"

Write-Host ""
Info ("repite cada 5 minutos     : " + $(if ($repite) { "SI" } else { "NO  <-- revisar" }))
Info ("usa el modo una-pasada    : " + $(if ($conUnaPasada) { "SI" } else { "NO  <-- revisar" }))

function Web-Local([string]$url, [int]$ms) {
    try {
        # Sin proxy: en una PC de empresa el proxy se come hasta las consultas a
        # localhost y devuelve que no responde con todo funcionando.
        $req = [System.Net.HttpWebRequest]::Create($url)
        $req.Timeout = $ms
        $req.Proxy = $null
        $resp = $req.GetResponse()
        $lec = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $txt = $lec.ReadToEnd(); $lec.Close(); $resp.Close()
        return $txt
    } catch { return $null }
}

$urlLocal = if ($puerto -eq "80") { "http://localhost/api/health" } else { "http://localhost:$puerto/api/health" }
$sistemaOk = $false
$tunelOk = $false
for ($i = 0; $i -lt 24 -and -not ($sistemaOk -and ($tunelOk -or -not $ngrokListo)); $i++) {
    Start-Sleep -Seconds 10
    if (-not $sistemaOk) { $sistemaOk = [bool](Web-Local $urlLocal 8000) }
    if ($ngrokListo -and -not $tunelOk) {
        $t = Web-Local "http://127.0.0.1:4040/api/tunnels" 5000
        if ($t -and $dominio) { $tunelOk = ($t -match [regex]::Escape($dominio)) }
    }
    if ($i % 6 -eq 5) { Info "  todavia levantando... ($([int](($i + 1) / 6)) min)" }
}

Write-Host ""
Info ("el sistema responde       : " + $(if ($sistemaOk) { "SI" } else { "NO" }))
if ($ngrokListo) { Info ("el tunel esta activo      : " + $(if ($tunelOk) { "SI" } else { "NO" })) }

# ---------------------------------------------------------------------------
Titulo "RESULTADO"
Write-Host ""
# El veredicto tiene que mirar TAMBIEN si las tareas se crearon. La primera
# version solo miraba si el sistema respondia, asi que dijo "LISTO, va a arrancar
# solo" con la tarea del vigilante FALLADA y sin tarea de ngrok: el sistema
# respondia porque ya estaba levantado de antes, no por nada que hubiera hecho el
# script. Un cartel verde mentiroso es peor que uno rojo.
if ($vigilanteListo -and $ngrokListo -and $sistemaOk -and $tunelOk) {
    Write-Host "   LISTO. Va a arrancar solo cada vez que $Usuario inicie sesion." -ForegroundColor Green
    Write-Host ""
    Info "El sistema local : $urlLocal"
    if ($dominio) { Info "Desde afuera     : https://$dominio" }
    Info ""
    Info "Se revisa y se repara cada 5 minutos. Queda anotado en:"
    Info "   $PSScriptRoot\vigilante-bucle.log"
} else {
    Mal "NO quedo listo. Falta esto:"
    Write-Host ""
    if (-not $vigilanteListo) {
        Info "* La tarea del VIGILANTE no se pudo crear. Sin ella el sistema NO"
        Info "  arranca solo cuando se prende la PC."
    }
    if (-not $ngrokListo) {
        Info "* La tarea de NGROK no se pudo crear (o no se encontro ngrok.exe)."
        Info "  El sistema anda en localhost, pero el link de afuera no."
    }
    if (-not $sistemaOk) {
        Info "El SISTEMA no contesta. Suele ser que Docker todavia esta arrancando:"
        Info "esperá unos minutos y abrí $urlLocal"
    }
    if ($ngrokListo -and -not $tunelOk) {
        Info "El TUNEL no responde. Revisá que el token de ngrok este cargado:"
        Info "   ngrok config check"
        Info "y que no haya otra PC usando el mismo token con el mismo dominio."
    }
    Info ""
    Info "Mirá tambien: $PSScriptRoot\vigilante.log"
}
Write-Host ""
Read-Host "Enter para cerrar"
