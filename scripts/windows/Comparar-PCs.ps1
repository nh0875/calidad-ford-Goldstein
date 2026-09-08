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
$rutas = @(
    "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe",
    "$env:LOCALAPPDATA\Microsoft\WindowsApps\ngrok.exe",
    "C:\Calidad\Vanina\ngrok.exe",
    "C:\Calidad\Volkswagen\ngrok.exe",
    "C:\ngrok\ngrok.exe"
)
foreach ($r in $rutas) { Agregar "  $(if (Test-Path $r) { 'SI' } else { 'no' })  $r" }
Intentar "en el PATH" { (Get-Command ngrok -ErrorAction Stop).Source }
Agregar ""
Agregar "  -- busqueda completa en C:\Users (puede tardar) --"
Intentar "encontrado" {
    Get-ChildItem C:\Users -Filter ngrok.exe -Recurse -ErrorAction SilentlyContinue |
        ForEach-Object { "$($_.FullName)  |  $($_.Length) bytes  |  creado $($_.CreationTime)" }
}

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
foreach ($c in @("$env:LOCALAPPDATA\ngrok\ngrok.yml", "C:\Calidad\Vanina\ngrok.yml", "C:\Calidad\Volkswagen\ngrok.yml", "$env:APPDATA\ngrok\ngrok.yml")) {
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
foreach ($d in @("C:\Calidad\Vanina\scripts\windows", "C:\Calidad\Volkswagen\scripts\windows")) {
    if (-not (Test-Path $d)) { continue }
    Agregar "  -- $d --"
    Intentar "archivos .vbs" { Get-ChildItem $d -Filter *.vbs -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Name)  ($($_.Length) bytes, $($_.LastWriteTime))" } }
    Intentar "politica de ejecucion del usuario" { Get-ExecutionPolicy -Scope CurrentUser }
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
$destino = Join-Path ([Environment]::GetFolderPath("Desktop")) "comparacion-$env:COMPUTERNAME.txt"
try {
    $salida | Set-Content -Path $destino -Encoding UTF8
    Write-Host ""
    Write-Host "  Informe guardado en:" -ForegroundColor Green
    Write-Host "     $destino" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Manda ESE archivo. No tiene contrasenas ni datos de clientes." -ForegroundColor Gray
} catch {
    Write-Host "  No pude guardar el archivo: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  Copiá y pegá lo que salió arriba." -ForegroundColor Yellow
}
Write-Host ""
Read-Host "Enter para cerrar"
