# ==============================================================================
#  VIGILANTE del Sistema de Calidad — pensado para el Programador de tareas
#  (cada 5 minutos, privilegios maximos, ventana oculta).
#
#  Que hace, en orden:
#    1. Docker Desktop corriendo -> si no, lo inicia y espera a que el engine responda
#    2. Contenedores de produccion arriba -> si no, los levanta
#    3. GET real a /api/health -> si no responde OK tras varios intentos, reinicia el backend
#    4. ngrok corriendo y con el tunel del dominio fijo -> si no, lo relanza
#    5. Escribe cada accion en un log con fecha/hora (con rotacion)
#
#  Es IDEMPOTENTE y SILENCIOSO: si todo esta bien no hace nada, no escribe en el
#  log (salvo el latido diario) y nunca abre ventanas ni pide interaccion.
# ==============================================================================

# ---------- CONFIGURACION ----------
# La carpeta del proyecto se detecta sola desde la ubicacion de este script
# (scripts\windows\vigilante.ps1 -> sube dos niveles). Asi la carpeta se puede
# copiar a CUALQUIER ruta de la PC de Vanina sin editar nada. Fallback: la ruta
# fija de la maquina de desarrollo por si $PSScriptRoot no estuviera disponible.
$ProjectDir  = if ($PSScriptRoot) { Split-Path (Split-Path $PSScriptRoot -Parent) -Parent } else { "C:\Users\hilli\Downloads\Goldstein\Vanina" }
$EnvFile     = ".env.prod"
$ComposeFile = "docker-compose.prod.yml"
# Docker Desktop: las versiones nuevas se instalan POR USUARIO en
# %LOCALAPPDATA%\Programs\DockerDesktop; las viejas en Program Files. Se prueba
# cada candidata y se usa la que exista (asi no importa donde este instalado).
$DockerExe = @(
    "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe",
    "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
    "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $DockerExe) { $DockerExe = "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe" }
# Ruta de ngrok. Si no existe, el script lo busca en el PATH (instalacion por
# winget/choco). Dejar vacio para usar solo el PATH.
$NgrokExe    = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe"
# Dominio ESTATICO de ngrok. Es DISTINTO en cada PC: cada marca tiene su propio
# tunel y su propia cuenta. Se lee de NGROK_DOMAIN en .env.prod; este valor queda
# solo como respaldo para la PC de Ford, que ya estaba configurada asi.
$NgrokDomain = "dealer-occupant-brigade.ngrok-free.dev"
# Tarea dedicada que mantiene ngrok vivo. Un ngrok lanzado como HIJO de esta tarea
# lo mata Windows al terminar la tarea; su propia tarea lo mantiene de primera clase.
$NgrokTask   = "Sistema de Calidad - ngrok"
$Puerto      = 80
$LogFile     = Join-Path $ProjectDir "scripts\windows\vigilante.log"
$LogMaxMB    = 2        # al superarlo se rota a .1 (se conserva una generacion)
$EsperaDockerSeg = 240  # cuanto esperar a que el engine levante
$EsperaSaludSeg  = 15   # cada cuanto se reintenta /api/health
# Ventana de gracia antes de dar por caido el backend. En arranque en frio tarda
# mas porque aplica migraciones antes de empezar a servir.
$SegundosGraciaSalud     = 60
$SegundosGraciaSaludFrio = 240

# Servicios que deben estar corriendo en el stack de produccion
$ServiciosEsperados = @("postgres", "redis", "backend", "web", "backup")

# ---------- Nada que tocar de aca para abajo ----------

# La segunda marca (Volkswagen) se prende con COMPOSE_PROFILES=vw en .env.prod.
# El vigilante lo LEE de ahi en vez de tener su propio interruptor: si tuviera uno
# propio, prender VW y olvidarse de este archivo dejaria a VW sin nadie que la
# levante, que es justo la falla que este script existe para evitar.
function Leer-EnvProd([string]$clave) {
    $ruta = Join-Path $ProjectDir $EnvFile
    if (-not (Test-Path $ruta)) { return "" }
    foreach ($linea in (Get-Content $ruta -ErrorAction SilentlyContinue)) {
        $t = "$linea".Trim()
        if ($t -eq "" -or $t.StartsWith("#")) { continue }
        $i = $t.IndexOf("=")
        if ($i -lt 1) { continue }
        if ($t.Substring(0, $i).Trim() -eq $clave) { return $t.Substring($i + 1).Trim() }
    }
    return ""
}
$ErrorActionPreference = "Continue"
$ProgressPreference    = "SilentlyContinue"   # sin barras de progreso
$huboAccion = $false

function Rotar-Log {
    if (Test-Path $LogFile) {
        $mb = (Get-Item $LogFile).Length / 1MB
        if ($mb -gt $LogMaxMB) {
            $viejo = "$LogFile.1"
            if (Test-Path $viejo) { Remove-Item $viejo -Force -ErrorAction SilentlyContinue }
            Move-Item $LogFile $viejo -Force -ErrorAction SilentlyContinue
        }
    }
}

function Log {
    param([string]$Nivel, [string]$Mensaje)
    $linea = "{0}  [{1}]  {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Nivel, $Mensaje
    try { Add-Content -Path $LogFile -Value $linea -Encoding UTF8 -ErrorAction SilentlyContinue } catch { }
}

function Log-Accion { param([string]$m) ; $script:huboAccion = $true ; Log "ACCION" $m }
function Log-Error  { param([string]$m) ; $script:huboAccion = $true ; Log "ERROR"  $m }

# ---------------------------------------------------------------------------
#  Consulta HTTP que NO pasa por el proxy cuando el destino es esta misma PC
# ---------------------------------------------------------------------------
#  Invoke-WebRequest usa el proxy del sistema por defecto. En una PC de empresa
#  eso hace que hasta una consulta a http://localhost se vaya por el proxy
#  corporativo y falle: el sistema anda perfecto, se ve bien en el navegador, y
#  el script dice "no responde".
#
#  Paso en la PC de Volkswagen. Y lo peligroso es que el vigilante usa la misma
#  consulta: si le da que el sistema esta caido, reinicia los contenedores cada 5
#  minutos sin necesidad, y llena el log de "requiere revision manual".
#
#  Para localhost se anula el proxy. Para lo de afuera (el tunel de ngrok) se
#  deja el del sistema, que en una red corporativa hace falta para salir.
function Consultar-Web([string]$url, [int]$segundos = 10) {
  try {
    $req = [System.Net.HttpWebRequest]::Create($url)
    $req.Timeout = $segundos * 1000
    $req.ReadWriteTimeout = $segundos * 1000
    $req.UserAgent = "SistemaCalidad"
    if ($url -match "^https?://(localhost|127\.0\.0\.1)") { $req.Proxy = $null }
    $resp = $req.GetResponse()
    $lector = New-Object System.IO.StreamReader($resp.GetResponseStream())
    $texto = $lector.ReadToEnd()
    $lector.Close(); $resp.Close()
    return @{ ok = $true; texto = $texto; error = "" }
  } catch {
    return @{ ok = $false; texto = ""; error = $_.Exception.Message }
  }
}

# Ejecuta docker compose del stack de produccion, sin ventana ni salida.
# OJO: el parametro NO puede llamarse $Args (es variable automatica de PowerShell).
function Compose {
    param([string[]]$Argumentos)
    $todos = @("compose", "-f", $ComposeFile, "--env-file", $EnvFile) + $Argumentos
    $salida = & docker @todos 2>&1
    $lineas = @($salida | ForEach-Object { "$_".Trim() } | Where-Object { $_ -ne "" })
    return @{ Codigo = $LASTEXITCODE; Lineas = $lineas; Texto = ($lineas -join " ") }
}

function Engine-Listo {
    & docker info 2>&1 | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Salud-Ok {
    try {
        $r = Consultar-Web "http://localhost:$Puerto/api/health" 10
        if (-not $r.ok) { return $false }
        return ((($r.texto | ConvertFrom-Json).status) -eq "ok")
    } catch { return $false }
}

# Resuelve el ejecutable de ngrok: la ruta configurada o, si no existe, el PATH.
function Resolver-Ngrok {
    if ($NgrokExe -and (Test-Path $NgrokExe)) { return $NgrokExe }
    $c = Get-Command ngrok -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    return $null
}

# ¿El backend responde DENTRO de la red de Docker?
# Sirve para distinguir dos fallas que se ven igual desde afuera:
#   - backend caido            -> hay que reiniciar el backend
#   - publicacion del puerto rota (pasa tras un reinicio de WSL/Docker: el puerto
#     queda escuchando en Windows pero corta la conexion) -> hay que reiniciar
#     el contenedor "web", que es el que publica el puerto 80.
function Backend-Ok-Interno {
    $out = & docker compose -f $ComposeFile --env-file $EnvFile exec -T web sh -c "wget -qO- --timeout=5 http://backend:3000/api/health" 2>$null
    return ("$out" -match '"status"\s*:\s*"ok"')
}

# ¿El backend todavia esta arrancando? (aplica migraciones antes de servir).
# Se mira el healthcheck del propio contenedor y su tiempo de vida: si recien
# arranco, NO hay que reiniciarlo, hay que esperarlo.
function Backend-Arrancando {
    $id = (& docker compose -f $ComposeFile --env-file $EnvFile ps -q backend 2>$null | Select-Object -First 1)
    if (-not $id) { return $false }
    $salud = (& docker inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}sin{{end}}" $id 2>$null)
    if ("$salud".Trim() -eq "starting") { return $true }
    $desde = (& docker inspect --format "{{.State.StartedAt}}" $id 2>$null)
    try { if ((((Get-Date).ToUniversalTime()) - ([datetime]"$desde").ToUniversalTime()).TotalSeconds -lt 120) { return $true } } catch { }
    return $false
}

# ¿Responde la API de Volkswagen? Se consulta por su propio puerto, porque la
# salud de Ford no dice NADA de VW: son dos backends y dos bases distintas.
function Salud-VW-Ok {
    try {
        $r = Consultar-Web "http://localhost:$PuertoVW/api/health" 10
        if ($r.StatusCode -ne 200) { return $false }
        return ((($r.Content | ConvertFrom-Json).status) -eq "ok")
    } catch { return $false }
}

function Tunel-Ok {
    # Se consulta la API local de ngrok: es fiable y no depende de internet.
    try {
        $r = Consultar-Web "http://127.0.0.1:4040/api/tunnels" 8
        return ($r.Content -match [regex]::Escape($NgrokDomain))
    } catch { return $false }
}

# ---------- Candado: evita que dos corridas se pisen ----------
# (levantar Docker puede tardar varios minutos y la tarea corre cada 5)
$lock = Join-Path $env:TEMP "vigilante-calidad.lock"
if (Test-Path $lock) {
    $edadMin = ((Get-Date) - (Get-Item $lock).LastWriteTime).TotalMinutes
    if ($edadMin -lt 20) { exit 0 }               # otra corrida sigue viva
    Remove-Item $lock -Force -ErrorAction SilentlyContinue  # candado viejo/huerfano
}
New-Item -Path $lock -ItemType File -Force | Out-Null

try {
    Rotar-Log

    if (-not (Test-Path $ProjectDir)) { Log-Error "No existe la carpeta del proyecto: $ProjectDir"; exit 1 }
    Push-Location $ProjectDir
    if (-not (Test-Path $EnvFile))    { Log-Error "Falta $EnvFile en $ProjectDir"; Pop-Location; exit 1 }

    # ¿Está prendida la segunda marca? Si sí, sus contenedores pasan a ser
    # obligatorios: sin esto el vigilante los ve caer y no hace nada, porque la
    # salud de Ford sigue dando OK.
    # Cada PC tiene su PROPIO tunel de ngrok: el dominio sale del .env.prod de
    # esta maquina. Si quedara fijo en el script, en la PC de la otra marca el
    # vigilante buscaria un tunel que nunca va a existir, lo daria por caido, y
    # estaria matando y relanzando ngrok cada 5 minutos para siempre.
    $dominioEnv = Leer-EnvProd "NGROK_DOMAIN"
    if ($dominioEnv) { $NgrokDomain = $dominioEnv }

    $VWPrendida = ((Leer-EnvProd "COMPOSE_PROFILES") -match "\bvw\b")
    $PuertoVW = Leer-EnvProd "HTTP_PORT_VW"
    if (-not $PuertoVW) { $PuertoVW = "8080" }
    if ($VWPrendida) { $ServiciosEsperados = $ServiciosEsperados + @("backend-vw", "web-vw") }

    # ---------- 1) Docker Desktop ----------
    if (-not (Engine-Listo)) {
        if (-not (Get-Process "Docker Desktop" -ErrorAction SilentlyContinue)) {
            if (Test-Path $DockerExe) {
                Log-Accion "Docker Desktop no estaba corriendo: iniciandolo."
                Start-Process -FilePath $DockerExe -WindowStyle Hidden -ErrorAction SilentlyContinue
            } else {
                Log-Error "No encuentro Docker Desktop en $DockerExe"; Pop-Location; exit 1
            }
        } else {
            Log-Accion "Docker Desktop esta abierto pero el engine no responde: esperando."
        }

        $esperado = 0
        while ((-not (Engine-Listo)) -and ($esperado -lt $EsperaDockerSeg)) {
            Start-Sleep -Seconds 10; $esperado += 10
        }

        # Caso visto en la practica: la app esta abierta pero el engine quedo
        # colgado (p.ej. tras un "wsl --shutdown" o un cierre sucio). Ahi no
        # alcanza con esperar: hay que cerrar Docker Desktop y volver a abrirlo.
        if (-not (Engine-Listo)) {
            Log-Accion "El engine sigue sin responder: cerrando Docker Desktop y reabriendolo."
            Get-Process "Docker Desktop","com.docker.backend" -ErrorAction SilentlyContinue |
                Stop-Process -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 8
            if (Test-Path $DockerExe) { Start-Process -FilePath $DockerExe -WindowStyle Hidden -ErrorAction SilentlyContinue }
            $esperado2 = 0
            while ((-not (Engine-Listo)) -and ($esperado2 -lt $EsperaDockerSeg)) {
                Start-Sleep -Seconds 10; $esperado2 += 10
            }
            $esperado += $esperado2
        }

        if (Engine-Listo) { Log-Accion "Engine de Docker listo tras ${esperado}s." }
        else { Log-Error "El engine de Docker no respondio tras ${esperado}s. Se reintenta en la proxima corrida."; Pop-Location; exit 1 }
    }

    # ---------- 2) Contenedores del stack de produccion ----------
    $ps = Compose @("ps", "--services", "--filter", "status=running")
    $corriendo = @()
    if ($ps.Codigo -eq 0) { $corriendo = $ps.Lineas }
    $faltan = @($ServiciosEsperados | Where-Object { $corriendo -notcontains $_ })
    $arranqueEnFrio = $false

    if ($faltan.Count -gt 0) {
        Log-Accion ("Servicios caidos: " + ($faltan -join ", ") + ". Levantando el stack de produccion.")
        $up = Compose @("up", "-d")
        if ($up.Codigo -ne 0) { Log-Error ("Fallo 'compose up -d': " + $up.Texto) }
        else { $arranqueEnFrio = $true; Start-Sleep -Seconds 20; Log-Accion "Stack levantado." }
    }

    # ---------- 3) Salud real de la API ----------
    # Ventana de gracia antes de declarar caido el backend. Si el contenedor
    # todavia esta arrancando (healthcheck "starting" o recien creado) la ventana
    # se extiende una vez: reiniciarlo a mitad del arranque solo reinicia el reloj.
    $graciaSeg = $SegundosGraciaSalud
    if ($arranqueEnFrio) { $graciaSeg = $SegundosGraciaSaludFrio }

    $ok = $false
    $extendida = $false
    $limite = (Get-Date).AddSeconds($graciaSeg)
    while ($true) {
        if (Salud-Ok) { $ok = $true; break }
        if ((Get-Date) -ge $limite) {
            if ((Backend-Arrancando) -and (-not $extendida)) {
                $extendida = $true
                $limite = (Get-Date).AddSeconds(150)   # sigue arrancando: se lo espera
            } else { break }
        }
        Start-Sleep -Seconds $EsperaSaludSeg
    }

    if (-not $ok) {
        # Se elige el remedio segun DONDE esta la falla, en vez de reiniciar a ciegas.
        if (Backend-Ok-Interno) {
            Log-Accion "El backend responde dentro de Docker pero no desde afuera (publicacion del puerto rota): reiniciando 'web'."
            $rs = Compose @("restart", "web")
        } else {
            Log-Accion "/api/health no respondio OK tras ${graciaSeg}s de gracia: reiniciando el backend."
            $rs = Compose @("restart", "backend")
        }
        if ($rs.Codigo -ne 0) { Log-Error ("Fallo el reinicio: " + $rs.Texto) }

        $limite2 = (Get-Date).AddSeconds(180)
        while ((Get-Date) -lt $limite2) {
            Start-Sleep -Seconds $EsperaSaludSeg
            if (Salud-Ok) { $ok = $true; break }
        }

        # Ultimo recurso: si sigue mal, se reinicia todo el stack.
        if (-not $ok) {
            Log-Accion "Sigue sin responder: reiniciando el stack completo."
            Compose @("restart") | Out-Null
            $limite3 = (Get-Date).AddSeconds(180)
            while ((Get-Date) -lt $limite3) {
                Start-Sleep -Seconds $EsperaSaludSeg
                if (Salud-Ok) { $ok = $true; break }
            }
        }

        if ($ok) { Log-Accion "El sistema volvio a responder OK." }
        else { Log-Error "El sistema sigue sin responder. Requiere revision manual." }
    }

    # ---------- 3 bis) Salud de Volkswagen ----------
    # Se revisa APARTE: son dos backends contra dos bases, y el /api/health de Ford
    # da OK aunque el de VW este muerto. Sin esto, VW se puede caer y quedarse
    # caida hasta que alguien note que no llegan los WhatsApp de esa marca.
    if ($VWPrendida) {
        $okVW = $false
        $limiteVW = (Get-Date).AddSeconds($graciaSeg)
        while ($true) {
            if (Salud-VW-Ok) { $okVW = $true; break }
            if ((Get-Date) -ge $limiteVW) { break }
            Start-Sleep -Seconds $EsperaSaludSeg
        }

        if (-not $okVW) {
            Log-Accion "La API de Volkswagen (puerto $PuertoVW) no respondio: reiniciando 'backend-vw'."
            $rsVW = Compose @("restart", "backend-vw")
            if ($rsVW.Codigo -ne 0) { Log-Error ("Fallo el reinicio de backend-vw: " + $rsVW.Texto) }

            $limiteVW2 = (Get-Date).AddSeconds(180)
            while ((Get-Date) -lt $limiteVW2) {
                Start-Sleep -Seconds $EsperaSaludSeg
                if (Salud-VW-Ok) { $okVW = $true; break }
            }
            # Si el backend responde pero el puerto no, el que hay que reiniciar es
            # el que publica el puerto (mismo caso que en Ford con 'web').
            if (-not $okVW) {
                Log-Accion "Volkswagen sigue sin responder: reiniciando 'web-vw'."
                Compose @("restart", "web-vw") | Out-Null
                $limiteVW3 = (Get-Date).AddSeconds(180)
                while ((Get-Date) -lt $limiteVW3) {
                    Start-Sleep -Seconds $EsperaSaludSeg
                    if (Salud-VW-Ok) { $okVW = $true; break }
                }
            }

            if ($okVW) { Log-Accion "Volkswagen volvio a responder OK." }
            else { Log-Error "Volkswagen sigue sin responder. Requiere revision manual." }
        }
    }

    # ---------- 4) ngrok ----------
    $proc = Get-Process ngrok -ErrorAction SilentlyContinue
    $tunel = $false
    if ($proc) {
        # La API local de ngrok (4040) puede tardar en responder: se reintenta
        # antes de dar por caído el túnel, para NO matar un ngrok que YA está bien
        # (evita un ciclo de matar/relanzar tras un reinicio).
        for ($k = 0; $k -lt 3 -and -not $tunel; $k++) { $tunel = Tunel-Ok; if (-not $tunel) { Start-Sleep -Seconds 3 } }
    }

    if (-not $proc -or -not $tunel) {
        # Se prefiere la TAREA dedicada de ngrok: un proceso lanzado como hijo de
        # esta tarea programada lo mata Windows al terminar la tarea. La tarea propia
        # lo mantiene como proceso de primera clase (y se auto-recupera sola).
        $tareaNgrok = Get-ScheduledTask -TaskName $NgrokTask -ErrorAction SilentlyContinue
        if ($proc -and -not $tunel) {
            Log-Accion "ngrok corria pero sin el tunel de ${NgrokDomain}: reiniciandolo."
            Stop-Process -Name ngrok -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 3
        } elseif (-not $proc) {
            Log-Accion "ngrok no estaba corriendo: relanzandolo."
        }
        if ($tareaNgrok) {
            Start-ScheduledTask -TaskName $NgrokTask -ErrorAction SilentlyContinue
        } else {
            $exe = Resolver-Ngrok
            if ($exe) {
                Start-Process -FilePath $exe `
                    -ArgumentList @("http", "--domain=$NgrokDomain", "$Puerto") `
                    -WindowStyle Hidden -ErrorAction SilentlyContinue
            } else {
                Log-Error "No encuentro ngrok (ni en la ruta configurada ni en el PATH)."
            }
        }
        # Darle tiempo a establecer el túnel: tras un reinicio la red y ngrok tardan
        # más, así que se reintenta hasta ~40s antes de dar por fallido.
        $ok = $false
        for ($k = 0; $k -lt 8 -and -not $ok; $k++) { Start-Sleep -Seconds 5; $ok = Tunel-Ok }
        if ($ok) { Log-Accion "Tunel de ngrok activo en https://$NgrokDomain" }
        else { Log-Error "ngrok se lanzo pero el tunel no responde tras 40s. Revisar el token/dominio (¿otra PC usando el mismo token?)." }
    }

    # ---------- 5) Latido: una linea por dia si todo esta OK ----------
    if (-not $huboAccion) {
        $hoy = Get-Date -Format "yyyy-MM-dd"
        $ultimo = ""
        if (Test-Path $LogFile) {
            $tail = Get-Content $LogFile -Tail 40 -ErrorAction SilentlyContinue
            if ($tail) { $m = $tail | Select-String "\[OK\]" | Select-Object -Last 1; if ($m) { $ultimo = $m.Line.Substring(0,10) } }
        }
        if ($ultimo -ne $hoy) { Log "OK" "Todo en orden (Docker, contenedores, /api/health y ngrok)." }
    }

    Pop-Location
}
catch {
    Log-Error ("Excepcion inesperada del vigilante: " + $_.Exception.Message)
}
finally {
    Remove-Item $lock -Force -ErrorAction SilentlyContinue
}

exit 0
