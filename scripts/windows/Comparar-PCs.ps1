# ============================================================================
#  Juntar todo lo que hace falta para comparar dos PCs
# ============================================================================
#  PARA QUE. En la PC de Ford el tunel de ngrok convive con el antivirus sin
#  problema desde hace meses. En la de Volkswagen el antivirus borra el
#  ngrok.exe una y otra vez, incluso instalado desde winget. Misma empresa, mismo
#  antivirus, resultado opuesto: entonces hay UNA diferencia concreta entre las
#  dos maquinas, y esto la busca en vez de seguir probando a ciegas.
#
#  COMO SE USA. Correrlo en LAS DOS PCs y mandar los dos archivos:
#
#      powershell -ExecutionPolicy Bypass -File Comparar-PCs.ps1
#
#  Deja un archivo en el Escritorio: "comparacion-<NOMBRE DE LA PC>.txt".
#
#  NO TOCA NADA. Solo lee y escribe ese archivo. Se puede correr sin miedo en la
#  PC que esta funcionando.
#
#  Conviene correrlo SIN elevar (asi ve lo que ve el usuario de todos los dias) y,
#  si se puede, tambien elevado: algunas consultas del antivirus y de las tareas
#  necesitan permisos. El script avisa cual es cual.
# ============================================================================

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

# La carpeta del sistema NO se escribe a mano: se deduce de donde esta este
# script (siempre vive en <proyecto>\scripts\windows). En cada PC la carpeta se
# llama distinto -- "Vanina" en una, "Volkswagen" en la otra, y en alguna quedo
# con otro nombre -- asi que darla por sabida hacia que medio informe saliera
# vacio justo en la maquina que hay que diagnosticar.
$ProyectoDir = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

$salida = New-Object System.Collections.Generic.List[string]
function Agregar([string]$t) { $salida.Add($t); Write-Host $t }
function Titulo([string]$t) {
    Agregar ""
    Agregar ("=" * 70)
    Agregar "  $t"
    Agregar ("=" * 70)
}
# Todo va adentro de esto: en una de las dos PCs WMI esta roto y varias consultas
# fallan. Que falle una no puede cortar el informe entero.
function Intentar([string]$que, [scriptblock]$bloque) {
    try {
        $r = & $bloque
        if ($null -eq $r -or ($r -is [array] -and $r.Count -eq 0)) { Agregar "  $que : (vacio)" }
        else { foreach ($l in @($r)) { Agregar "  $que : $l" } }
    } catch {
        Agregar "  $que : NO SE PUDO ($($_.Exception.Message))"
    }
}

Titulo "IDENTIFICACION"
Agregar "  fecha            : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Agregar "  equipo           : $env:COMPUTERNAME"
Agregar "  usuario          : $env:USERDOMAIN\$env:USERNAME"
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$esAdmin = (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Agregar "  ventana elevada  : $esAdmin"
Intentar "usuario con sesion" { (Get-CimInstance Win32_ComputerSystem).UserName }
Intentar "version de Windows" { (Get-CimInstance Win32_OperatingSystem).Caption + " " + (Get-CimInstance Win32_OperatingSystem).Version }

Titulo "NGROK: DONDE ESTA Y COMO ES"
Agregar "  carpeta del sistema : $ProyectoDir"
Agregar ""
$rutas = @(
    "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe",
    "$env:LOCALAPPDATA\Microsoft\WindowsApps\ngrok.exe",
    (Join-Path $ProyectoDir "ngrok.exe"),
    (Join-Path $ProyectoDir "ngrok\ngrok.exe"),
    (Join-Path $PSScriptRoot "ngrok.exe"),
    "C:\Calidad\Vanina\ngrok.exe",
    "C:\Calidad\Volkswagen\ngrok.exe",
    "C:\ngrok\ngrok.exe"
)
foreach ($r in $rutas) { Agregar "  $(if (Test-Path $r) { 'SI' } else { 'no' })  $r" }
Intentar "en el PATH" { (Get-Command ngrok -ErrorAction Stop).Source }
Agregar ""
Agregar "  -- busqueda en todos los perfiles de usuario --"
# DOS TRAMPAS, las dos encontradas probando esto de verdad:
#
#   1. -Force NO ES OPCIONAL. AppData es carpeta OCULTA y Get-ChildItem -Recurse
#      sin -Force ni siquiera entra a mirarla. Justo ahi instala winget el ngrok,
#      asi que sin -Force la busqueda volvia VACIA con el archivo estando.
#   2. Recorrer C:\Users entero EXPLOTA. Windows deja puntos de union viejos
#      ("Application Data", "Configuracion local") que apuntan a su propia carpeta
#      padre: el recorrido gira en redondo y termina reventando con "El sistema no
#      puede encontrar el archivo especificado" -- y ahi se pierde TODO el
#      resultado, no solo la rama mala.
#
# Por eso se buscan carpetas concretas y con profundidad acotada, perfil por
# perfil. Interesa que sea cada perfil y no solo el actual: en estas PCs conviven
# la cuenta de la persona y la del administrador, y el ngrok puede estar en
# cualquiera de las dos.
function Buscar-Ngrok([string]$raiz, [int]$hondo) {
    if (-not (Test-Path $raiz)) { return @() }
    try {
        return @(Get-ChildItem -LiteralPath $raiz -Filter ngrok.exe -Recurse -Depth $hondo -File -Force -ErrorAction SilentlyContinue)
    } catch { return @() }
}

$encontrados = New-Object System.Collections.Generic.List[string]
$perfiles = @()
try { $perfiles = @(Get-ChildItem C:\Users -Directory -Force -ErrorAction SilentlyContinue) } catch { }
foreach ($p in $perfiles) {
    foreach ($sub in @("AppData\Local\Microsoft\WinGet", "AppData\Local\ngrok", "AppData\Local", "Downloads", "Desktop", "Documents")) {
        # Poca profundidad en AppData\Local (es gigante) y mas en WinGet, que es
        # donde de verdad esta el que nos importa.
        $hondo = if ($sub -eq "AppData\Local") { 3 } else { 5 }
        foreach ($h in (Buscar-Ngrok (Join-Path $p.FullName $sub) $hondo)) {
            $encontrados.Add("$($h.FullName)  |  $($h.Length) bytes  |  creado $($h.CreationTime)")
        }
    }
}
foreach ($otra in @("C:\Program Files\ngrok", "C:\Program Files (x86)\ngrok", "C:\ProgramData\chocolatey\bin", "C:\ngrok", $ProyectoDir)) {
    foreach ($h in (Buscar-Ngrok $otra 3)) {
        $encontrados.Add("$($h.FullName)  |  $($h.Length) bytes  |  creado $($h.CreationTime)")
    }
}
$unicos = $encontrados | Sort-Object -Unique
if ($unicos.Count -eq 0) { Agregar "  encontrado : NINGUNO en todo el disco" }
else { foreach ($u in $unicos) { Agregar "  encontrado : $u" } }

# La FIRMA DIGITAL y la MARCA DE INTERNET son las dos cosas que mas cambian como
# lo trata un antivirus. Un archivo bajado con el navegador o con PowerShell
# queda marcado ("Zone.Identifier"); uno que llega por winget, no.
$exe = ($rutas | Where-Object { Test-Path $_ } | Select-Object -First 1)
if (-not $exe) { $exe = (Get-Command ngrok -ErrorAction SilentlyContinue).Source }
if ($exe) {
    Agregar ""
    Agregar "  -- del ngrok.exe que se encontro: $exe --"
    Intentar "version" { (Get-Item $exe).VersionInfo.FileVersion }
    Intentar "tamano" { (Get-Item $exe).Length }
    Intentar "firma digital" { $f = Get-AuthenticodeSignature $exe; "$($f.Status) - $($f.SignerCertificate.Subject)" }
    Intentar "marcado como bajado de internet" {
        $z = Get-Item $exe -Stream Zone.Identifier -ErrorAction SilentlyContinue
        if ($z) { "SI (tiene Zone.Identifier)" } else { "no" }
    }
    Intentar "hash SHA256" { (Get-FileHash $exe -Algorithm SHA256).Hash }
}

Titulo "CONFIGURACION DE NGROK"
# Solo se informa SI EXISTE, nunca el contenido: adentro esta el authtoken de la
# cuenta y este archivo se manda por chat.
foreach ($c in @(
    "$env:LOCALAPPDATA\ngrok\ngrok.yml",
    "$env:APPDATA\ngrok\ngrok.yml",
    (Join-Path $ProyectoDir "ngrok.yml"),
    "C:\Calidad\Vanina\ngrok.yml",
    "C:\Calidad\Volkswagen\ngrok.yml")) {
    Agregar "  $(if (Test-Path $c) { 'SI' } else { 'no' })  $c"
}

Titulo "ANTIVIRUS"
Intentar "productos registrados" {
    Get-CimInstance -Namespace "root/SecurityCenter2" -ClassName AntiVirusProduct -ErrorAction Stop |
        ForEach-Object { "$($_.displayName)  (estado $($_.productState))" }
}
Intentar "Defender activo" { $s = Get-MpComputerStatus -ErrorAction Stop; "AM=$($s.AMProductVersion) tiempo-real=$($s.RealTimeProtectionEnabled) antivirus=$($s.AntivirusEnabled) manipulacion=$($s.IsTamperProtected)" }

Agregar ""
Agregar "  -- EXCLUSIONES (lo mas importante de todo el informe) --"
Intentar "carpetas excluidas" { (Get-MpPreference -ErrorAction Stop).ExclusionPath }
Intentar "procesos excluidos" { (Get-MpPreference -ErrorAction Stop).ExclusionProcess }
Intentar "extensiones excluidas" { (Get-MpPreference -ErrorAction Stop).ExclusionExtension }

Agregar ""
Agregar "  -- reglas de reduccion de superficie de ataque --"
Intentar "reglas activas" {
    $p = Get-MpPreference -ErrorAction Stop
    for ($i = 0; $i -lt $p.AttackSurfaceReductionRules_Ids.Count; $i++) {
        "$($p.AttackSurfaceReductionRules_Ids[$i]) = $($p.AttackSurfaceReductionRules_Actions[$i])"
    }
}

Agregar ""
Agregar "  -- que detecto y cuando (aca aparece si borro ngrok) --"
Intentar "detecciones" {
    Get-MpThreatDetection -ErrorAction Stop | Sort-Object InitialDetectionTime -Descending |
        Select-Object -First 10 |
        ForEach-Object { "$($_.InitialDetectionTime) | $($_.ThreatID) | $($_.Resources -join ', ')" }
}
Intentar "amenazas conocidas" {
    Get-MpThreat -ErrorAction Stop | Select-Object -First 10 |
        ForEach-Object { "$($_.ThreatName) | $($_.Resources -join ', ')" }
}

Titulo "TAREAS PROGRAMADAS DEL SISTEMA"
foreach ($t in @("Sistema de Calidad - ngrok", "Sistema Calidad - Vigilante", "Sistema de Calidad - Vigilante")) {
    Agregar ""
    Agregar "  ---- $t ----"
    $xml = & schtasks /query /TN $t /XML 2>&1
    if ($LASTEXITCODE -eq 0) {
        # El XML COMPLETO a proposito: es lo unico que dice la verdad sobre la
        # repeticion, el limite de tiempo y con que usuario corre. El formato de
        # lista miente (muestra N/A aunque la repeticion este configurada).
        foreach ($l in @($xml)) { Agregar "    $l" }
    } else {
        Agregar "    (no existe o no se pudo consultar: $($xml | Select-Object -First 1))"
    }
}

Titulo "LANZADORES Y SCRIPTS"
Intentar "politica de ejecucion del usuario" { Get-ExecutionPolicy -Scope CurrentUser }
Intentar "version del sistema instalada" { & git -C $ProyectoDir log --oneline -1 2>$null }
foreach ($d in @($PSScriptRoot, "C:\Calidad\Vanina\scripts\windows", "C:\Calidad\Volkswagen\scripts\windows")) {
    if (-not (Test-Path $d)) { continue }
    Agregar "  -- $d --"
    # El .vbs es el lanzador que esconde la ventana de ngrok. En una de las dos
    # PCs el antivirus lo bloquea por "virus o software potencialmente no
    # deseado"; en la otra convive sin problema. Que exista o no es dato.
    Intentar "archivos .vbs" { Get-ChildItem $d -Filter *.vbs -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Name)  ($($_.Length) bytes, $($_.LastWriteTime))" } }
}

Titulo "DOCKER Y EL SISTEMA"
Intentar "docker" { (& docker version --format "{{.Server.Version}}" 2>$null) }
Intentar "contenedores" { (& docker ps --format "{{.Names}}" 2>$null) }
Intentar "el sistema responde" {
    $req = [System.Net.HttpWebRequest]::Create("http://localhost/api/health")
    $req.Timeout = 8000; $req.Proxy = $null
    $resp = $req.GetResponse()
    (New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd()
}
Intentar "el tunel local responde" {
    $req = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:4040/api/tunnels")
    $req.Timeout = 5000; $req.Proxy = $null
    $resp = $req.GetResponse()
    ((New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd()).Substring(0, 400)
}
Intentar "ngrok corriendo" { Get-Process ngrok -ErrorAction Stop | ForEach-Object { "PID $($_.Id) desde $($_.StartTime)" } }

Titulo "FIN"

# Se guarda en la CARPETA DEL SISTEMA y ademas, si se puede, en el Escritorio.
# El orden importa: cuando esto corre elevado, Windows suele elevar con la cuenta
# del ADMINISTRADOR, y entonces "el Escritorio" es el del administrador -- no el
# de la persona, que abre su Escritorio y no encuentra nada. La carpeta del
# sistema, en cambio, es la misma para todos y la persona ya sabe donde esta.
$nombre = "comparacion-$env:COMPUTERNAME.txt"
$guardados = @()
foreach ($carpeta in @($ProyectoDir, [Environment]::GetFolderPath("Desktop"))) {
    if (-not $carpeta) { continue }
    try {
        $ruta = Join-Path $carpeta $nombre
        $salida | Set-Content -Path $ruta -Encoding UTF8 -ErrorAction Stop
        $guardados += $ruta
    } catch { }
}

Write-Host ""
if ($guardados.Count -gt 0) {
    Write-Host "  Informe guardado en:" -ForegroundColor Green
    foreach ($g in $guardados) { Write-Host "     $g" -ForegroundColor Green }
    Write-Host ""
    Write-Host "  Manda ESE archivo. No tiene contrasenas ni datos de clientes." -ForegroundColor Gray
} else {
    Write-Host "  No pude guardar el archivo en ningun lado." -ForegroundColor Red
    Write-Host "  Copia y pega lo que salio arriba." -ForegroundColor Yellow
}
Write-Host ""
Read-Host "Enter para cerrar"
