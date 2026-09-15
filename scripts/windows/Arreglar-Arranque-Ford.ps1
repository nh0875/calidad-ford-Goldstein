# ============================================================================
#  Arreglar el arranque automatico de la PC de FORD
# ============================================================================
#  Doble clic en Arreglar-Arranque-Ford.bat, con la sesion de Yesica abierta y
#  SIN "Ejecutar como administrador" (un proceso elevado no llega a Docker).
#
#  LO QUE SE APRENDIO (15-09-2026), y por que este script cambio:
#
#    - El SISTEMA si arranca solo en Ford: la tarea programada "Sistema de
#      Calidad - Vigilante" levanta Docker todas las mananas (se ve en
#      vigilante.log). Lo que no andaba era el TUNEL: el link publico de ngrok,
#      que es por donde entran las respuestas de WhatsApp.
#
#    - Desde el 02-09 el vigilante tenia un error (Tunel-Ok leia ".Content", que no
#      existe) y veia el tunel SIEMPRE caido: en cada pasada mataba el ngrok de
#      Windows y lo relanzaba. Ya esta arreglado en vigilante.ps1; este script se
#      niega a seguir si esta PC todavia tiene la version con el error.
#
#    - Las versiones anteriores de este arreglo le ponian a Ford el arranque de
#      Volkswagen (el bucle, desde el registro). En Ford el bucle desaparecio dos
#      veces al correrlo, y Ford no lo necesita: tiene tareas programadas, que es
#      lo que Volkswagen no puede tener. Ahora se usa la tarea y se saca lo que
#      quedo apuntando al bucle.
#
#  QUE HACE, en orden:
#    1. Revisa todo y lo anota (arranque-ford-<fecha>.txt, aca y en el Escritorio).
#    2. Tunel: saca el contenedor que sobraba y, si el link publico no anda,
#       reinicia el ngrok de Windows LIMPIO (no a los 3 segundos, que era parte
#       del problema) y comprueba que haya nacido uno nuevo.
#    3. Arranque: confirma la tarea del vigilante y saca lo que apuntaba al bucle.
#    4. Corre el vigilante ahora y espera a que el sistema y el link respondan.
#
#  Si el link sigue sin andar, el paso siguiente es Diagnosticar-Ngrok-Ford.bat:
#  corre ngrok con registro y anota el error exacto que da.
# ============================================================================

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$ScriptDir      = $PSScriptRoot
$ProjectDir     = Split-Path (Split-Path $ScriptDir -Parent) -Parent
$EnvFile        = Join-Path $ProjectDir ".env.prod"
$Bucle          = Join-Path $ScriptDir "vigilante-bucle.ps1"
$Vbs            = Join-Path $ScriptDir "ngrok-oculto.vbs"
$Contenedor     = "calidad-tunel-ngrok"
$TareaVigilante = "Sistema de Calidad - Vigilante"
$TareaNgrok     = "Sistema de Calidad - ngrok"

$informe = New-Object System.Collections.Generic.List[string]
function Linea([string]$t, [string]$color = "Gray") { $informe.Add($t); Write-Host $t -ForegroundColor $color }
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

# Guarda el informe SIEMPRE, tambien cuando corta antes de terminar: justamente
# esos son los casos que hay que poder mandar.
function Terminar([int]$codigo) {
    Soltar-Candado
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
        # Compose acepta el valor entre comillas (MARCA="VOLKSWAGEN"): aca tambien.
        $v = $v.Trim('"').Trim("'").Trim()
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

# El link PUBLICO, que es lo que usa Meta. Devuelve "ok" o el motivo, con el
# codigo de ngrok si lo hay (ERR_NGROK_3200 = no hay ningun ngrok conectado).
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
# HTTP), se prueba directo: un proxy que bloquea ngrok no es un tunel caido.
function Publico {
    $r = Publico-Una $true
    if ($r -eq "ok" -or $r -like "HTTP*") { return $r }
    $d = Publico-Una $false
    if ($d -eq "ok") { return "ok" }
    return "$r (y directo: $d)"
}

Linea "Arreglo del arranque automatico - $(Get-Date -Format 'dd/MM/yyyy HH:mm')" "Cyan"
Info "PC: $env:COMPUTERNAME   usuario: $env:USERDOMAIN\$env:USERNAME"
Info "carpeta: $ProjectDir"
Info "version del sistema: $(((& git -C $ProjectDir rev-parse --short HEAD 2>$null) -join '').Trim())"

# ---------------------------------------------------------------- guardas ----
if (-not (Test-Path $EnvFile)) { Mal "No existe .env.prod en $ProjectDir. Es la carpeta del sistema?"; Terminar 1 }
# Dos senales independientes, a proposito: si una falla (un .env.prod escrito
# distinto), la otra frena igual. En Volkswagen este script borraria su tunel.
if ($marca -match 'VOLKSWAGEN|^VW$' -or $ProjectDir -match 'Volkswagen') {
    Mal "Esta es la PC de VOLKSWAGEN. Este arreglo es solo para la de Ford (la de Volkswagen ya arranca sola)."
    Terminar 1
}
if (Test-Path (Join-Path $ProjectDir "SISTEMA-EN-SERVIDOR.txt")) {
    Mal "Existe SISTEMA-EN-SERVIDOR.txt: por ese archivo esta PC no levanta nada."
    Info "Si el sistema NO se mudo al servidor, borralo y volve a correr esto."
    Terminar 1
}
# Sin el arreglo del vigilante no tiene sentido tocar el tunel: la proxima pasada
# (5 minutos) lo vuelve a matar.
if (Select-String -Path (Join-Path $ScriptDir "vigilante.ps1") -Pattern 'return \(\$r\.Content -match' -Quiet -ErrorAction SilentlyContinue) {
    Mal "Esta PC tiene el vigilante con el error del 02-09, que mata ngrok cada 5 minutos."
    Info "Primero actualizar: doble clic en Actualizar-AHORA.bat. Despues volver a correr esto."
    Terminar 1
}

# ------------------------------------------------------------ 1. revisar ----
Titulo "1. COMO ESTA HOY"

# Tareas programadas: todos los nombres que se usaron en algun momento.
$tareas = @($TareaVigilante, "Sistema Calidad - Vigilante", $TareaNgrok, "Sistema de Calidad - actualizacion automatica", "Respaldo Calidad M365")
$hayTareaVigilante = $false; $nombreVigilante = ""
$hayTareaNgrok = $false; $hayTareaActualizacion = $false; $hayTareaRespaldo = $false
foreach ($t in $tareas) {
    $xml = (& schtasks /query /TN "$t" /XML 2>$null) -join "`n"
    if ($LASTEXITCODE -ne 0 -or -not $xml) { Info "tarea '$t': no existe"; continue }
    $cmd   = if ($xml -match '<Command>(.*?)</Command>') { $matches[1] } else { "?" }
    $args2 = if ($xml -match '<Arguments>(.*?)</Arguments>') { [System.Net.WebUtility]::HtmlDecode($matches[1]) } else { "" }
    $user  = if ($xml -match '<UserId>(.*?)</UserId>') { $matches[1] } else { "?" }
    Info "tarea '$t': existe, corre como $user"
    Info "   ejecuta: $cmd $args2"
    $rota = $false
    foreach ($m in [regex]::Matches("$cmd $args2", "[A-Za-z]:\\[^""']+?\.(ps1|vbs|bat|exe)")) {
        if (-not (Test-Path $m.Value)) { Mal "   la tarea '$t' apunta a un archivo que YA NO EXISTE: $($m.Value)"; $rota = $true }
    }
    if ($t -like "*Vigilante" -and -not $rota) { $hayTareaVigilante = $true; $nombreVigilante = $t }
    if ($t -eq $TareaNgrok) { $hayTareaNgrok = $true }
    if ($t -like "*actualizacion automatica") { $hayTareaActualizacion = $true }
    if ($t -eq "Respaldo Calidad M365") { $hayTareaRespaldo = $true }
}

$inicio = Join-Path ([Environment]::GetFolderPath("Startup")) "Sistema de Calidad.lnk"
$claveRun = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$valorRun = (Get-ItemProperty $claveRun -Name "Sistema de Calidad" -ErrorAction SilentlyContinue)."Sistema de Calidad"
Info ("acceso directo en Inicio: " + $(if (Test-Path $inicio) { "SI" } else { "no" }))
Info ("entrada Run del registro: " + $(if ($valorRun) { "SI -> $valorRun" } else { "no" }))
Info ("vigilante-bucle.ps1 en la carpeta: " + $(if (Test-Path $Bucle) { "SI" } else { "no" }))

# El 30-07 se instalo ngrok como SERVICIO de Windows y no hay registro de que se
# haya sacado. Corre como SYSTEM: esta cuenta no lo puede frenar ni reiniciar, y
# pelearia con la tarea por la misma cuenta y el mismo dominio.
$servicioNgrok = ""
try {
    $sv = @(Get-CimInstance Win32_Service -Filter "Name LIKE '%ngrok%' OR PathName LIKE '%ngrok%'" -OperationTimeoutSec 10 -ErrorAction Stop)
    if ($sv.Count -gt 0) { $servicioNgrok = ($sv | ForEach-Object { "$($_.Name) ($($_.State), $($_.StartName))" }) -join ", " }
} catch {
    $servicioNgrok = ((& sc.exe query state= all 2>$null) | Select-String -Pattern 'ngrok' | ForEach-Object { "$_".Trim() }) -join " | "
}
if ($servicioNgrok) { Mal "HAY un servicio de Windows de ngrok: $servicioNgrok" } else { Info "servicio de Windows de ngrok: no hay" }

$motor = ((& docker version --format "{{.Server.Version}}" 2>$null) -join "").Trim()
if ($motor) { Bien "Docker responde (motor $motor)" } else { Aviso "Docker no responde ahora (lo abre la tarea del vigilante)" }

$estadoCont = ""
if ($motor) { $estadoCont = ((& docker ps -a --filter "name=^$Contenedor$" --format "{{.Status}}" 2>$null) | Select-Object -First 1) }
Info ("contenedor del tunel ($Contenedor): " + $(if ($estadoCont) { $estadoCont } else { "no existe" }))

$ngs = @(Get-Process ngrok -ErrorAction SilentlyContinue)
if ($ngs.Count -eq 0) { Info "ngrok de Windows corriendo: no" }
foreach ($n in $ngs) { Info "ngrok de Windows corriendo: PID $($n.Id) desde $($n.StartTime) ($($n.Path))" }

if (Sistema-Ok) { Bien "el sistema responde en el puerto $puerto" } else { Aviso "el sistema NO responde en el puerto $puerto" }
$st = Pedir "http://127.0.0.1:4040/api/status"
if ($st -match '"status"\s*:\s*"([^"]+)"') { Info "consola local de ngrok: sesion $($matches[1])" } else { Info "consola local de ngrok: no responde" }
$publicoAntes = Publico
if ($publicoAntes -eq "ok") { Bien "el link publico https://$dominio responde (lo que usa Meta)" } else { Mal "el link publico https://$dominio NO responde: $publicoAntes" }

$logVig = Join-Path $ScriptDir "vigilante.log"
if (Test-Path $logVig) {
    Info "lo ultimo del vigilante:"
    Get-Content $logVig -Tail 10 -ErrorAction SilentlyContinue | ForEach-Object { Info "   $_" }
}

# ------------------------------------------------------------ 2. tunel ----
Titulo "2. TUNEL"
# En Ford el tunel es el ngrok de Windows (su tarea existe). El contenedor que
# quedo de septiembre sobra en CUALQUIER estado: usa el mismo dominio y la misma
# cuenta, y el vigilante, al verlo, lo reinicia en vez de reparar el ngrok de siempre.
if ($estadoCont -and ($hayTareaNgrok -or ($estadoCont -notlike "Up*"))) {
    & docker rm -f $Contenedor 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Bien "Saque el contenedor del tunel ($estadoCont): en Ford el tunel es el ngrok de Windows."
        # El link se habia medido con el contenedor puesto: se mide de nuevo sin el.
        Start-Sleep -Seconds 15
        $publicoAntes = Publico
        Info "link publico despues de sacar el contenedor: $publicoAntes"
    } else { Mal "No pude sacar el contenedor $Contenedor." }
} elseif ($estadoCont) {
    Bien "El contenedor del tunel esta andando y esta PC no tiene ngrok de Windows configurado: no se toca."
} else {
    Bien "No hay contenedor del tunel."
}

# Reiniciar ngrok arregla UNA sola cosa: ERR_NGROK_3200, "no hay ningun ngrok
# conectado". Cualquier otra respuesta no: ERR_NGROK_8012 o un 502/503 es el
# sistema en localhost (lo levanta el paso 4), un 403/407 es un proxy, y "sin
# respuesta" es la red. Reiniciar en esos casos solo corta un tunel que anda.
if ($publicoAntes -eq "ok") {
    Bien "El link publico anda: ngrok no se toca."
} elseif ($publicoAntes -notmatch 'ERR_NGROK_3200') {
    Aviso "ngrok no se toca: el link respondio '$publicoAntes', que no es 'no hay ngrok conectado'."
    if ($publicoAntes -match 'ERR_NGROK_8012|^HTTP 50[234]') { Info "Eso es el sistema en localhost:$puerto, no el tunel: lo levanta el paso 4." }
    else { Info "Si en el paso 4 sigue sin responder, correr Diagnosticar-Ngrok-Ford.bat." }
} elseif ($servicioNgrok) {
    Mal "No se reinicia ngrok: hay un servicio de Windows de ngrok, y desde esta cuenta no se puede frenar."
    Info "Lo tiene que sacar Ignacio, en PowerShell COMO ADMINISTRADOR:"
    Info "   C:\ngrok\ngrok.exe service stop"
    Info "   C:\ngrok\ngrok.exe service uninstall"
    Info "y despues volver a correr este arreglo (queda la tarea de ngrok, que es la de siempre)."
} elseif ($hayTareaNgrok) {
    # Reinicio LIMPIO. Antes se mataba ngrok y a los 3 segundos se pedia la tarea:
    # la instancia vieja de la tarea podia seguir "en ejecucion" (la tarea ignora
    # un pedido nuevo mientras tanto) y ngrok todavia no habia soltado la sesion.
    # Con el candado del vigilante tomado, que se suelta ANTES del paso 4.
    Tomar-Candado
    try {
        $dijo = ((& schtasks /end /TN "$TareaNgrok" 2>&1) -join " ").Trim()
        Info "fin de la tarea de ngrok: $dijo"
        Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -ErrorAction SilentlyContinue
        try {
            Get-CimInstance Win32_Process -Filter "Name='wscript.exe'" -OperationTimeoutSec 10 -ErrorAction Stop |
                Where-Object { "$($_.CommandLine)" -like "*ngrok-oculto*" } |
                ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; Info "cerre el lanzador colgado (wscript PID $($_.ProcessId))" }
        } catch { }
        $hasta = (Get-Date).AddSeconds(30)
        while (@(Get-Process ngrok -ErrorAction SilentlyContinue).Count -gt 0 -and (Get-Date) -lt $hasta) { Start-Sleep -Seconds 2 }
        $quedan = @(Get-Process ngrok -ErrorAction SilentlyContinue)
        if ($quedan.Count -gt 0) {
            Mal "No pude frenar ngrok (PID $($quedan.Id -join ',')): lo lanzo otra cuenta."
        } else {
            # La hora del CORTE es la referencia: todo ngrok que nazca despues es
            # nuevo, lo lance este script o la repeticion de 5 minutos de la tarea.
            $corte = Get-Date
            Info "ngrok frenado. Espero 30 segundos a que ngrok suelte la sesion anterior..."
            Start-Sleep -Seconds 30
            if (-not (Test-Path $Vbs)) { Mal "Falta ngrok-oculto.vbs: la tarea de ngrok no tiene que lanzar." }
            $nuevo = Get-Process ngrok -ErrorAction SilentlyContinue |
                Where-Object { try { $_.StartTime -ge $corte } catch { $false } } | Select-Object -First 1
            if ($nuevo) {
                Info "la repeticion de la tarea ya lo volvio a lanzar durante la espera: no se pide otra vez"
            } else {
                $dijo = ((& schtasks /run /TN "$TareaNgrok" 2>&1) -join " ").Trim()
                Info "tarea de ngrok lanzada: $dijo"
                $hasta = (Get-Date).AddSeconds(20)
                while (-not $nuevo -and (Get-Date) -lt $hasta) {
                    Start-Sleep -Seconds 2
                    $nuevo = Get-Process ngrok -ErrorAction SilentlyContinue |
                        Where-Object { try { $_.StartTime -ge $corte } catch { $false } } | Select-Object -First 1
                }
            }
            if ($nuevo) { Bien "ngrok arranco de nuevo (PID $($nuevo.Id))" }
            else { Mal "La tarea no lanzo ngrok (o ngrok se cerro enseguida). Correr Diagnosticar-Ngrok-Ford.bat para ver por que." }
        }
    } finally {
        Soltar-Candado
    }
} else {
    Mal "Esta PC no tiene la tarea '$TareaNgrok': no hay quien mantenga ngrok. Mandale este informe a Ignacio."
}

# ---------------------------------------------------------- 3. arranque ----
Titulo "3. ARRANQUE (tareas programadas)"
if ($hayTareaVigilante) {
    Bien "Esta PC arranca con la tarea '$nombreVigilante' (cada 5 minutos con la sesion abierta)."
    # Lo que puso una version anterior de este arreglo: arrancaba el bucle, que en
    # Ford desaparece al correrlo. Solo se saca lo que apunta al bucle.
    if ($valorRun -and "$valorRun" -like "*vigilante-bucle*") {
        try {
            Remove-ItemProperty -Path $claveRun -Name "Sistema de Calidad" -ErrorAction Stop
            Bien "Saque la entrada Run que arrancaba el bucle."
        } catch { Mal "No pude sacar la entrada Run: $($_.Exception.Message)" }
    }
    if (Test-Path $inicio) {
        $destino = ""
        try { $destino = (New-Object -ComObject WScript.Shell).CreateShortcut($inicio).Arguments } catch { }
        if ("$destino" -like "*vigilante-bucle*") {
            Remove-Item $inicio -ErrorAction SilentlyContinue
            if (-not (Test-Path $inicio)) { Bien "Saque el acceso directo de Inicio que arrancaba el bucle." }
        }
    }
} else {
    Mal "No hay tarea del vigilante que funcione: esta PC no tiene con que arrancar sola."
    Info "Lo que haya en el registro o en Inicio NO se toca. Mandale este informe a Ignacio."
}
# Sin el bucle, lo que en Volkswagen corre adentro de el en Ford va por tareas.
$cuenta = "$env:USERDOMAIN\$env:USERNAME"
if ($hayTareaActualizacion) { Bien "tarea de actualizacion automatica (13:00): existe" }
else {
    Aviso "Falta la tarea de actualizacion automatica (13:00). La instala Ignacio una vez, en PowerShell COMO ADMINISTRADOR:"
    # Con la cuenta, y no con el .bat: el .bat se eleva solo pero no pasa -Usuario,
    # y la tarea quedaria a nombre del administrador, fuera de la sesion de Yesica,
    # que es donde responde Docker.
    Info "   powershell -ExecutionPolicy Bypass -File `"$ScriptDir\Instalar-Actualizacion-Automatica.ps1`" -Usuario $cuenta"
}
if ($hayTareaRespaldo) { Bien "tarea de respaldo diario: existe" }
else {
    Aviso "Falta la tarea de respaldo diario. La instala Ignacio una vez, COMO ADMINISTRADOR, despues de sincronizar la carpeta de respaldos de SharePoint:"
    # -Hora 12:00 a proposito: el valor por defecto (13:30) cae DESPUES de la
    # actualizacion de las 13:00, y el respaldo tiene que ser anterior.
    Info "   powershell -ExecutionPolicy Bypass -File `"$ScriptDir\Instalar-Respaldo-Diario.ps1`" -CarpetaNube `"<carpeta sincronizada>`" -Hora 12:00 -Usuario $cuenta"
}

# ---------------------------------------------------- 4. arrancar ya ----
Titulo "4. ARRANCANDO Y COMPROBANDO"
if ($hayTareaVigilante) {
    $dijo = ((& schtasks /run /TN "$nombreVigilante" 2>&1) -join " ").Trim()
    Info "vigilante lanzado: $dijo"
}
Info "esperando hasta 6 minutos a que respondan el sistema y el link publico..."
$limite = (Get-Date).AddMinutes(6)
$sis = $false; $pub = ""
while ((Get-Date) -lt $limite) {
    $sis = Sistema-Ok; $pub = Publico
    if ($sis -and $pub -eq "ok") { break }
    Start-Sleep -Seconds 15
}
if ($sis) { Bien "el sistema responde" } else { Mal "el sistema todavia no responde" }
if ($pub -eq "ok") { Bien "el link publico https://$dominio responde (lo que usa Meta)" }
else {
    Mal "el link publico https://$dominio todavia NO responde: $pub"
    Info "Siguiente paso: Diagnosticar-Ngrok-Ford.bat (frena ngrok, lo corre con registro y anota el error exacto)."
}

# ------------------------------------------------------------- informe ----
Titulo "RESULTADO"
if ($sis -and $pub -eq "ok" -and $hayTareaVigilante) {
    Linea "  LISTO. Para confirmarlo del todo: reiniciar la PC, iniciar sesion y esperar 10 minutos." "Green"
} else {
    Linea "  Quedo algo en rojo. Mandale este informe a Ignacio." "Yellow"
}
Terminar 0
