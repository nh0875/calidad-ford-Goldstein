# ============================================================================
#  Diagnostico del ARRANQUE AUTOMATICO del Sistema de Calidad
# ============================================================================
#  PARA QUE SIRVE. El sistema tiene que levantarse solo cuando se prende la PC.
#  Si deja de hacerlo, esto junta en un solo archivo TODO lo que hace falta para
#  saber por que: las tareas programadas, el vigilante, Docker, los contenedores,
#  la actualizacion automatica y el tunel.
#
#  COMO SE USA. Doble clic en "Diagnostico-Arranque.bat", que esta al lado.
#  Deja un archivo en el Escritorio: "diagnostico-arranque-<NOMBRE DE LA PC>.txt".
#  Ese archivo es el que hay que mandar.
#
#  NO TOCA NADA. Solo lee y escribe ese archivo: se puede correr con el sistema
#  andando, sin miedo. Tampoco muestra contraseñas ni claves: de .env.prod lee
#  unicamente el puerto y la marca.
#
#  Anda sin ser administrador. Algunas consultas necesitan permisos y, si faltan,
#  lo dice en vez de fallar.
# ============================================================================

param(
    # Carpeta del sistema, por si este script se copio al Escritorio y no
    # encuentra sola la instalacion.
    [string]$Carpeta = ""
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$salida = New-Object System.Collections.Generic.List[string]
function Agregar([string]$t) { $salida.Add($t); Write-Host $t }
function Titulo([string]$t) {
    Agregar ""
    Agregar ("=" * 72)
    Agregar ("  " + $t)
    Agregar ("=" * 72)
}
function Correr([string]$que, [scriptblock]$bloque) {
    try {
        $r = & $bloque
        if ($null -eq $r -or "$r".Trim() -eq "") { Agregar "  (sin datos)" }
        else { foreach ($l in @($r)) { Agregar ("  " + $l) } }
    } catch {
        Agregar ("  NO SE PUDO ($que): " + $_.Exception.Message)
    }
}

# --- Donde esta instalado el sistema ----------------------------------------
# No se da por sabida la ruta: en cada PC la carpeta se llama distinto
# (C:\Calidad\Vanina, C:\Calidad\Volkswagen, Downloads\..., etc.).
function Buscar-Proyecto {
    if ($Carpeta -ne "" -and (Test-Path (Join-Path $Carpeta "docker-compose.prod.yml"))) { return (Resolve-Path $Carpeta).Path }
    if ($PSScriptRoot) {
        $subiendo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
        if ($subiendo -and (Test-Path (Join-Path $subiendo "docker-compose.prod.yml"))) { return $subiendo }
    }
    $candidatos = @()
    foreach ($raiz in @("C:\Calidad", "C:\", "$env:USERPROFILE\Downloads\Goldstein", "$env:USERPROFILE\Downloads", "$env:USERPROFILE\Documents", "$env:USERPROFILE\Desktop")) {
        if (-not (Test-Path $raiz)) { continue }
        try {
            $candidatos += Get-ChildItem -Path $raiz -Directory -ErrorAction SilentlyContinue |
                ForEach-Object { $_.FullName } |
                Where-Object { Test-Path (Join-Path $_ "docker-compose.prod.yml") }
        } catch { }
    }
    if ($candidatos.Count -gt 0) { return $candidatos[0] }
    return ""
}

$Proyecto = Buscar-Proyecto
$EnvFile = ""
$Puerto = "80"
$Marca = "?"
if ($Proyecto -ne "") {
    $EnvFile = Join-Path $Proyecto ".env.prod"
    # De .env.prod se leen SOLO el puerto y la marca. Nada mas se muestra.
    if (Test-Path $EnvFile) {
        foreach ($linea in (Get-Content $EnvFile -ErrorAction SilentlyContinue)) {
            $t = "$linea".Trim()
            if ($t -eq "" -or $t.StartsWith("#")) { continue }
            $i = $t.IndexOf("=")
            if ($i -lt 1) { continue }
            $clave = $t.Substring(0, $i).Trim()
            $valor = $t.Substring($i + 1).Trim()
            if ($clave -eq "HTTP_PORT" -and $valor -ne "") { $Puerto = $valor }
            if ($clave -eq "MARCA" -and $valor -ne "") { $Marca = $valor }
        }
    }
}

function EsAdmin {
    try {
        $id = [Security.Principal.WindowsIdentity]::GetCurrent()
        return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch { return $false }
}

# Pedido web sin proxy: en la PC de la empresa el proxy del sistema se mete
# hasta para http://localhost y hace parecer caido lo que anda perfecto.
function Consultar-Web([string]$url, [int]$segundos = 10) {
    try {
        $req = [System.Net.HttpWebRequest]::Create($url)
        $req.Timeout = $segundos * 1000
        $req.Proxy = $null
        $resp = $req.GetResponse()
        $lector = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $texto = $lector.ReadToEnd(); $lector.Close(); $resp.Close()
        return @{ ok = $true; texto = $texto }
    } catch {
        return @{ ok = $false; texto = $_.Exception.Message }
    }
}

$TAREAS = @(
    "Sistema de Calidad - Vigilante",
    "Sistema de Calidad - Vigilante al entrar",
    "Sistema de Calidad - ngrok",
    "Sistema de Calidad - actualizacion automatica"
)

# ---------------------------------------------------------------- informe ---
Agregar ""
Agregar "DIAGNOSTICO DEL ARRANQUE AUTOMATICO - Sistema de Calidad"
Agregar ("Generado: " + (Get-Date -Format "dd/MM/yyyy HH:mm:ss"))

Titulo "1. La PC"
Agregar ("  PC            : " + $env:COMPUTERNAME)
Agregar ("  Usuario       : " + $env:USERDOMAIN + "\" + $env:USERNAME)
Agregar ("  Administrador : " + (EsAdmin))
Agregar ("  Windows       : " + [System.Environment]::OSVersion.VersionString)
Agregar ("  PowerShell    : " + $PSVersionTable.PSVersion.ToString())
Agregar ("  Zona horaria  : " + (Get-TimeZone).Id)
Correr "encendido" {
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
    $arranque = $os.LastBootUpTime
    $horas = [math]::Round(((Get-Date) - $arranque).TotalHours, 1)
    return @(("Encendida desde: " + $arranque.ToString("dd/MM/yyyy HH:mm") + "  (" + $horas + " h)"))
}
Agregar ("  Carpeta del sistema: " + $(if ($Proyecto -eq "") { "NO SE ENCONTRO" } else { $Proyecto }))
Agregar ("  Marca / puerto     : " + $Marca + " / " + $Puerto)

Titulo "2. Tareas programadas (esto es lo que lo levanta solo)"
foreach ($t in $TAREAS) {
    Agregar ""
    Agregar ("  --- " + $t)
    $q = & schtasks /query /TN "$t" /fo LIST /v 2>&1
    if ($LASTEXITCODE -ne 0) {
        Agregar "  NO EXISTE esta tarea (o no se puede consultar)."
        foreach ($l in @($q)) {
            $linea = "$l".Trim()
            if ($linea -eq "" -or $linea -like "System.Management*") { continue }
            Agregar ("  " + $linea)
        }
        continue
    }
    $interesa = @("Estado", "Status", "Ultimo resultado", "Last Result", "Ultima ejecucion", "Last Run Time",
                  "Proxima ejecucion", "Next Run Time", "Ejecutar como usuario", "Run As User", "Tarea para ejecutar",
                  "Task To Run", "Habilitado", "Scheduled Task State", "Programar tipo", "Schedule Type")
    foreach ($l in @($q)) {
        $linea = "$l".Trim()
        if ($linea -eq "") { continue }
        foreach ($campo in $interesa) {
            if ($linea -like ($campo + ":*")) { Agregar ("  " + $linea); break }
        }
    }
}
Agregar ""
Agregar "  --- Todas las tareas que dicen 'Calidad'"
Correr "listado de tareas" {
    $todas = & schtasks /query /fo CSV /nh 2>$null
    $filas = @($todas) | Where-Object { "$_" -like "*Calidad*" }
    if ($filas.Count -eq 0) { return "NO HAY NINGUNA TAREA DEL SISTEMA DE CALIDAD" }
    return $filas
}

Titulo "3. Arranque por carpeta Inicio y registro (el plan B cuando no hay tareas)"
Correr "carpeta Inicio" {
    $inicio = [System.Environment]::GetFolderPath("Startup")
    $arch = Get-ChildItem $inicio -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }
    if (-not $arch) { return ("(vacia) " + $inicio) }
    return @(("Carpeta: " + $inicio)) + $arch
}
Correr "arranque al iniciar sesion" {
    $acceso = Join-Path ([System.Environment]::GetFolderPath("Startup")) "Sistema de Calidad - arranque.lnk"
    if (Test-Path $acceso) {
        $s = (New-Object -ComObject WScript.Shell).CreateShortcut($acceso)
        return @("Acceso directo 'Sistema de Calidad - arranque': SI", ("   corre: " + $s.TargetPath + " " + $s.Arguments))
    }
    return "Acceso directo 'Sistema de Calidad - arranque': no"
}
Correr "registro Run" {
    $r = @()
    foreach ($ruta in @("HKCU:\Software\Microsoft\Windows\CurrentVersion\Run", "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run")) {
        if (-not (Test-Path $ruta)) { continue }
        $p = Get-ItemProperty $ruta -ErrorAction SilentlyContinue
        foreach ($n in $p.PSObject.Properties.Name) {
            if ($n -like "PS*") { continue }
            if ("$($p.$n)" -like "*Calidad*" -or $n -like "*Calidad*" -or "$($p.$n)" -like "*Docker*") {
                $r += ($ruta.Split(":")[0] + " -> " + $n + " = " + $p.$n)
            }
        }
    }
    if ($r.Count -eq 0) { return "(nada del Sistema de Calidad ni de Docker)" }
    return $r
}

Titulo "4. El vigilante (repara y levanta cada 5 minutos)"
Correr "proceso del vigilante" {
    $vistos = @()
    try {
        $procs = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction Stop
    } catch {
        try { $procs = Get-WmiObject Win32_Process -Filter "Name='powershell.exe'" -ErrorAction Stop }
        catch { return "No se pudo mirar los procesos (WMI no responde en esta PC)." }
    }
    foreach ($p in $procs) {
        if ("$($p.CommandLine)" -like "*vigilante*") { $vistos += ("PID " + $p.ProcessId + ": " + "$($p.CommandLine)".Trim()) }
    }
    if ($vistos.Count -eq 0) { return "NO hay ningun vigilante corriendo en este momento (normal si no le toca)." }
    return $vistos
}
if ($Proyecto -ne "") {
    $logVig = Join-Path $Proyecto "scripts\windows\vigilante.log"
    Agregar ""
    if (Test-Path $logVig) {
        $ult = (Get-Item $logVig).LastWriteTime
        Agregar ("  Log del vigilante: " + $logVig)
        Agregar ("  Ultima anotacion : " + $ult.ToString("dd/MM/yyyy HH:mm"))
        Agregar "  --- ultimas 40 lineas:"
        Correr "log del vigilante" { Get-Content $logVig -Tail 40 -ErrorAction Stop }
    } else {
        Agregar "  NO existe vigilante.log: el vigilante nunca corrio en esta PC."
    }
}

Titulo "5. La actualizacion automatica de las 13:00"
if ($Proyecto -ne "") {
    $logAct = Join-Path $Proyecto "scripts\windows\actualizacion-automatica.log"
    if (Test-Path $logAct) {
        Agregar ("  Log: " + $logAct)
        Agregar ("  Ultima anotacion: " + (Get-Item $logAct).LastWriteTime.ToString("dd/MM/yyyy HH:mm"))
        Agregar "  --- ultimas 60 lineas:"
        Correr "log de la actualizacion" { Get-Content $logAct -Tail 60 -ErrorAction Stop }
    } else {
        Agregar "  NO existe actualizacion-automatica.log: nunca corrio la actualizacion sola."
    }
}

Titulo "6. En que version quedo el sistema"
if ($Proyecto -ne "") {
    Push-Location $Proyecto
    Correr "git" {
        $r = @()
        $r += ("Rama    : " + (& git rev-parse --abbrev-ref HEAD 2>&1))
        $r += ("Commit  : " + (& git log -1 --pretty="%h  %ad  %s" --date=format:"%d/%m/%Y %H:%M" 2>&1))
        $sucio = @(& git status --porcelain 2>&1) | Where-Object { "$_" -notmatch "^\?\?" }
        if ($sucio.Count -gt 0) { $r += ("Archivos del sistema cambiados en esta PC: " + $sucio.Count) ; $r += $sucio }
        else { $r += "Sin cambios locales." }
        return $r
    }
    Pop-Location
}

Titulo "7. Docker"
Correr "Docker Desktop" {
    $p = Get-Process "Docker Desktop" -ErrorAction SilentlyContinue
    if ($p) { return ("Docker Desktop esta ABIERTO (PID " + ($p | Select-Object -First 1).Id + ")") }
    return "Docker Desktop NO esta abierto."
}
Correr "motor de Docker" {
    $v = & docker version --format "{{.Server.Version}}" 2>&1
    if ($LASTEXITCODE -ne 0 -or "$v" -eq "") { return ("El motor NO responde: " + ($v -join " ")) }
    return ("Motor andando, version " + $v)
}
Correr "arranque de Docker con Windows" {
    $ajustes = "$env:APPDATA\Docker\settings-store.json"
    if (-not (Test-Path $ajustes)) { $ajustes = "$env:APPDATA\Docker\settings.json" }
    if (-not (Test-Path $ajustes)) { return "No se encontro la configuracion de Docker Desktop." }
    $j = Get-Content $ajustes -Raw -ErrorAction Stop | ConvertFrom-Json
    return ("Abrir Docker al iniciar sesion (OpenUIOnStartupDisabled/StartOnLogin): " + "$($j.AutoStart)" + " / " + "$($j.OpenUIOnStartupDisabled)")
}
Correr "stacks" { & docker compose ls --all 2>&1 }
Correr "contenedores" { & docker ps -a --format "{{.Names}} | {{.Status}} | {{.Ports}}" 2>&1 }

Titulo "8. Contenedores caidos: ultimas lineas de su log"
Correr "contenedores caidos" {
    $lineas = @()
    $caidos = @(& docker ps -a --filter "status=exited" --filter "status=restarting" --filter "status=dead" --format "{{.Names}}" 2>$null)
    if ($caidos.Count -eq 0) { return "Ninguno caido." }
    foreach ($c in $caidos) {
        $lineas += ""
        $lineas += ("--- " + $c)
        $lineas += @(& docker logs --tail 30 $c 2>&1)
    }
    return $lineas
}

Titulo "9. El sistema responde?"
$salud = Consultar-Web ("http://localhost:" + $Puerto + "/api/health") 10
if ($salud.ok) {
    Agregar ("  SI responde: " + $salud.texto)
} else {
    Agregar ("  NO responde en http://localhost:" + $Puerto + "/api/health")
    Agregar ("  Motivo: " + $salud.texto)
}
Correr "puerto" {
    $n = & netstat -ano 2>$null | Select-String (":" + $Puerto + "\s") | Select-Object -First 5
    if (-not $n) { return ("Nadie esta escuchando en el puerto " + $Puerto) }
    return @($n | ForEach-Object { "$_".Trim() })
}

Titulo "10. El tunel (ngrok)"
Correr "proceso ngrok" {
    $p = Get-Process ngrok -ErrorAction SilentlyContinue
    if ($p) { return ("ngrok esta corriendo (PID " + ($p | Select-Object -First 1).Id + ")") }
    return "ngrok NO esta corriendo en Windows (en VW puede estar dentro de Docker: mirar la lista de contenedores)."
}
$tuneles = Consultar-Web "http://127.0.0.1:4040/api/tunnels" 5
if ($tuneles.ok) {
    Correr "tuneles" {
        $j = $tuneles.texto | ConvertFrom-Json
        return @($j.tunnels | ForEach-Object { $_.public_url + "  ->  " + $_.config.addr })
    }
} else {
    Agregar "  El panel de ngrok (4040) no responde."
}

Titulo "11. Que dice el Programador de tareas del vigilante"
Correr "registro del Programador" {
    $desde = (Get-Date).AddDays(-4)
    $ev = Get-WinEvent -FilterHashtable @{ LogName = "Microsoft-Windows-TaskScheduler/Operational"; StartTime = $desde } -MaxEvents 400 -ErrorAction Stop
    $nuestros = @($ev | Where-Object { "$($_.Message)" -like "*Sistema de Calidad*" } | Select-Object -First 25)
    if ($nuestros.Count -eq 0) { return "No hay registros de las tareas del Sistema de Calidad en los ultimos 4 dias (puede estar apagado ese registro)." }
    return @($nuestros | ForEach-Object { $_.TimeCreated.ToString("dd/MM HH:mm") + "  id " + $_.Id + "  " + ("$($_.Message)" -split "`n")[0].Trim() })
}

Titulo "12. Encendidos y apagados de los ultimos dias"
Correr "eventos de Windows" {
    $desde = (Get-Date).AddDays(-5)
    $ev = Get-WinEvent -FilterHashtable @{ LogName = "System"; Id = 6005, 6006, 6008, 1074, 41; StartTime = $desde } -MaxEvents 40 -ErrorAction Stop
    return @($ev | ForEach-Object {
        $que = switch ($_.Id) {
            6005 { "encendido (arranco el registro de eventos)" }
            6006 { "apagado ordenado" }
            6008 { "APAGADO INESPERADO (corte de luz o cuelgue)" }
            1074 { "alguien apago o reinicio" }
            41   { "se corto la energia / no se apago bien" }
            default { "evento " + $_.Id }
        }
        $_.TimeCreated.ToString("dd/MM HH:mm") + "  " + $que
    })
}

Titulo "13. Espacio en disco"
Correr "disco" {
    Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue | Where-Object { $_.Used -ne $null } | ForEach-Object {
        $libre = [math]::Round($_.Free / 1GB, 1)
        $total = [math]::Round(($_.Used + $_.Free) / 1GB, 1)
        $_.Name + ": libre " + $libre + " GB de " + $total + " GB"
    }
}

# ---------------------------------------------------------------- resumen ---
Titulo "RESUMEN"
$problemas = New-Object System.Collections.Generic.List[string]
$bien = New-Object System.Collections.Generic.List[string]

if ($Proyecto -eq "") { $problemas.Add("No se encontro la carpeta del sistema en esta PC.") }
$esFord = ("$Marca".ToUpper() -like "FORD*")
# Arrancar AL ENTRAR es lo que evita los 5 a 10 minutos de espera de la manana.
$null = & schtasks /query /TN "Sistema de Calidad - Vigilante al entrar" 2>&1
$hayTareaEntrar = ($LASTEXITCODE -eq 0)
$hayAccesoEntrar = Test-Path (Join-Path ([System.Environment]::GetFolderPath("Startup")) "Sistema de Calidad - arranque.lnk")
if ($hayTareaEntrar -or $hayAccesoEntrar) { $bien.Add("Arranca apenas se inicia sesion (no espera los 5 minutos del vigilante).") }
else { $problemas.Add("NO arranca al iniciar sesion: hay que esperar a la pasada del vigilante (hasta 5 minutos) mas lo que tarda Docker.") }
foreach ($t in $TAREAS) {
    if ($t -like "*al entrar*") { continue }   # ya se reviso arriba, con su alternativa
    $null = & schtasks /query /TN "$t" 2>&1
    if ($LASTEXITCODE -ne 0) {
        if ($t -like "*ngrok*" -and -not $esFord) {
            $bien.Add("La tarea '" + $t + "' no existe (en Volkswagen es normal: el tunel va por Docker).")
        } elseif ($t -like "*Vigilante*" -and -not $esFord) {
            $problemas.Add("FALTA la tarea '" + $t + "'. En Volkswagen puede ir por el bucle del arranque: mirar el punto 3.")
        } else {
            $problemas.Add("FALTA la tarea '" + $t + "': sin ella el sistema no se levanta solo.")
        }
    } else {
        $det = @(& schtasks /query /TN "$t" /fo LIST /v 2>$null)
        $estado = ($det | Where-Object { "$_" -like "Estado:*" -or "$_" -like "Status:*" } | Select-Object -First 1)
        $ultimo = ($det | Where-Object { "$_" -like "Ultimo resultado:*" -or "$_" -like "Last Result:*" } | Select-Object -First 1)
        if ("$estado" -like "*eshabilitad*" -or "$estado" -like "*isabled*") { $problemas.Add("La tarea '" + $t + "' esta DESHABILITADA.") }
        else { $bien.Add("La tarea '" + $t + "' existe y esta habilitada.") }
        if ("$ultimo" -ne "" -and "$ultimo" -notmatch "0x0") { $problemas.Add("La tarea '" + $t + "' termino con error -> " + "$ultimo".Trim()) }
    }
}
$v = & docker version --format "{{.Server.Version}}" 2>&1
if ($LASTEXITCODE -ne 0 -or "$v" -eq "") { $problemas.Add("El motor de Docker no responde: sin el no hay sistema.") }
else { $bien.Add("Docker esta andando.") }
if ($salud.ok) { $bien.Add("El sistema responde en el puerto " + $Puerto + ".") }
else { $problemas.Add("El sistema NO responde en el puerto " + $Puerto + ".") }
if ($Proyecto -ne "") {
    $logVig = Join-Path $Proyecto "scripts\windows\vigilante.log"
    if (Test-Path $logVig) {
        $hs = [math]::Round(((Get-Date) - (Get-Item $logVig).LastWriteTime).TotalHours, 1)
        if ($hs -gt 24) { $problemas.Add("El vigilante no escribe hace " + $hs + " h: parece que no esta corriendo.") }
        else { $bien.Add("El vigilante escribio hace " + $hs + " h.") }
    } else {
        $problemas.Add("No hay vigilante.log: el vigilante nunca corrio.")
    }
}

Agregar ""
Agregar "  BIEN:"
if ($bien.Count -eq 0) { Agregar "    (nada)" }
foreach ($b in $bien) { Agregar ("    - " + $b) }
Agregar ""
Agregar "  A REVISAR:"
if ($problemas.Count -eq 0) { Agregar "    (nada: el arranque se ve sano)" }
foreach ($p in $problemas) { Agregar ("    - " + $p) }

# ---------------------------------------------------------------- guardar ---
$destino = Join-Path ([System.Environment]::GetFolderPath("Desktop")) ("diagnostico-arranque-" + $env:COMPUTERNAME + ".txt")
try {
    $salida -join "`r`n" | Out-File -FilePath $destino -Encoding UTF8 -Force
    Write-Host ""
    Write-Host ("  Informe guardado en: " + $destino) -ForegroundColor Green
    Write-Host "  Mandale ESE archivo a Ignacio." -ForegroundColor Green
} catch {
    Write-Host ""
    Write-Host ("  No se pudo guardar el archivo: " + $_.Exception.Message) -ForegroundColor Red
    Write-Host "  Copia y pega lo que salio en pantalla." -ForegroundColor Yellow
}
Write-Host ""
