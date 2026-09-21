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

# SISTEMA MUDADO AL SERVIDOR. Si existe SISTEMA-EN-SERVIDOR.txt (lo crea
# Migrar-A-Servidor.bat), esta PC NO levanta nada. No es un detalle: con los
# contenedores arriba, el circuito de insistencia de esta PC seguiria mandando
# WhatsApp desde una base vieja, y el cliente los recibiria repetidos.
if (Test-Path (Join-Path $ProjectDir "SISTEMA-EN-SERVIDOR.txt")) { exit 0 }
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
# En la PC de Volkswagen el tunel NO es un .exe de Windows: el antivirus lo borra
# apenas aparece, asi que corre adentro de un contenedor (docker-compose.tunel.yml).
# Este es el nombre de ese contenedor. En la PC de Ford no existe, y por eso alla
# el vigilante sigue haciendo exactamente lo mismo de siempre.
$ContenedorTunel = "calidad-tunel-ngrok"
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
# huboError va aparte de huboAccion: reparar algo (una accion) es lo NORMAL y no
# tiene que avisar a nadie. Lo que hay que avisar es lo que NO se pudo arreglar.
function Log-Error  {
    param([string]$m)
    $script:huboAccion = $true
    $script:huboError = $true
    $script:motivos = @($script:motivos) + @($m)
    Log "ERROR" $m
}

# ---------------------------------------------------------------------------
#  Aviso por correo cuando algo NO se puede arreglar solo
# ---------------------------------------------------------------------------
#  POR QUE EXISTE ESTO. Todo lo que fallo en esta PC fallo EN SILENCIO: el tunel
#  estuvo caido dias, la actualizacion se revertia sola cada noche, ngrok
#  directamente habia desaparecido. Todo estaba prolijamente anotado en archivos
#  de log que nadie abre nunca. Un vigilante que sabe que algo esta roto y no se
#  lo dice a nadie sirve la mitad.
#
#  Se avisa recien despues de VARIAS pasadas fallidas seguidas, no a la primera:
#  Docker tarda en arrancar, la red parpadea, y un correo por cada hipo es un
#  correo que se aprende a ignorar. Y se avisa UNA sola vez por episodio, con un
#  segundo correo cuando se recupera, para que el silencio signifique "esta bien".
$ArchivoEstado = Join-Path $PSScriptRoot "estado-vigilante.json"
$FallasParaAvisar = 3      # 3 pasadas de 5 minutos = ~15 minutos caido
$HorasEntreAvisos = 12     # si sigue roto, se recuerda una vez por dia y media

function Leer-Estado {
    if (Test-Path $ArchivoEstado) {
        try { return (Get-Content $ArchivoEstado -Raw | ConvertFrom-Json) } catch { }
    }
    return [pscustomobject]@{ fallas = 0; avisadoEn = "" }
}

function Guardar-Estado($estado) {
    try { $estado | ConvertTo-Json | Set-Content -Path $ArchivoEstado -Encoding UTF8 } catch { }
}

function Mandar-Correo([string]$asunto, [string]$cuerpo, [string]$paraForzado) {
    $servidor = Leer-EnvProd "MAIL_HOST";     if (-not $servidor) { $servidor = "smtp.gmail.com" }
    $puertoM  = Leer-EnvProd "MAIL_PUERTO";   if (-not $puertoM)  { $puertoM = "465" }
    $usuario  = Leer-EnvProd "MAIL_USUARIO"
    $clave    = Leer-EnvProd "MAIL_PASSWORD"
    $para     = $paraForzado
    if (-not $para) { $para = Leer-EnvProd "ALERTA_EMAIL" }
    if (-not $para) { $para = Leer-EnvProd "MAIL_COPIA_AVISOS" }
    if (-not $para) { $para = $usuario }
    if (-not $usuario -or -not $clave -or -not $para) { return $false }

    try {
        $cliente = New-Object System.Net.Mail.SmtpClient($servidor, [int]$puertoM)
        $cliente.EnableSsl = $true
        $cliente.Credentials = New-Object System.Net.NetworkCredential($usuario, $clave)
        $mensaje = New-Object System.Net.Mail.MailMessage($usuario, $para, $asunto, $cuerpo)
        $cliente.Send($mensaje)
        return $true
    } catch {
        Log "ERROR" ("No se pudo mandar el aviso por correo: " + $_.Exception.Message)
        return $false
    }
}

# ---------------------------------------------------------------------------
#  Respaldo diario a OneDrive
# ---------------------------------------------------------------------------
#  POR QUE LO DISPARA EL VIGILANTE Y NO UNA TAREA PROGRAMADA. El respaldo diario
#  existe desde agosto y NUNCA corrio solo: en Ford habia que registrar una tarea
#  a mano (nadie lo hizo: 19 dias sin respaldo, con el estado en verde porque era
#  la foto vieja del ultimo respaldo manual) y en Volkswagen el bucle lo saltea si
#  falta un archivo de configuracion que solo deja ese mismo instalador.
#
#  El vigilante, en cambio, ya corre cada 5 minutos en LAS DOS PCs, en la sesion
#  del usuario -que es la unica que llega a Docker- y se actualiza solo con el
#  pull de las 13:00. Enganchado aca, el respaldo empieza a correr sin que nadie
#  instale nada y sin permisos de administrador.
#
#  A las 12:00, una hora ANTES de la actualizacion automatica: si una
#  actualizacion sale mal, el respaldo del dia ya esta hecho y es anterior al
#  problema. Si a esa hora la PC estaba apagada, se reintenta hasta las 19:00.
$ScriptRespaldo     = Join-Path $PSScriptRoot "Respaldo-Calidad.ps1"
$EstadoRespaldo     = Join-Path $ProjectDir "Respaldos\ultimo-respaldo.json"
$AvisoRespaldo      = Join-Path $PSScriptRoot "aviso-respaldo.txt"
$HoraRespaldo       = 12
$HoraLimiteRespaldo = 19   # despues de esta hora ya no se intenta, y se avisa si falto
$HorasSinRespaldo   = 72   # tolera un fin de semana con las PCs apagadas

function Leer-EstadoRespaldo {
    if (-not (Test-Path $EstadoRespaldo)) { return $null }
    # El archivo lo escribe Respaldo-Calidad.ps1 sin BOM, pero uno viejo puede
    # tenerlo: se lo saca antes de parsear o ConvertFrom-Json se queja.
    try {
        $crudo = (Get-Content $EstadoRespaldo -Raw -Encoding UTF8) -replace "^\uFEFF", ""
        return ($crudo | ConvertFrom-Json)
    } catch { return $null }
}

function Fecha-De([object]$estado) {
    if (-not $estado -or -not $estado.fecha) { return $null }
    try { return [datetime]::Parse($estado.fecha) } catch { return $null }
}

# A quien avisarle si el respaldo falta o falla. Decision del dueno (17-09-2026):
# a la usuaria de la PC, que es quien puede fijarse si OneDrive esta con la sesion
# iniciada. Se puede cambiar por PC con RESPALDO_ALERTA_EMAIL en .env.prod.
function Destinatario-Respaldo {
    $para = Leer-EnvProd "RESPALDO_ALERTA_EMAIL"
    if ($para) { return $para }
    # MARCA puede no estar escrita en el .env.prod de Ford: el compose asume FORD
    # cuando falta, y aca se hace lo mismo para no quedarnos sin destinatario.
    if ((Leer-EnvProd "MARCA").ToUpper() -eq "VOLKSWAGEN") { return "ldip@mariogoldsteinsa.com.ar" }
    return "yandino@mariogoldsteinsa.com.ar"
}

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

    # DENTRO DE LA CARPETA DEL SISTEMA, antes que el PATH. En la PC de Volkswagen
    # el antivirus se comio el ngrok que estaba instalado en el perfil del usuario
    # -- es una herramienta de tunel hacia afuera, justo lo que un EDR corporativo
    # borra -- y ya se habia comido el acceso directo de Inicio antes. La carpeta
    # del sistema esta EXCLUIDA del antivirus, asi que ahi sobrevive.
    foreach ($cerca in @(
        (Join-Path $ProjectDir "ngrok.exe"),
        (Join-Path $ProjectDir "ngrok\ngrok.exe"),
        (Join-Path $PSScriptRoot "ngrok.exe")
    )) {
        if ($cerca -and (Test-Path $cerca)) { return $cerca }
    }

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
        if (-not $r.ok) { return $false }
        return ((($r.texto | ConvertFrom-Json).status) -eq "ok")
    } catch { return $false }
}

function Tunel-Ok {
    # Se consulta la API local de ngrok: es fiable y no depende de internet.
    try {
        $r = Consultar-Web "http://127.0.0.1:4040/api/tunnels" 8
        # Consultar-Web devuelve @{ ok; texto; error }, NO lo de Invoke-WebRequest.
        # Desde el 02-09 aca quedo ".Content", que no existe: daba SIEMPRE falso y
        # el vigilante reiniciaba el tunel cada 5 minutos en las dos PCs (en Ford
        # mataba el ngrok de Windows; en Volkswagen reiniciaba el contenedor).
        if (-not $r.ok) { return $false }
        return ($r.texto -match [regex]::Escape($NgrokDomain))
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
    # Se le pregunta AL TUNEL, siempre, y no a la lista de procesos de Windows.
    # Antes la consulta se hacia solo si existia un proceso "ngrok"; desde que en
    # la PC de Volkswagen el tunel vive adentro de un contenedor, ahi no hay
    # proceso que encontrar y el vigilante lo habria dado por caido cada 5
    # minutos, para siempre. Lo que importa es si el tunel responde, no como esta
    # implementado.
    # En Ford esto no cambia nada: si el tunel esta bien, no se toca nada, igual
    # que hasta hoy; y si esta caido, se repara por el mismo camino de siempre.
    #
    # Se reintenta antes de darlo por caido: la API local (4040) puede tardar en
    # responder y no hay que matar un ngrok que YA esta bien (eso provocaba un
    # ciclo de matar y relanzar despues de cada reinicio).
    $tunel = $false
    for ($k = 0; $k -lt 3 -and -not $tunel; $k++) { $tunel = Tunel-Ok; if (-not $tunel) { Start-Sleep -Seconds 3 } }
    $proc = Get-Process ngrok -ErrorAction SilentlyContinue

    if (-not $tunel) {
        # Primero: ¿el tunel corre en un contenedor? Si el contenedor existe, se
        # repara con Docker y no se toca nada de Windows. En la PC de Ford no
        # existe, asi que esta rama ni se pisa.
        $contTunel = ""
        try {
            $contTunel = (& docker ps -a --filter "name=$ContenedorTunel" --format "{{.Names}}" 2>$null | Select-Object -First 1)
        } catch { }

        if ($contTunel) {
            Log-Accion "El tunel de ${NgrokDomain} no responde: reiniciando el contenedor $contTunel."
            $null = & docker restart $contTunel 2>$null
        } else {
            # Se prefiere la TAREA dedicada de ngrok: un proceso lanzado como hijo de
            # esta tarea programada lo mata Windows al terminar la tarea. La tarea propia
            # lo mantiene como proceso de primera clase (y se auto-recupera sola).
            # Con schtasks y no con Get-ScheduledTask: ese cmdlet habla por WMI, y en
            # las PCs donde esa capa esta rota se come el timeout de CIM en CADA
            # pasada (cada 5 minutos, para siempre) antes de devolver nada.
            $null = & schtasks /query /TN $NgrokTask 2>&1
            $tareaNgrok = ($LASTEXITCODE -eq 0)
            if ($proc -and -not $tunel) {
                Log-Accion "ngrok corria pero sin el tunel de ${NgrokDomain}: reiniciandolo."
                Stop-Process -Name ngrok -Force -ErrorAction SilentlyContinue
                Start-Sleep -Seconds 3
            } elseif (-not $proc) {
                Log-Accion "ngrok no estaba corriendo: relanzandolo."
            }
            if ($tareaNgrok) {
                $null = & schtasks /run /TN $NgrokTask 2>&1
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
        }
        # Darle tiempo a establecer el túnel: tras un reinicio la red y ngrok tardan
        # más, así que se reintenta hasta ~40s antes de dar por fallido.
        $ok = $false
        for ($k = 0; $k -lt 8 -and -not $ok; $k++) { Start-Sleep -Seconds 5; $ok = Tunel-Ok }
        if ($ok) { Log-Accion "Tunel de ngrok activo en https://$NgrokDomain" }
        else { Log-Error "ngrok se lanzo pero el tunel no responde tras 40s. Revisar el token/dominio (¿otra PC usando el mismo token?)." }
    }

    # ---------- 4.5) Respaldo diario a OneDrive ----------
    # Todo adentro de su propio try/catch: un problema del respaldo no puede
    # dejar sin vigilante a las dos PCs, que es de lo que depende que el sistema
    # se levante.
    try {
        $ahora      = Get-Date
        $estadoResp = Leer-EstadoRespaldo
        $fechaResp  = Fecha-De $estadoResp
        $hechoHoy   = ($estadoResp -and $estadoResp.ok -and $fechaResp -and $fechaResp.Date -eq $ahora.Date)
        # Si hace un rato que se intento y salio mal, no se reintenta en la pasada
        # siguiente: se espera a la hora siguiente. Si no, un OneDrive cerrado
        # haria un dump cada 5 minutos toda la tarde.
        $reciente   = ($fechaResp -and ((($ahora - $fechaResp).TotalMinutes) -lt 55))

        if ((Test-Path $ScriptRespaldo) -and -not $hechoHoy -and -not $reciente -and
            $ahora.Hour -ge $HoraRespaldo -and $ahora.Hour -lt $HoraLimiteRespaldo) {
            Log-Accion "Toca el respaldo diario: corriendo Respaldo-Calidad.ps1."
            # El candado del vigilante se da por huerfano a los 20 minutos, y un
            # dump grande mas la copia a OneDrive puede tardar mas que eso: si no
            # se refresca, la pasada siguiente entra en paralelo y se ponen a
            # reiniciar contenedores dos vigilantes a la vez.
            try { (Get-Item $lock).LastWriteTime = Get-Date } catch { }
            # Sincronico y con & : nunca Start-Process. En Ford el vigilante es
            # hijo de una tarea programada, y Windows se lleva a los hijos cuando
            # la tarea termina (es el motivo por el que ngrok necesito tarea propia).
            & powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden `
                -ExecutionPolicy Bypass -File $ScriptRespaldo -SoloSiFalta 2>&1 | Out-Null
            try { (Get-Item $lock).LastWriteTime = Get-Date } catch { }

            $estadoResp = Leer-EstadoRespaldo
            $fechaResp  = Fecha-De $estadoResp
            if ($estadoResp -and $estadoResp.ok) {
                Log "ACCION" ("Respaldo diario OK: {0} -> {1}" -f $estadoResp.archivo, ($estadoResp.destinosOffsite -join ", "))
            } else {
                $porque = if ($estadoResp -and $estadoResp.error) { $estadoResp.error } else { "no quedo estado del respaldo (ver Respaldos\respaldo.log)" }
                # Se anota, pero NO con Log-Error: el circuito de correo del
                # vigilante avisa de otra cosa (el sistema caido) y a otra
                # direccion. El respaldo tiene su propio aviso, mas abajo.
                Log "ERROR" ("El respaldo diario no salio de esta PC: " + $porque)
            }
        }

        # Aviso por correo: UNA vez por dia, a la tarde, si el ultimo respaldo
        # bueno quedo viejo. Antes de esto, que el respaldo faltara no se lo decia
        # nadie a nadie: se descubrio 19 dias despues, mirando un archivo.
        # El aviso se evalua despues de las 19:00 (ya paso toda la ventana de
        # reintentos) y tambien TEMPRANO A LA MAÑANA, antes de las 12: si la PC se
        # apaga a las 18:30 los viernes, con la ventana de la tarde sola no saldria
        # nunca un correo y volveria el silencio que esto viene a romper.
        if (($ahora.Hour -ge $HoraLimiteRespaldo) -or ($ahora.Hour -lt $HoraRespaldo)) {
            $horas = 9999
            if ($estadoResp -and $estadoResp.ok -and $fechaResp) { $horas = ($ahora - $fechaResp).TotalHours }
            if ($horas -gt $HorasSinRespaldo) {
                $avisado = ""
                if (Test-Path $AvisoRespaldo) { try { $avisado = (Get-Content $AvisoRespaldo -Raw -ErrorAction SilentlyContinue).Trim() } catch { } }
                if ($avisado -ne $ahora.ToString("yyyy-MM-dd")) {
                    $detalle = if ($estadoResp -and $estadoResp.error) { $estadoResp.error } else { "no hay ningun registro de respaldo en esta PC." }
                    # OJO: la fecha del estado puede ser la de un intento FALLIDO de
                    # hoy. Como "ultimo respaldo que salio" solo vale una fecha con
                    # ok=true; si no, se usa el sello que el respaldo escribe solo
                    # cuando la copia sale de la PC. Poner la del intento fallido
                    # era mandar un mail con una fecha de hoy que tranquiliza y no
                    # corresponde: el mismo falso verde que esto viene a terminar.
                    $cuando = "nunca"
                    if ($estadoResp -and $estadoResp.ok -and $fechaResp) {
                        $cuando = $fechaResp.ToString("dd/MM/yyyy HH:mm")
                    } elseif (Test-Path (Join-Path $PSScriptRoot "ultimo-respaldo.txt")) {
                        try {
                            $t = (Get-Content (Join-Path $PSScriptRoot "ultimo-respaldo.txt") -Raw -ErrorAction SilentlyContinue).Trim()
                            if ($t) { $cuando = $t }
                        } catch { }
                    }
                    $ultimoIntento = if ($fechaResp) { $fechaResp.ToString("dd/MM/yyyy HH:mm") } else { "sin registro" }
                    $cuerpoR = @"
El Sistema de Calidad no esta pudiendo guardar la copia de seguridad diaria.

Equipo        : $env:COMPUTERNAME
Usuario       : $env:USERNAME
Ultimo respaldo que salio de la PC: $cuando
Ultimo intento: $ultimoIntento
Motivo        : $detalle

Que hacer:
  1. Fijarse que OneDrive este abierto y con la sesion iniciada (el icono de la
     nube al lado del reloj, sin cruz roja ni "Iniciar sesion").
  2. Dejar la PC prendida al mediodia: el respaldo se hace a las 12:00 y
     reintenta hasta las 19:00.
  3. Si sigue igual, mandarle esto a Ignacio junto con el archivo
     $ProjectDir\Respaldos\respaldo.log

Mientras tanto la base sigue teniendo una copia en esta misma PC, pero si el
disco falla se pierde con ella.
"@
                    if (Mandar-Correo "[Calidad $env:COMPUTERNAME] Falta la copia de seguridad" $cuerpoR (Destinatario-Respaldo)) {
                        Log "ACCION" "Se aviso por correo que falta el respaldo diario."
                    }
                    # Se anota igual aunque el correo no salga: si no, cada pasada
                    # reintentaria mandarlo hasta las 24:00.
                    try { Set-Content -Path $AvisoRespaldo -Value $ahora.ToString("yyyy-MM-dd") -Encoding UTF8 } catch { }
                }
            } elseif (Test-Path $AvisoRespaldo) {
                # Volvio a andar: se limpia la marca para que el proximo problema
                # vuelva a avisar.
                Remove-Item $AvisoRespaldo -Force -ErrorAction SilentlyContinue
            }
        }
    } catch {
        Log "ERROR" ("Fallo el bloque del respaldo diario: " + $_.Exception.Message)
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

    # ---------- 6) Avisar si algo no se pudo arreglar ----------
    $estado = Leer-Estado
    if ($script:huboError) {
        $estado.fallas = [int]$estado.fallas + 1

        # Se avisa al llegar al umbral, y despues como mucho una vez cada tantas
        # horas: un correo por pasada seria un correo que se aprende a ignorar.
        $tocaAvisar = $false
        if ($estado.fallas -eq $FallasParaAvisar) { $tocaAvisar = $true }
        elseif ($estado.fallas -gt $FallasParaAvisar -and $estado.avisadoEn) {
            $desde = $null
            try { $desde = [datetime]::Parse($estado.avisadoEn) } catch { }
            if ($desde -and ((Get-Date) - $desde).TotalHours -ge $HorasEntreAvisos) { $tocaAvisar = $true }
        }

        if ($tocaAvisar) {
            $detalle = ($script:motivos | Select-Object -Unique) -join "`n  - "
            $minutos = $estado.fallas * 5
            $cuerpo = @"
El vigilante del Sistema de Calidad encontro algo que NO pudo arreglar solo.

Equipo    : $env:COMPUTERNAME
Usuario   : $env:USERNAME
Desde hace: aproximadamente $minutos minutos ($($estado.fallas) revisiones seguidas)

Que esta fallando:
  - $detalle

Que hacer:
  1. Fijarse si la PC esta prendida y con la sesion iniciada (Docker solo
     funciona con la sesion abierta).
  2. Doble clic en "Iniciar Sistema de Calidad" en el escritorio.
  3. Si sigue igual, mandarle esta informacion a Ignacio junto con el archivo
     $LogFile

Este aviso se manda una sola vez por episodio. Cuando se recupere va a llegar
otro correo avisando.
"@
            if (Mandar-Correo "[Calidad $env:COMPUTERNAME] El sistema necesita atencion" $cuerpo) {
                Log "ACCION" "Se aviso por correo: lleva $($estado.fallas) revisiones con problemas."
                $estado.avisadoEn = (Get-Date).ToString("s")
            }
        }
        Guardar-Estado $estado
    }
    elseif ([int]$estado.fallas -gt 0) {
        # Se recupero. Si se habia avisado, se avisa tambien la vuelta: si no, el
        # que recibio el mail no sabe nunca si se soluciono.
        if ($estado.avisadoEn) {
            $null = Mandar-Correo "[Calidad $env:COMPUTERNAME] Se recupero solo" @"
El sistema volvio a funcionar bien y no hace falta hacer nada.

Equipo : $env:COMPUTERNAME
Estuvo con problemas unas $([int]$estado.fallas * 5) minutos y el vigilante lo
resolvio solo.
"@
            Log "ACCION" "Se aviso por correo que se recupero."
        }
        Guardar-Estado ([pscustomobject]@{ fallas = 0; avisadoEn = "" })
    }

    # ---------------------------------------------------------------------
    #  Que la proxima vez arranque APENAS se inicia sesion
    # ---------------------------------------------------------------------
    #  El vigilante corre cada 5 minutos: quien prende la PC a la manana puede
    #  esperar hasta 5 minutos a que corra la primera vez, mas 2 o 3 de Docker.
    #  Por eso, ademas, hay algo que lo dispara al entrar: una tarea "al iniciar
    #  sesion" donde se puede crearla, y si no un acceso directo en la carpeta
    #  Inicio. Eso ultimo es lo que el antivirus del dominio ya borro una vez, asi
    #  que en cada pasada se comprueba y, si falta, se repone. Es silencioso:
    #  solo escribe en el log el dia que tuvo que reponerlo.
    try {
        $tareaEntrar = (& schtasks /query /TN "Sistema de Calidad - Vigilante al entrar" 2>&1)
        $hayTarea = ($LASTEXITCODE -eq 0)
        $accesoEntrar = Join-Path ([Environment]::GetFolderPath("Startup")) "Sistema de Calidad - arranque.lnk"
        if (-not $hayTarea -and -not (Test-Path $accesoEntrar)) {
            $sh = New-Object -ComObject WScript.Shell
            $lnk = $sh.CreateShortcut($accesoEntrar)
            $lnk.TargetPath = "powershell.exe"
            $lnk.Arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command & '$PSCommandPath'"
            $lnk.WorkingDirectory = $PSScriptRoot
            $lnk.WindowStyle = 7
            $lnk.Description = "Levanta el Sistema de Calidad al iniciar sesion."
            $lnk.Save()
            if (Test-Path $accesoEntrar) { Log-Accion "Faltaba el arranque al iniciar sesion (lo borra el antivirus): lo puse de nuevo." }
        }
    } catch { }

    Pop-Location
}
catch {
    Log-Error ("Excepcion inesperada del vigilante: " + $_.Exception.Message)
}
finally {
    Remove-Item $lock -Force -ErrorAction SilentlyContinue
}

exit 0
