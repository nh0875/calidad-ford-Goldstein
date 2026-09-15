# ============================================================================
#  Diagnostico del tunel de ngrok en la PC de FORD
# ============================================================================
#  Doble clic en Diagnosticar-Ngrok-Ford.bat, con la sesion de Yesica abierta y
#  SIN "Ejecutar como administrador". Tarda unos 3 minutos.
#
#  POR QUE EXISTE. En Ford el link publico (el que usa Meta para mandar las
#  respuestas de WhatsApp) da ERR_NGROK_3200, "endpoint offline", aunque ngrok
#  aparece corriendo y localhost anda. El ngrok de Windows lo lanza la tarea
#  "Sistema de Calidad - ngrok" a traves de ngrok-oculto.vbs, OCULTO y SIN LOG:
#  si ngrok no logra conectarse, el motivo no queda escrito en ningun lado. Los
#  informes de Arreglar-Arranque-Ford solo podian decir "no responde".
#
#  QUE HACE:
#    1. Junta todo lo que no toca nada: procesos, tarea, .vbs, version de ngrok,
#       configuracion (el authtoken NUNCA se muestra), consola local, red, Docker.
#    2. Si el link publico YA anda, termina ahi: no se toca un tunel que funciona.
#    3. Si no anda, hace la PRUEBA EN VIVO: frena el ngrok de Windows, lo corre
#       con el mismo comando del .vbs pero CON LOG durante 45 segundos, anota el
#       error que da ngrok, y lo vuelve a lanzar con su tarea de siempre.
#
#  Es solo para Ford: se niega a correr en la PC de Volkswagen, que tiene su
#  tunel en un contenedor y no usa nada de esto.
#
#  El informe (ngrok-ford-<fecha>.txt, aca y en el Escritorio) se puede mandar
#  por chat: el authtoken se tapa en todo lo que se anota.
# ============================================================================

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$ScriptDir  = $PSScriptRoot
$ProjectDir = Split-Path (Split-Path $ScriptDir -Parent) -Parent
$EnvFile    = Join-Path $ProjectDir ".env.prod"
$EnvTunel   = Join-Path $ProjectDir ".env.tunel"
$Vbs        = Join-Path $ScriptDir "ngrok-oculto.vbs"
$TareaNgrok = "Sistema de Calidad - ngrok"

$informe = New-Object System.Collections.Generic.List[string]

# El authtoken de ngrok no puede terminar en un informe que se manda por chat.
# Se tapa lo que venga despues de "authtoken" y cualquier cosa con forma de token
# (dos tramos largos unidos por un guion bajo, que es como los arma ngrok).
function Tapar([string]$t) {
    if (-not $t) { return $t }
    $t = [regex]::Replace($t, '(?i)(authtoken["'']?\s*[:=]\s*["'']?)[^\s"'']+', '$1[TAPADO]')
    $t = [regex]::Replace($t, '[0-9A-Za-z]{20,}_[0-9A-Za-z]{10,}', '[TAPADO]')
    return $t
}
function Linea([string]$t, [string]$color = "Gray") { $t = Tapar $t; $informe.Add($t); Write-Host $t -ForegroundColor $color }
function Bien($t)   { Linea "  [OK]    $t" "Green" }
function Mal($t)    { Linea "  [MAL]   $t" "Red" }
function Aviso($t)  { Linea "  [OJO]   $t" "Yellow" }
function Info($t)   { Linea "          $t" "Gray" }
function Titulo($t) { Linea ""; Linea "== $t" "Cyan" }

$lock = Join-Path $env:TEMP "vigilante-calidad.lock"
$lockPropio = $false

# Candado del vigilante: el MISMO archivo que usa vigilante.ps1. Mientras exista y
# tenga menos de 20 minutos, cada pasada del vigilante sale sin hacer nada; asi no
# mata ni relanza ngrok en el medio de lo que hace este script.
function Tomar-Candado {
    $hasta = (Get-Date).AddMinutes(4)
    while ((Test-Path $lock) -and (((Get-Date) - (Get-Item $lock).LastWriteTime).TotalMinutes -lt 20) -and ((Get-Date) -lt $hasta)) {
        Info "hay una pasada del vigilante en curso: esperando..."
        Start-Sleep -Seconds 10
    }
    # Uno de 20 minutos o mas es de una pasada que murio (el vigilante lo borra igual).
    if ((Test-Path $lock) -and (((Get-Date) - (Get-Item $lock).LastWriteTime).TotalMinutes -ge 20)) {
        Remove-Item $lock -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path $lock) { Aviso "el vigilante sigue ocupado: se sigue igual (si toca ngrok en el medio, se nota abajo)"; return }
    New-Item -Path $lock -ItemType File -Force | Out-Null
    # Fechado 16 minutos atras: el vigilante lo respeta igual (menos de 20), pero si
    # esta ventana se cierra a mitad de camino, vence en 4 minutos y no en 20.
    try { (Get-Item $lock).LastWriteTime = (Get-Date).AddMinutes(-16) } catch { }
    $script:lockPropio = $true
}
function Soltar-Candado {
    if ($script:lockPropio) { Remove-Item $lock -Force -ErrorAction SilentlyContinue; $script:lockPropio = $false }
}

function Terminar([int]$codigo) {
    # El candado del vigilante se suelta SOLO si lo puso este script.
    Soltar-Candado
    $nombre = "ngrok-ford-$(Get-Date -Format 'yyyyMMdd-HHmm').txt"
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

function Leer-De([string]$archivo, [string]$clave, [string]$porDefecto = "") {
    if (-not (Test-Path $archivo)) { return $porDefecto }
    foreach ($linea in (Get-Content $archivo -ErrorAction SilentlyContinue)) {
        $l = "$linea".Trim()
        if ($l -eq "" -or $l.StartsWith("#")) { continue }
        $i = $l.IndexOf("=")
        if ($i -lt 1 -or $l.Substring(0, $i).Trim() -ne $clave) { continue }
        $v = $l.Substring($i + 1).Trim()
        if ($v.StartsWith("#")) { return $porDefecto }
        if ($v -match '^(.*?)\s+#') { $v = $matches[1].Trim() }
        # Compose acepta el valor entre comillas (MARCA="VOLKSWAGEN"): aca tambien.
        $v = $v.Trim('"').Trim("'").Trim()
        if ($v -ne "") { return $v }
    }
    return $porDefecto
}

# Consultas a esta misma PC SIN proxy (el proxy de la empresa se mete hasta en localhost).
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

$marca   = (Leer-De $EnvFile "MARCA" "FORD").ToUpper()
$puerto  = Leer-De $EnvFile "HTTP_PORT" "80"
$dominio = Leer-De $EnvFile "NGROK_DOMAIN" "dealer-occupant-brigade.ngrok-free.dev"

# El link PUBLICO, igual que lo ve Meta. Devuelve "ok" o el motivo corto.
function Publico-Una([bool]$conProxy) {
    try {
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
        $req = [System.Net.HttpWebRequest]::Create("https://$dominio/api/health")
        $req.Timeout = 12000
        $req.Headers.Add("ngrok-skip-browser-warning", "1")
        if ($conProxy) {
            $req.Proxy = [System.Net.WebRequest]::DefaultWebProxy
            if ($req.Proxy) { $req.Proxy.Credentials = [System.Net.CredentialCache]::DefaultCredentials }
        } else { $req.Proxy = $null }
        $resp = $req.GetResponse()
        $lector = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $texto = $lector.ReadToEnd(); $lector.Close(); $resp.Close()
        if ($texto -match '"status"\s*:\s*"ok"') { return "ok" }
        return "responde pero sin status ok"
    } catch [System.Net.WebException] {
        $r = $_.Exception.Response
        if ($r) {
            $cuerpo = ""
            try { $lector = New-Object System.IO.StreamReader($r.GetResponseStream()); $cuerpo = $lector.ReadToEnd(); $lector.Close() } catch { }
            $cod = if ($cuerpo -match '(ERR_NGROK_\d+)') { " $($matches[1])" } else { "" }
            return "HTTP $([int]$r.StatusCode)$cod"
        }
        return "sin respuesta ($($_.Exception.Status))"
    } catch { return "error: $($_.Exception.Message)" }
}
# Primero por el proxy de la empresa. Si ni siquiera llega a ngrok (sin codigo
# HTTP), se prueba directo: un proxy que bloquea ngrok no es un tunel caido, y
# no hay que hacer la prueba en vivo por eso.
function Publico {
    $r = Publico-Una $true
    if ($r -eq "ok" -or $r -like "HTTP*") { return $r }
    $d = Publico-Una $false
    if ($d -eq "ok") { return "ok" }
    return "$r (y directo: $d)"
}

# Que significa cada codigo que puede aparecer. Solo los que estan documentados
# por ngrok; un codigo que no este aca se anota igual, crudo.
$Significado = @{
    "ERR_NGROK_3200" = "el dominio existe pero no hay ningun ngrok conectado del otro lado (endpoint offline)"
    "ERR_NGROK_108"  = "la cuenta de ngrok ya tiene el maximo de agentes conectados (otra PC, el contenedor, u otro ngrok en esta PC)"
    "ERR_NGROK_334"  = "el dominio ya esta tomado por otro agente. Si justo se freno otro ngrok, puede ser su sesion, que ngrok todavia no solto"
    "ERR_NGROK_4018" = "ngrok no tiene authtoken cargado"
    "ERR_NGROK_105"  = "el authtoken cargado no tiene formato de authtoken"
    "ERR_NGROK_107"  = "el authtoken es invalido: se reseteo o se revoco en el panel de ngrok"
    "ERR_NGROK_320"  = "el dominio es de OTRA cuenta de ngrok: el authtoken cargado no es el de Ford"
    "ERR_NGROK_121"  = "esta version de ngrok es demasiado vieja: ngrok ya no la deja conectar"
    "ERR_NGROK_9009" = "ngrok encontro un proxy configurado, y usar proxy es de pago"
    "ERR_NGROK_8012" = "el tunel anda pero no llega al sistema en localhost"
    "ERR_NGROK_725"  = "se agoto el ancho de banda del mes del plan gratis"
}

# Fin de vida de cada version de ngrok 3 (ngrok.com/docs/agent/version-support-policy,
# leido el 15-09-2026). Al vencer, el agente "no se puede conectar mas" en cuentas gratis.
$Vence = @{ 23 = "2026-08-26"; 24 = "2026-09-17"; 25 = "2026-10-01"; 26 = "2026-10-07"; 27 = "2026-10-28"; 39 = "2027-06-28" }

Linea "Diagnostico del tunel de ngrok - $(Get-Date -Format 'dd/MM/yyyy HH:mm')" "Cyan"
Info "PC: $env:COMPUTERNAME   usuario: $env:USERDOMAIN\$env:USERNAME"
Info "carpeta: $ProjectDir"
Info "version del sistema: $(((& git -C $ProjectDir rev-parse --short HEAD 2>$null) -join '').Trim())"
Info "dominio: $dominio   puerto: $puerto"

# ---------------------------------------------------------------- guardas ----
if (-not (Test-Path $EnvFile)) { Mal "No existe .env.prod en $ProjectDir."; Terminar 1 }
# Dos senales independientes, a proposito: si una falla (un .env.prod escrito
# distinto), la otra frena igual. En Volkswagen este script borraria su tunel.
if ($marca -match 'VOLKSWAGEN|^VW$' -or $ProjectDir -match 'Volkswagen') {
    Mal "Esta es la PC de VOLKSWAGEN. Este diagnostico es solo para la de Ford."
    Terminar 1
}
if (Test-Path (Join-Path $ProjectDir "SISTEMA-EN-SERVIDOR.txt")) {
    Mal "Existe SISTEMA-EN-SERVIDOR.txt: esta PC ya no deberia tener tunel."
    Terminar 1
}

$publicoAntes = Publico
if ($publicoAntes -eq "ok") { Bien "link publico AHORA: responde" } else { Mal "link publico AHORA: $publicoAntes" }
if (Pedir "http://127.0.0.1:$puerto/api/health") { Bien "el sistema responde en localhost:$puerto" } else { Mal "el sistema NO responde en localhost:$puerto (sin eso el tunel no tiene a donde llegar)" }

# ------------------------------------------------------- 1. procesos ----
Titulo "1. QUE NGROK ESTA CORRIENDO"
$procs = @(Get-Process ngrok -ErrorAction SilentlyContinue)
if ($procs.Count -eq 0) { Aviso "no hay ningun proceso ngrok" }
foreach ($p in $procs) {
    # StartTime de un proceso de otra cuenta tira "acceso denegado"; la sesion 0 es la
    # de los servicios (un ngrok ahi es el servicio de Windows, no la tarea).
    $desdeP = try { $p.StartTime } catch { "?" }
    $sesion = if ($p.SessionId -eq 0) { "sesion 0 = SERVICIO" } else { "sesion $($p.SessionId)" }
    Info "ngrok PID $($p.Id) ($sesion): $($p.Path)   desde $desdeP"
}
if ($procs.Count -gt 1) { Aviso "hay $($procs.Count) ngrok a la vez: con la cuenta gratis se pelean por el dominio" }
try {
    Get-CimInstance Win32_Process -Filter "Name='ngrok.exe' OR Name='wscript.exe'" -OperationTimeoutSec 10 -ErrorAction Stop |
        ForEach-Object { Info "   linea de comando ($($_.Name) PID $($_.ProcessId)): $($_.CommandLine)" }
} catch { Info "   (no pude leer las lineas de comando: $($_.Exception.Message))" }

# El 30-07 se instalo en esta PC ngrok como SERVICIO de Windows
# ("ngrok service install --config C:\ngrok\ngrok.yml") y no hay registro de que
# se haya sacado. Corre como SYSTEM: esta cuenta no lo puede frenar, y seria un
# segundo agente peleando por la misma cuenta y el mismo dominio.
try {
    $servicios = @(Get-CimInstance Win32_Service -Filter "Name LIKE '%ngrok%' OR PathName LIKE '%ngrok%'" -OperationTimeoutSec 10 -ErrorAction Stop)
    if ($servicios.Count -eq 0) { Bien "no hay servicio de Windows de ngrok" }
    foreach ($sv in $servicios) {
        Mal "HAY un servicio de Windows de ngrok: $($sv.Name) estado=$($sv.State) inicio=$($sv.StartMode) cuenta=$($sv.StartName)"
        Info "   $($sv.PathName)"
    }
} catch {
    $sc = ((& sc.exe query state= all 2>$null) | Select-String -Pattern 'ngrok' | ForEach-Object { "$_".Trim() }) -join " | "
    if ($sc) { Mal "HAY un servicio de Windows de ngrok: $sc" } else { Info "no pude listar servicios con CIM; sc.exe no muestra ninguno de ngrok" }
}

# ---------------------------------------------------- 2. el lanzador ----
Titulo "2. COMO SE LANZA (tarea + .vbs)"
$xml = (& schtasks /query /TN "$TareaNgrok" /XML 2>$null) -join "`n"
$hayTarea = ($LASTEXITCODE -eq 0 -and $xml)
if ($hayTarea) {
    foreach ($campo in @("Command", "Arguments", "UserId", "LogonType", "RunLevel", "MultipleInstancesPolicy", "Enabled", "Interval", "ExecutionTimeLimit", "StartBoundary")) {
        foreach ($m in [regex]::Matches($xml, "<$campo>(.*?)</$campo>")) { Info "tarea ${campo}: $([System.Net.WebUtility]::HtmlDecode($m.Groups[1].Value))" }
    }
    foreach ($t in @("LogonTrigger", "TimeTrigger", "CalendarTrigger", "BootTrigger")) { if ($xml -match "<$t") { Info "tarea disparador: $t" } }
    try {
        # CSV sin encabezado: las columnas van siempre en el mismo orden, sea
        # Windows en castellano o en ingles.
        $fila = (& schtasks /query /TN "$TareaNgrok" /V /FO CSV /NH 2>$null) | Select-Object -First 1
        $c = $fila | ConvertFrom-Csv -Header @("Host", "Nombre", "Proxima", "Estado", "Modo", "Ultima", "Resultado")
        Info "tarea estado: $($c.Estado)   ultima corrida: $($c.Ultima)   proxima: $($c.Proxima)"
        $res = "$($c.Resultado)".Trim()
        $explica = switch ($res) {
            "0"           { "termino bien" }
            "267009"      { "esta corriendo ahora (0x41301)" }
            "267011"      { "nunca corrio (0x41303)" }
            "-2147024671" { "el ANTIVIRUS bloqueo lo que lanza (0x800700E1)" }
            default       { "" }
        }
        Info "tarea ultimo resultado: $res $explica"
    } catch { Info "no pude leer el estado de la tarea" }
} else {
    Mal "no existe la tarea '$TareaNgrok'"
}

$exeVbs = $null
if (Test-Path $Vbs) {
    Bien "ngrok-oculto.vbs existe (modificado $((Get-Item $Vbs).LastWriteTime))"
    Get-Content $Vbs -ErrorAction SilentlyContinue | ForEach-Object { Info "   | $_" }
    $textoVbs = (Get-Content $Vbs -Raw -ErrorAction SilentlyContinue)
    if ($textoVbs -match '([A-Za-z]:\\[^"]+?\.exe)') {
        $exeVbs = $matches[1]
        if (Test-Path $exeVbs) { Bien "el .exe que lanza el .vbs existe: $exeVbs" } else { Mal "el .vbs lanza un ngrok.exe que YA NO EXISTE: $exeVbs" }
    }
    if ($textoVbs -notmatch [regex]::Escape($dominio)) { Mal "el .vbs NO usa el dominio del .env.prod ($dominio)" }
} else {
    Mal "no existe ngrok-oculto.vbs (la tarea no tiene que lanzar)"
}
foreach ($raiz in @("HKCU:", "HKLM:")) {
    $wsh = Get-ItemProperty "$raiz\Software\Microsoft\Windows Script Host\Settings" -Name Enabled -ErrorAction SilentlyContinue
    if ($wsh -and "$($wsh.Enabled)" -eq "0") { Mal "Windows Script Host esta DESACTIVADO en $raiz (wscript no corre ningun .vbs)" }
}

$logVig = Join-Path $ScriptDir "vigilante.log"
if (Test-Path $logVig) {
    Info "lo ultimo que anoto el vigilante sobre el tunel:"
    Select-String -Path $logVig -Pattern 'ngrok|tunel|Todo en orden' -ErrorAction SilentlyContinue |
        Select-Object -Last 12 | ForEach-Object { Info "   $($_.Line)" }
}
# El error del 02-09: con ".Content" el vigilante veia SIEMPRE el tunel caido y
# mataba ngrok cada 5 minutos. Si esta PC todavia tiene esa version, es la causa.
if (Select-String -Path (Join-Path $ScriptDir "vigilante.ps1") -Pattern 'return \(\$r\.Content -match' -Quiet -ErrorAction SilentlyContinue) {
    Mal "vigilante.ps1 es la version con el error que mata ngrok cada 5 minutos: correr Actualizar-AHORA.bat"
} else {
    Bien "vigilante.ps1 ya tiene el arreglo del chequeo del tunel"
}

# ------------------------------------------------------ 3. ejecutables ----
Titulo "3. NGROK.EXE Y SU VERSION"
$candidatos = @($exeVbs, "C:\ngrok\ngrok.exe",
    "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe",
    "$env:ProgramFiles\ngrok\ngrok.exe", "$env:LOCALAPPDATA\ngrok\ngrok.exe",
    (Join-Path $ProjectDir "ngrok.exe"), (Join-Path $ProjectDir "ngrok\ngrok.exe"))
$candidatos += @(Get-Command ngrok -All -ErrorAction SilentlyContinue | ForEach-Object { $_.Source })
$exes = @($candidatos | Where-Object { $_ -and (Test-Path $_) } | ForEach-Object { (Resolve-Path $_).Path } | Sort-Object -Unique)
if ($exes.Count -eq 0) { Mal "no encontre ningun ngrok.exe" }
foreach ($e in $exes) {
    $ver = ((& $e version 2>&1) -join " ").Trim()
    $item = Get-Item $e
    Info "$e"
    Info "   $ver   ($([math]::Round($item.Length / 1MB, 1)) MB, fecha del archivo $($item.LastWriteTime.ToString('dd/MM/yyyy')))"
    if ($ver -match 'version 3\.(\d+)\.') {
        $menor = [int]$matches[1]
        if ($menor -le 22) { Mal "   ngrok 3.$menor ya esta VENCIDA: ngrok no la deja conectar. Hay que actualizarla." }
        elseif ($Vence.ContainsKey($menor)) {
            $fecha = [datetime]::ParseExact($Vence[$menor], "yyyy-MM-dd", $null)
            if ($fecha -le (Get-Date)) { Mal "   ngrok 3.$menor VENCIO el $($fecha.ToString('dd/MM/yyyy')): ngrok ya no la deja conectar. Hay que actualizarla." }
            elseif (($fecha - (Get-Date)).TotalDays -lt 45) { Aviso "   ngrok 3.$menor vence el $($fecha.ToString('dd/MM/yyyy')): ese dia deja de conectar. Actualizarla antes." }
            else { Bien "   ngrok 3.$menor vence el $($fecha.ToString('dd/MM/yyyy'))" }
        } else { Info "   ngrok 3.${menor}: su vencimiento esta en https://ngrok.com/docs/agent/version-support-policy" }
    } elseif ($ver -match 'version 2\.') { Mal "   ngrok 2: hace rato que no conecta. Hay que instalar ngrok 3." }
}

# -------------------------------------------------- 4. configuracion ----
Titulo "4. CONFIGURACION DE NGROK (el authtoken nunca se muestra)"
$tokenTunel = Leer-De $EnvTunel "NGROK_AUTHTOKEN" ""
$tokenTxt = ""
$archTok = Join-Path $ScriptDir "ngrok-token.txt"
if (Test-Path $archTok) { $tokenTxt = ((Get-Content $archTok -Raw -ErrorAction SilentlyContinue) -replace '\s', '') }
Info ("ngrok-token.txt (el del instalador): " + $(if ($tokenTxt) { "existe" } else { "no existe" }))
Info (".env.tunel (lo crea Instalar-Tunel-Docker): " + $(if (Test-Path $EnvTunel) { "EXISTE en esta PC" } else { "no existe" }))
foreach ($ambito in @("User", "Machine", "Process")) {
    foreach ($var in @("NGROK_AUTHTOKEN", "NGROK_CONFIG", "HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY")) {
        $v = [Environment]::GetEnvironmentVariable($var, $ambito)
        if ($v) { Aviso "variable de entorno $var ($ambito) definida$(if ($var -notlike '*TOKEN*') { ": $v" })" }
    }
}
$ymls = @("$env:LOCALAPPDATA\ngrok\ngrok.yml", "$env:APPDATA\ngrok\ngrok.yml", "$env:USERPROFILE\.config\ngrok\ngrok.yml",
          "$env:USERPROFILE\.ngrok2\ngrok.yml", (Join-Path $ProjectDir "ngrok.yml"), "C:\ngrok\ngrok.yml") | Sort-Object -Unique
$tokens = @{}
foreach ($y in $ymls) {
    if (-not (Test-Path $y)) { continue }
    Info "$y   (modificado $((Get-Item $y).LastWriteTime))"
    foreach ($l in (Get-Content $y -ErrorAction SilentlyContinue)) {
        if ("$l" -match '^\s*authtoken\s*:\s*["'']?([^"''\s]+)') {
            $tok = $matches[1]; $tokens[$y] = $tok
            $igual = if ($tokenTunel) { $(if ($tok -eq $tokenTunel) { ", IGUAL al de .env.tunel (misma cuenta que el contenedor)" } else { ", DISTINTO al de .env.tunel" }) } else { "" }
            if ($tokenTxt) { $igual += $(if ($tok -eq $tokenTxt) { ", IGUAL al de ngrok-token.txt" } else { ", DISTINTO al de ngrok-token.txt" }) }
            Info "   token cargado: si ($($tok.Length) caracteres$igual)"
        } elseif ("$l".Trim() -and -not "$l".Trim().StartsWith("#")) {
            Info "   | $l"
        }
    }
}
if ($tokens.Count -eq 0) { Mal "ningun ngrok.yml tiene authtoken" }
if (($tokens.Values | Sort-Object -Unique).Count -gt 1) { Aviso "hay ngrok.yml con authtokens DISTINTOS: el que vale depende de cual lea ngrok" }
if ($exes.Count -gt 0) {
    $chk = ((& $exes[0] config check 2>&1) -join " ").Trim()
    Info "ngrok config check: $chk"
}

# ---------------------------------------------------- 5. consola local ----
Titulo "5. CONSOLA LOCAL DE NGROK (4040 y siguientes)"
$escuchas = @(& netstat -ano -p tcp 2>$null | Select-String ':404[0-9]\s+\S+\s+(LISTENING|ESCUCHANDO)')
if ($escuchas.Count -eq 0) { Info "nadie escucha en 4040-4049" }
foreach ($e in $escuchas) {
    $partes = ("$e".Trim() -split '\s+')
    $pid2 = $partes[-1]
    $quien = (Get-Process -Id $pid2 -ErrorAction SilentlyContinue).ProcessName
    Info "escucha $($partes[1]) -> PID $pid2 ($quien)"
}
foreach ($pt in 4040..4043) {
    # /api/status es el que dice si la sesion con ngrok esta "online" (probado con
    # ngrok 3.39: sin sesion da "reconnecting" y /api/tunnels vacio). /api/tunnels solo
    # lista tuneles; con el contenedor vivo, el 4040 podia ser de OTRO agente (asi
    # engano a los informes anteriores).
    $st = Pedir "http://127.0.0.1:$pt/api/status"
    if ($st) {
        $estado = if ($st -match '"status"\s*:\s*"([^"]+)"') { $matches[1] } else { "(sin campo status)" }
        if ($estado -eq "online") { Bien "consola ${pt}: sesion con ngrok ONLINE" } else { Mal "consola ${pt}: sesion con ngrok = $estado" }
        Info "   $(if ($st.Length -gt 400) { $st.Substring(0, 400) + '...' } else { $st })"
    }
    $r = Pedir "http://127.0.0.1:$pt/api/tunnels"
    if (-not $r) { continue }
    try {
        $tuneles = @(($r | ConvertFrom-Json).tunnels)
        if ($tuneles.Count -eq 0) { Aviso "consola $pt responde SIN tuneles (ngrok arranco pero no conecto)" }
        foreach ($t in $tuneles) { Info "consola ${pt}: $($t.public_url) -> $($t.config.addr)" }
    } catch { Info "consola ${pt}: $r" }
}

# ------------------------------------------------------------- 6. red ----
Titulo "6. RED HACIA NGROK"
foreach ($h in @("connect.ngrok-agent.com", "tunnel.us.ngrok.com")) {
    try {
        $ips = @([System.Net.Dns]::GetHostAddresses($h) | ForEach-Object { $_.IPAddressToString })
        $tcp = New-Object System.Net.Sockets.TcpClient
        $intento = $tcp.BeginConnect($ips[0], 443, $null, $null)
        $conecta = $intento.AsyncWaitHandle.WaitOne(6000) -and $tcp.Connected
        $tcp.Close()
        if ($conecta) { Bien "$h ($($ips[0])) puerto 443: conecta directo" } else { Mal "$h ($($ips[0])) puerto 443: NO conecta directo (firewall, o la red exige proxy)" }
    } catch { Mal "${h}: $($_.Exception.Message)" }
}
if ($exes.Count -gt 0) {
    $dx = Join-Path $env:TEMP "ngrok-diagnose.txt"
    Remove-Item $dx, "$dx.err" -Force -ErrorAction SilentlyContinue
    try {
        $pd = Start-Process -FilePath $exes[0] -ArgumentList @("diagnose") -NoNewWindow -PassThru `
            -RedirectStandardOutput $dx -RedirectStandardError "$dx.err" -ErrorAction Stop
        if (-not $pd.WaitForExit(45000)) { $pd.Kill(); Aviso "ngrok diagnose no termino en 45 segundos" }
        Start-Sleep -Seconds 1
        foreach ($f in @($dx, "$dx.err")) {
            Get-Content $f -ErrorAction SilentlyContinue | Where-Object { "$_".Trim() } | Select-Object -First 30 |
                ForEach-Object { Info "   diagnose | $_" }
        }
    } catch { Info "ngrok diagnose: $($_.Exception.Message)" }
}
$ie = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings" -ErrorAction SilentlyContinue
Info "proxy de Windows del usuario: habilitado=$($ie.ProxyEnable) servidor=$($ie.ProxyServer) script=$($ie.AutoConfigURL)"
Info "proxy WinHTTP: $(((& netsh winhttp show proxy 2>$null) | Where-Object { "$_".Trim() }) -join ' | ')"

# ---------------------------------------------------------- 7. docker ----
Titulo "7. OTROS NGROK (Docker)"
$filas = @(& docker ps -a --format "{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}" 2>$null | Where-Object { "$_" -match 'ngrok' })
if ($filas.Count -eq 0) { Bien "no hay contenedores de ngrok" } else { foreach ($f in $filas) { Aviso "contenedor: $f" } }

# ------------------------------------------------------- 8. antivirus ----
# Solo una LECTURA del registro de eventos, a proposito: nada de los comandos
# propios del antivirus. Un script que los mezcla con cerrar procesos a la
# fuerza Defender lo toma por malware que intenta apagarlo, y se lo come entero
# (paso el 15-09 en la PC de desarrollo con un texto parecido a este).
Titulo "8. ANTIVIRUS (registro de eventos, ultimos 30 dias)"
Info ("vigilante-bucle.ps1: " + $(if (Test-Path (Join-Path $ScriptDir "vigilante-bucle.ps1")) { "esta" } else { "NO esta" }))
try {
    $ev = @(Get-WinEvent -FilterHashtable @{ LogName = "Microsoft-Windows-Windows Defender/Operational"; Id = 1006, 1007, 1015, 1116, 1117, 1118, 1119, 1121, 1122; StartTime = (Get-Date).AddDays(-30) } -MaxEvents 30 -ErrorAction Stop)
    foreach ($e in $ev) {
        # Por posicion y no por el texto del mensaje: en Windows en castellano el
        # texto del 1117 sale ilegible. Posiciones comprobadas en 1116 y 1117 (42
        # campos): 7 amenaza, 17 origen, 18 proceso, 21 ruta, 30 accion.
        $pr = $e.Properties
        if ($pr.Count -ge 31 -and $e.Id -ge 1116 -and $e.Id -le 1119) {
            Info "evento $($e.Id) $($e.TimeCreated.ToString('dd/MM HH:mm:ss')): $($pr[7].Value) | accion: $($pr[30].Value) | origen: $($pr[17].Value)"
            Info "   ruta: $($pr[21].Value)"
            Info "   proceso: $($pr[18].Value)"
        } else {
            Info "evento $($e.Id) $($e.TimeCreated.ToString('dd/MM HH:mm:ss')): $((($e.Message -split "`n") | Select-Object -First 3 | ForEach-Object { $_.Trim() }) -join ' ; ')"
        }
    }
} catch {
    if ("$($_.Exception.Message)" -match 'No se encontraron|No events') { Bien "Defender no registro detecciones en 30 dias" }
    else { Info "registro de Defender: $($_.Exception.Message)" }
}

# --------------------------------------------------- 9. prueba en vivo ----
Titulo "9. PRUEBA EN VIVO"
if ($publicoAntes -eq "ok") {
    Bien "El link publico anda: no se hace la prueba (no se toca un tunel que funciona)."
    Titulo "RESULTADO"
    Linea "  El tunel anda en este momento. Si vuelve a caerse, correr esto de nuevo EN ESE MOMENTO." "Green"
    Terminar 0
}
# La prueba solo sirve para ERR_NGROK_3200, "no hay ningun ngrok conectado". Con
# otra respuesta (8012 o 502/503: el sistema; 403/407: un proxy; sin respuesta: la
# red) frenar ngrok no prueba nada, corta un tunel que puede estar andando y el
# informe terminaria culpando a ngrok.
if ($publicoAntes -notmatch 'ERR_NGROK_3200') {
    Aviso "No se hace la prueba: el link respondio '$publicoAntes', que no es 'no hay ngrok conectado'. ngrok no se toca."
    if ($publicoAntes -match 'ERR_NGROK_8012|^HTTP 50[234]') { Info "Eso apunta al sistema en localhost:$puerto, no al tunel: Arreglar-Arranque-Ford.bat." }
    elseif ($publicoAntes -notlike "HTTP*") { Info "Ni por el proxy ni directo se llega a ngrok: es la red de esta PC (ver la seccion 6)." }
    else { Info "Puede ser el proxy de la empresa: probar el link desde un celular con datos moviles." }
    Titulo "RESULTADO"
    Linea "  El tunel no aparece caido: el problema esta en otro lado (arriba). Mandale este informe a Ignacio." "Yellow"
    Terminar 0
}
if (-not (Pedir "http://127.0.0.1:$puerto/api/health")) {
    Mal "El sistema no responde en localhost:${puerto}: asi la prueba no puede dar bien. Primero Arreglar-Arranque-Ford.bat."
    Terminar 1
}
if (($servicios.Count -gt 0) -or $sc) {
    Mal "No se hace la prueba: hay un servicio de Windows de ngrok (corre como SYSTEM) y esta cuenta no lo puede frenar."
    Info "Lo saca Ignacio, en PowerShell COMO ADMINISTRADOR:"
    Info "   C:\ngrok\ngrok.exe service stop"
    Info "   C:\ngrok\ngrok.exe service uninstall"
    Terminar 1
}
$exePrueba = if ($exeVbs -and (Test-Path $exeVbs)) { $exeVbs } elseif ($exes.Count -gt 0) { $exes[0] } else { $null }
if (-not $exePrueba) { Mal "No hay ngrok.exe con que probar."; Terminar 1 }
Info "se prueba con: $exePrueba"

$ajenos = @()
$publicoPrueba = "no se pudo probar"
$pruebaInvalida = $false
# Con el candado del vigilante: si una pasada cae en el medio, veria el tunel
# caido y mataria el ngrok de prueba.
Tomar-Candado
try {
    $previos = @(Get-Process ngrok -ErrorAction SilentlyContinue)
    if ($previos.Count -gt 0) {
        $previos | Stop-Process -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 3
        $quedan = @(Get-Process ngrok -ErrorAction SilentlyContinue)
        if ($quedan.Count -gt 0) {
            $ajenos = @($quedan | ForEach-Object { $_.Id })
            Mal "no pude frenar el ngrok que corria (PID $($ajenos -join ',')): lo lanzo otra cuenta"
        } else { Info "frene el ngrok de Windows ($($previos.Count) proceso/s)" }
        # Sin esta espera, la prueba puede chocar con la sesion recien cortada
        # (ERR_NGROK_334) y parecer un problema que no es.
        Info "espero 20 segundos a que ngrok suelte la sesion anterior..."
        Start-Sleep -Seconds 20
        # La tarea de ngrok se repite cada 5 minutos y el candado del vigilante NO la
        # frena: si la repeticion cayo en la espera, se frena ese ngrok tambien. La
        # siguiente queda a unos 5 minutos, lejos de los 45 segundos de la prueba.
        $relanzados = @(Get-Process ngrok -ErrorAction SilentlyContinue | Where-Object { $ajenos -notcontains $_.Id })
        if ($relanzados.Count -gt 0) {
            Info "la tarea lo relanzo durante la espera (PID $($relanzados.Id -join ',')): lo freno de nuevo y espero otros 20 segundos"
            $relanzados | Stop-Process -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 20
        }
    }

    $salida  = Join-Path $env:TEMP "ngrok-prueba-salida.txt"
    $errores = Join-Path $env:TEMP "ngrok-prueba-errores.txt"
    Remove-Item $salida, $errores -Force -ErrorAction SilentlyContinue
    # El MISMO comando que lanza el .vbs, sacado del .vbs para no suponer flags que
    # la version de ngrok de esta PC no tenga, mas el registro. OJO: ngrok 3.39 NO
    # tiene --web-addr: da "unknown flag" y se cierra al instante (probado).
    $argsBase = "http --domain=$dominio $puerto"
    if ($textoVbs -and $textoVbs -match '\.exe""?\s+([^"\r\n]+?)"\s*,') { $argsBase = $matches[1].Trim() }
    Info "argumentos (los del .vbs): $argsBase"
    $argsPrueba = @($argsBase -split '\s+' | Where-Object { $_ }) + @("--log=stdout", "--log-format=logfmt", "--log-level=info")
    $prueba = $null
    try {
        $prueba = Start-Process -FilePath $exePrueba -ArgumentList $argsPrueba -NoNewWindow -PassThru `
            -RedirectStandardOutput $salida -RedirectStandardError $errores -ErrorAction Stop
    } catch { Mal "no pude lanzar ngrok: $($_.Exception.Message)" }

    if ($prueba) {
        # Leer el Handle ya: sin eso, en PowerShell 5.1 ExitCode sale vacio si el
        # proceso termina antes de que alguien lo mire.
        $null = $prueba.Handle
        Info "ngrok de prueba lanzado (PID $($prueba.Id)); esperando hasta 45 segundos..."
        $limite = (Get-Date).AddSeconds(45)
        while ((Get-Date) -lt $limite) {
            Start-Sleep -Seconds 5
            if ($prueba.HasExited) { break }
            $publicoPrueba = Publico
            if ($publicoPrueba -eq "ok") { break }
        }
        if ($prueba.HasExited) {
            Mal "el ngrok de prueba SE CERRO SOLO (codigo $($prueba.ExitCode)): no pudo arrancar"
            $publicoPrueba = "ngrok se cerro"
        }
        # Otro ngrok de ESTA cuenta que nacio durante la prueba (la repeticion de 5
        # minutos de la tarea): la prueba se choco con el y lo que dijo ngrok no vale.
        $otros = @(Get-Process ngrok -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $prueba.Id -and $ajenos -notcontains $_.Id })
        if ($otros.Count -gt 0) {
            Aviso "durante la prueba aparecio OTRO ngrok (PID $($otros.Id -join ',')): la prueba se choco con el y NO VALE. Correr esto de nuevo."
            $pruebaInvalida = $true
        }
        if (-not $prueba.HasExited) { Stop-Process -Id $prueba.Id -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 2

        if ($publicoPrueba -eq "ok") { Bien "con el ngrok de prueba el link publico RESPONDE" } else { Mal "con el ngrok de prueba el link publico: $publicoPrueba" }

        $log = @()
        foreach ($f in @($salida, $errores)) { if (Test-Path $f) { $log += @(Get-Content $f -ErrorAction SilentlyContinue) } }
        Info "lo que dijo ngrok ($($log.Count) lineas; se muestran las importantes):"
        $importantes = @($log | Where-Object { $_ -match 'lvl=(eror|crit|warn)|err=|ERR_NGROK|ERROR|unknown flag|session established|started tunnel|authentication|version|failed|denied|refused|timeout|proxy' })
        if ($importantes.Count -eq 0) { $importantes = @($log | Select-Object -Last 25) }
        $importantes | Select-Object -First 40 | ForEach-Object { Info "   $_" }
        $codigos = @([regex]::Matches(($log -join "`n"), 'ERR_NGROK_\d+') | ForEach-Object { $_.Value } | Sort-Object -Unique)
        foreach ($c in $codigos) {
            $sig = $Significado[$c]
            if ($pruebaInvalida) { Info "$c (no se interpreta: la prueba se choco con otro ngrok)" }
            elseif ($sig) { Mal "$c = $sig" }
            else { Aviso "$c (buscarlo en https://ngrok.com/docs/errors/)" }
        }
    }

    # -------------------------------------- 10. volver a lo de siempre ----
    Titulo "10. VOLVIENDO A LANZAR NGROK COMO SIEMPRE"
    # Los ngrok de otra cuenta (un servicio) no cuentan: el que freno este script
    # es el de la tarea, y ese hay que devolverlo.
    $vivos = @(Get-Process ngrok -ErrorAction SilentlyContinue | Where-Object { $ajenos -notcontains $_.Id })
    if ($vivos.Count -eq 0) {
        Info "espero 20 segundos a que ngrok suelte la sesion de la prueba..."
        Start-Sleep -Seconds 20
        if ($hayTarea) {
            $dijo = ((& schtasks /run /TN "$TareaNgrok" 2>&1) -join " ").Trim()
            Info "lance la tarea '$TareaNgrok': $dijo"
        } elseif ($exePrueba) {
            Start-Process -FilePath $exePrueba -ArgumentList @("http", "--domain=$dominio", "$puerto") -WindowStyle Hidden
            Info "lance ngrok oculto (no hay tarea)"
        }
    } else {
        Info "ya hay un ngrok corriendo (PID $($vivos.Id -join ',')): no lanzo otro"
    }
} finally {
    Soltar-Candado
}
$publicoDespues = "no responde"
$limite = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $limite) {
    Start-Sleep -Seconds 10
    $publicoDespues = Publico
    if ($publicoDespues -eq "ok") { break }
}
if ($publicoDespues -eq "ok") { Bien "con el ngrok de siempre el link publico RESPONDE" } else { Mal "con el ngrok de siempre el link publico: $publicoDespues" }

# ---------------------------------------------------------- resultado ----
Titulo "RESULTADO"
Info "link publico:  antes = $publicoAntes   |   prueba con log = $publicoPrueba   |   como siempre = $publicoDespues"
if ($pruebaInvalida) {
    Linea "  La prueba no vale: en el medio arranco otro ngrok. Correr Diagnosticar-Ngrok-Ford.bat de nuevo." "Yellow"
} elseif ($publicoPrueba -eq "ok" -and $publicoDespues -eq "ok") {
    Linea "  El tunel volvio. Estaba trabado y reiniciarlo limpio alcanzo." "Green"
} elseif ($publicoPrueba -eq "ok") {
    Linea "  ngrok ANDA, pero lanzado por su tarea/.vbs NO. El problema es el lanzador, no ngrok ni la cuenta." "Yellow"
} else {
    Linea "  ngrok no logra conectarse ni lanzado a mano: el motivo esta en la seccion 9 (lo que dijo ngrok)." "Yellow"
}
Linea "  Mandale este informe a Ignacio." "Yellow"
Terminar 0
