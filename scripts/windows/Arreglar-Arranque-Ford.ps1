# ============================================================================
#  Arreglar el arranque automatico de la PC de FORD
# ============================================================================
#  Doble clic en Arreglar-Arranque-Ford.bat, con la sesion de Yesica abierta y
#  SIN "Ejecutar como administrador" (un proceso elevado no llega a Docker).
#
#  POR QUE EXISTE. La PC de Volkswagen arranca sola y la de Ford dejo de hacerlo.
#  Las dos corren el mismo codigo; lo que cambia es COMO arranca cada una:
#
#    - Volkswagen: un acceso directo en Inicio + la clave Run del registro, que
#      lanzan vigilante-bucle.ps1 al iniciar sesion. Anda.
#    - Ford: tareas programadas. Una tarea puede quedar apuntando a un archivo que
#      ya no existe (el antivirus de esta PC ya se comio un .vbs del vigilante), y
#      en septiembre quedo en esta PC un contenedor del tunel que no arranca y que
#      hace que el vigilante nunca vuelva a lanzar el ngrok de siempre.
#
#  QUE HACE, en orden:
#    1. Revisa todo y lo anota (arranque-ford-<fecha>.txt, aca y en el Escritorio).
#    2. Si el contenedor del tunel existe PERO ESTA ROTO, lo saca. Si anda, no lo toca.
#    3. Le pone a esta PC el mismo arranque que ya funciona en Volkswagen.
#    4. Arranca el vigilante ahora mismo y espera a que el sistema y el tunel respondan.
#
#  Las tareas programadas que haya NO se borran: el vigilante tiene su propio
#  candado, asi que conviven sin pisarse.
# ============================================================================

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$ScriptDir  = $PSScriptRoot
$ProjectDir = Split-Path (Split-Path $ScriptDir -Parent) -Parent
$EnvFile    = Join-Path $ProjectDir ".env.prod"
$Bucle      = Join-Path $ScriptDir "vigilante-bucle.ps1"
$Contenedor = "calidad-tunel-ngrok"

$informe = New-Object System.Collections.Generic.List[string]
function Linea([string]$t, [string]$color = "Gray") { $informe.Add($t); Write-Host $t -ForegroundColor $color }
function Bien($t)   { Linea "  [OK]    $t" "Green" }
function Mal($t)    { Linea "  [MAL]   $t" "Red" }
function Aviso($t)  { Linea "  [OJO]   $t" "Yellow" }
function Info($t)   { Linea "          $t" "Gray" }
function Titulo($t) { Linea ""; Linea "== $t" "Cyan" }

# Guarda el informe SIEMPRE, tambien cuando corta antes de terminar: justamente
# esos son los casos que hay que poder mandar.
function Terminar([int]$codigo) {
    $nombre = "arranque-ford-$(Get-Date -Format 'yyyyMMdd-HHmm').txt"
    $bom = New-Object System.Text.UTF8Encoding $true
    foreach ($dest in @($ScriptDir, [Environment]::GetFolderPath("Desktop"))) {
        try { [System.IO.File]::WriteAllLines((Join-Path $dest $nombre), $informe, $bom) } catch { }
    }
    Write-Host ""
    Write-Host "          Informe guardado como $nombre (en esta carpeta y en el Escritorio)." -ForegroundColor Gray
    Write-Host ""
    Read-Host "Enter para cerrar" | Out-Null
    exit $codigo
}

function Leer([string]$clave, [string]$porDefecto = "") {
    if (-not (Test-Path $EnvFile)) { return $porDefecto }
    foreach ($linea in (Get-Content $EnvFile -ErrorAction SilentlyContinue)) {
        $l = "$linea".Trim()
        if ($l -eq "" -or $l.StartsWith("#")) { continue }
        $i = $l.IndexOf("=")
        if ($i -lt 1 -or $l.Substring(0, $i).Trim() -ne $clave) { continue }
        $v = $l.Substring($i + 1).Trim()
        if ($v.StartsWith("#")) { return $porDefecto }
        if ($v -match '^(.*?)\s+#') { $v = $matches[1].Trim() }
        if ($v -ne "") { return $v }
    }
    return $porDefecto
}

# Consultas a esta misma PC SIN proxy: en la red de la empresa el proxy se mete
# hasta en localhost y la respuesta da "no responde" con el sistema andando.
function Pedir([string]$url) {
    try {
        $req = [System.Net.HttpWebRequest]::Create($url)
        $req.Timeout = 6000
        $req.Proxy = $null
        $resp = $req.GetResponse()
        $lector = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $texto = $lector.ReadToEnd(); $lector.Close(); $resp.Close()
        return $texto
    } catch { return $null }
}

$marca   = (Leer "MARCA" "FORD").ToUpper()
$puerto  = Leer "HTTP_PORT" "80"
$dominio = Leer "NGROK_DOMAIN" "dealer-occupant-brigade.ngrok-free.dev"

function Sistema-Ok { $r = Pedir "http://127.0.0.1:$puerto/api/health"; return ($r -and $r -match '"status"\s*:\s*"ok"') }
function Tunel-Ok   { $r = Pedir "http://127.0.0.1:4040/api/tunnels"; return ($r -and $r -match [regex]::Escape($dominio)) }

Linea "Arreglo del arranque automatico - $(Get-Date -Format 'dd/MM/yyyy HH:mm')" "Cyan"
Info "PC: $env:COMPUTERNAME   usuario: $env:USERDOMAIN\$env:USERNAME"
Info "carpeta: $ProjectDir"
Info "version del sistema: $(((& git -C $ProjectDir rev-parse --short HEAD 2>$null) -join '').Trim())"

# ---------------------------------------------------------------- guardas ----
if (-not (Test-Path $EnvFile)) { Mal "No existe .env.prod en $ProjectDir. ¿Es la carpeta del sistema?"; Terminar 1 }
if ($marca -eq "VOLKSWAGEN" -or $marca -eq "VW") {
    Mal "Esta es la PC de VOLKSWAGEN. Este arreglo es solo para la de Ford (la de Volkswagen ya arranca sola)."
    Terminar 1
}
if (Test-Path (Join-Path $ProjectDir "SISTEMA-EN-SERVIDOR.txt")) {
    Mal "Existe SISTEMA-EN-SERVIDOR.txt: por ese archivo esta PC no levanta nada."
    Info "Si el sistema NO se mudo al servidor, borralo y volve a correr esto."
    Terminar 1
}
if (-not (Test-Path $Bucle)) {
    # Paso en la PC de Ford: el archivo faltaba y actualizar no lo traia. Git solo
    # repone lo que CAMBIA en la version nueva; un archivo borrado en la PC (a mano
    # o por el antivirus) queda borrado aunque se actualice mil veces.
    Aviso "Falta vigilante-bucle.ps1. Intento recuperarlo desde git..."
    $estadoGit = ((& git -C $ProjectDir status --short -- "scripts/windows/vigilante-bucle.ps1" 2>$null) -join " ").Trim()
    Info ("git dice: " + $(if ($estadoGit) { $estadoGit } else { "nada (esta version del sistema no lo tiene)" }))
    & git -C $ProjectDir checkout -- "scripts/windows/vigilante-bucle.ps1" 2>$null
    # Se espera antes de confirmar: si lo borra el antivirus, lo borra apenas
    # aparece, y conviene enterarse ahora y no despues de reiniciar.
    Start-Sleep -Seconds 10
    if (Test-Path $Bucle) {
        Bien "vigilante-bucle.ps1 recuperado, y sigue ahi."
    } else {
        Mal "No se pudo recuperar vigilante-bucle.ps1, o vuelve a desaparecer apenas se recupera."
        try {
            $det = @(Get-MpThreatDetection -ErrorAction Stop | Where-Object { ($_.Resources -join " ") -match "vigilante" })
            if ($det.Count -gt 0) {
                Mal "El antivirus (Defender) lo detecto $($det.Count) vez/veces. Ultima: $($det[-1].InitialDetectionTime)"
                Get-MpThreat -ErrorAction SilentlyContinue | Where-Object { ($_.Resources -join " ") -match "vigilante" } |
                    ForEach-Object { Info "   amenaza: $($_.ThreatName)" }
                Info "Hace falta que un administrador agregue una exclusion en Seguridad de Windows para:"
                Info "   $ProjectDir"
            } else {
                Info "Defender no registra haberlo borrado (o esta cuenta no puede ver ese historial)."
            }
        } catch { Info "No pude consultar el historial del antivirus desde esta cuenta." }
        Terminar 1
    }
}

# ------------------------------------------------------------ 1. revisar ----
Titulo "1. COMO ESTA HOY"

$politica = Get-ExecutionPolicy -Scope CurrentUser
Info "politica de ejecucion del usuario: $politica"

# Tareas programadas: todos los nombres que se usaron en algun momento.
$tareas = @("Sistema de Calidad - Vigilante", "Sistema Calidad - Vigilante", "Sistema de Calidad - ngrok", "Sistema de Calidad - actualizacion automatica")
$hayTareaVigilante = $false
foreach ($t in $tareas) {
    $xml = (& schtasks /query /TN "$t" /XML 2>$null) -join "`n"
    if ($LASTEXITCODE -ne 0 -or -not $xml) { Info "tarea '$t': no existe"; continue }
    $cmd  = if ($xml -match '<Command>(.*?)</Command>') { $matches[1] } else { "?" }
    $args2 = if ($xml -match '<Arguments>(.*?)</Arguments>') { [System.Net.WebUtility]::HtmlDecode($matches[1]) } else { "" }
    $user = if ($xml -match '<UserId>(.*?)</UserId>') { $matches[1] } else { "?" }
    Info "tarea '$t': existe, corre como $user"
    Info "   ejecuta: $cmd $args2"
    # ¿Apunta a un archivo que ya no esta? (el .vbs que se comio el antivirus)
    foreach ($m in [regex]::Matches("$cmd $args2", "[A-Za-z]:\\[^""']+?\.(ps1|vbs|bat|exe)")) {
        if (-not (Test-Path $m.Value)) { Mal "   la tarea '$t' apunta a un archivo que YA NO EXISTE: $($m.Value)" }
    }
    if ($t -like "*Vigilante") { $hayTareaVigilante = $true }
}

$inicio = Join-Path ([Environment]::GetFolderPath("Startup")) "Sistema de Calidad.lnk"
$claveRun = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
Info ("acceso directo en Inicio: " + $(if (Test-Path $inicio) { "SI" } else { "no" }))
Info ("entrada Run del registro: " + $(if (Get-ItemProperty $claveRun -Name "Sistema de Calidad" -ErrorAction SilentlyContinue) { "SI" } else { "no" }))

$bucleCorriendo = $false
try { $mx = [System.Threading.Mutex]::OpenExisting("Global\CalidadVigilanteBucle"); $mx.Dispose(); $bucleCorriendo = $true } catch { }
Info ("vigilante en bucle corriendo ahora: " + $(if ($bucleCorriendo) { "SI" } else { "no" }))

$motor = ((& docker version --format "{{.Server.Version}}" 2>$null) -join "").Trim()
if ($motor) { Bien "Docker responde (motor $motor)" } else { Aviso "Docker no responde ahora (el vigilante lo abre solo)" }

$estadoCont = ""
if ($motor) { $estadoCont = ((& docker ps -a --filter "name=$Contenedor" --format "{{.Status}}" 2>$null) | Select-Object -First 1) }
Info ("contenedor del tunel ($Contenedor): " + $(if ($estadoCont) { $estadoCont } else { "no existe" }))

$ng = Get-Process ngrok -ErrorAction SilentlyContinue | Select-Object -First 1
Info ("ngrok de Windows corriendo: " + $(if ($ng) { "SI ($($ng.Path))" } else { "no" }))

if (Sistema-Ok) { Bien "el sistema responde en el puerto $puerto" } else { Aviso "el sistema NO responde en el puerto $puerto" }
if (Tunel-Ok) { Bien "el tunel https://$dominio esta activo" } else { Aviso "el tunel https://$dominio NO esta activo" }

foreach ($log in @("vigilante.log", "vigilante-bucle.log")) {
    $p = Join-Path $ScriptDir $log
    if (Test-Path $p) {
        Info "ultimas lineas de ${log}:"
        Get-Content $p -Tail 12 -ErrorAction SilentlyContinue | ForEach-Object { Info "   $_" }
    }
}

# ------------------------------------------------------------ 2. tunel ----
Titulo "2. TUNEL"
if ($estadoCont -and ($estadoCont -notlike "Up*") -and -not (Tunel-Ok)) {
    # El vigilante ve el contenedor (aunque este parado), intenta revivirlo cada
    # 5 minutos y por eso nunca vuelve al ngrok de Windows, que es el de Ford.
    & docker rm -f $Contenedor 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { Bien "Saque el contenedor del tunel que no arrancaba: vuelve el ngrok de siempre." }
    else { Mal "No pude sacar el contenedor $Contenedor." }
} elseif ($estadoCont -like "Up*") {
    Bien "El contenedor del tunel esta andando: no se toca."
} else {
    Bien "No hay contenedor del tunel trabado."
}

# ---------------------------------------------------------- 3. arranque ----
Titulo "3. ARRANQUE (el mismo que usa Volkswagen)"
# RemoteSigned deja correr los scripts propios sin el -ExecutionPolicy Bypass,
# que es justo lo que el antivirus marca como sospechoso en un arranque. Es del
# usuario: no hace falta ser administrador.
$sinBypass = $politica -in @("RemoteSigned", "Unrestricted", "Bypass")
if (-not $sinBypass) {
    try { Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force -ErrorAction Stop; $sinBypass = $true; Bien "politica del usuario en RemoteSigned" }
    catch { Aviso "No pude cambiar la politica de ejecucion; se usa Bypass." }
}
$argsArranque = if ($sinBypass) { "-NoProfile -NonInteractive -WindowStyle Hidden -File `"$Bucle`"" }
                else { "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Bucle`"" }
$ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

# Dos caminos a la vez, como en Volkswagen: si el antivirus se lleva uno, queda el otro.
try {
    $lnk = (New-Object -ComObject WScript.Shell).CreateShortcut($inicio)
    $lnk.TargetPath = $ps; $lnk.Arguments = $argsArranque; $lnk.WorkingDirectory = $ScriptDir
    $lnk.WindowStyle = 7; $lnk.Description = "Levanta y repara el Sistema de Calidad cada 5 minutos."
    $lnk.Save()
} catch { Mal "No pude crear el acceso directo de Inicio: $($_.Exception.Message)" }
try {
    Set-ItemProperty -Path $claveRun -Name "Sistema de Calidad" -Value "`"$ps`" $argsArranque" -Force -ErrorAction Stop
} catch { Mal "No pude crear la entrada Run del registro: $($_.Exception.Message)" }

Start-Sleep -Seconds 2
$okLnk = Test-Path $inicio
$okRun = [bool](Get-ItemProperty $claveRun -Name "Sistema de Calidad" -ErrorAction SilentlyContinue)
if ($okLnk) { Bien "acceso directo en Inicio" } else { Mal "el acceso directo de Inicio no quedo (¿antivirus?)" }
if ($okRun) { Bien "entrada Run del registro" } else { Mal "la entrada Run del registro no quedo" }
if ($hayTareaVigilante) { Info "La tarea programada del vigilante sigue: convive con esto sin pisarse (tienen candado)." }
Info "Desde ahora esta PC tambien se actualiza sola a las 13:00, igual que la de Volkswagen."

# ---------------------------------------------------- 4. arrancar ya ----
Titulo "4. ARRANCANDO Y COMPROBANDO"
if (-not $bucleCorriendo) {
    Start-Process -FilePath $ps -ArgumentList $argsArranque -WindowStyle Hidden
    Info "vigilante arrancado (la primera pasada es a los 45 segundos)"
} else {
    Info "el vigilante ya estaba corriendo"
}
Info "esperando hasta 6 minutos a que respondan el sistema y el tunel..."
$limite = (Get-Date).AddMinutes(6)
$sis = $false; $tun = $false
while ((Get-Date) -lt $limite) {
    $sis = Sistema-Ok; $tun = Tunel-Ok
    if ($sis -and $tun) { break }
    Start-Sleep -Seconds 15
}
if ($sis) { Bien "el sistema responde" } else { Mal "el sistema todavia no responde" }
if ($tun) { Bien "el tunel https://$dominio esta activo" } else { Mal "el tunel todavia no esta activo" }

# ------------------------------------------------------------- informe ----
Titulo "RESULTADO"
if ($sis -and $tun -and ($okLnk -or $okRun)) {
    Linea "  LISTO. Para confirmarlo del todo: reiniciar la PC, iniciar sesion y esperar 3 minutos." "Green"
} else {
    Linea "  Quedo algo en rojo. Mandale este informe a Ignacio." "Yellow"
}
Terminar 0

