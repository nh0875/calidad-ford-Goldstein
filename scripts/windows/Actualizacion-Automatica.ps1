# ============================================================================
#  Actualización AUTOMÁTICA del Sistema de Calidad
# ============================================================================
#  Pensado para el Programador de tareas: corre solo a la hora del almuerzo y
#  actualiza el sistema únicamente si hay algo nuevo en GitHub.
#
#  POR QUÉ EXISTE: depender de que alguien se acuerde de hacer doble clic no
#  funciona. La PC de Ford estuvo 21 commits atrás durante una semana y nos
#  enteramos porque un arreglo que ya estaba hecho no aparecía.
#
#  LA DIFERENCIA CON HACERLO A MANO: acá no hay nadie mirando. Si la versión
#  nueva arranca rota a las 4 de la mañana, el sistema queda caído hasta que
#  alguien lo note al abrir a la mañana. Por eso este script:
#
#    1. No toca nada si no hay novedades (que es casi siempre).
#    2. Se guarda las imágenes de la versión que está andando ANTES de construir.
#    3. Si la versión nueva no responde, VUELVE SOLO a la anterior.
#    4. Deja todo escrito en un log con fecha.
#
#  LO QUE NO PUEDE HACER: la vuelta atrás devuelve el CÓDIGO, no la BASE. Si la
#  versión nueva alcanzó a aplicar una migración antes de romperse, esa migración
#  queda aplicada. En la práctica no molesta porque las migraciones de Prisma que
#  usamos agregan cosas (columnas, tablas) y el código viejo las ignora; pero si
#  alguna vez se borra o se renombra una columna, la vuelta atrás automática NO
#  alcanza y hay que restaurar el respaldo a mano. Por eso el log lo avisa.
#
#  Instalación: correr una vez  Instalar-Actualizacion-Automatica.ps1
# ============================================================================

param(
    # Hora a la que la tarea debería haber corrido (la pone el instalador). Sirve
    # para el candado de horario de más abajo. Vacía = sin candado.
    [string]$HoraPrevista = "",

    # Cuántas horas después de $HoraPrevista se sigue aceptando la corrida.
    [int]$MargenHoras = 3,

    # Para probarlo a mano sin esperar al horario. Saltea el candado.
    [switch]$Ahora
)

# "Continue" y NO "Stop", a propósito.
#
# Docker y git escriben avisos perfectamente normales por la salida de errores
# ("No services to build", el progreso del build). Con "Stop", PowerShell 5.1
# los convierte en excepciones y MATA el script a mitad de la actualización:
# quedaría el pull hecho, la imagen a medio construir y nadie mirando. Acá cada
# comando se revisa por su código de salida, que es lo único confiable.
$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$ProjectDir = if ($PSScriptRoot) { Split-Path (Split-Path $PSScriptRoot -Parent) -Parent } else { (Get-Location).Path }
$ComposeFile = "docker-compose.prod.yml"
$EnvFile = ".env.prod"
$LogFile = Join-Path $PSScriptRoot "actualizacion-automatica.log"
$LogMaxMB = 2

# Cuánto se espera a que el sistema vuelva antes de dar la actualización por
# fallida y volver atrás. Un arranque en frío aplica migraciones, así que tarda.
$SegundosParaVolver = 300

function Log($texto) {
    $linea = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $texto
    Write-Host $linea
    try { Add-Content -Path $LogFile -Value $linea -Encoding UTF8 } catch { }
}

function Rotar-Log {
    if (-not (Test-Path $LogFile)) { return }
    if ((Get-Item $LogFile).Length -lt ($LogMaxMB * 1MB)) { return }
    $viejo = "$LogFile.1"
    if (Test-Path $viejo) { Remove-Item $viejo -Force -ErrorAction SilentlyContinue }
    Move-Item $LogFile $viejo -Force -ErrorAction SilentlyContinue
}

Rotar-Log
Set-Location $ProjectDir

# --- ¿Es hora de actualizar? ------------------------------------------------
# La tarea está marcada "correr apenas se pueda" para que una PC apagada no se
# saltee la actualización. El efecto colateral es que si la PC estuvo apagada al
# mediodía, Windows dispara la tarea CUANDO PRENDE: a las 8 y media de la mañana,
# con la agencia abriendo y la gente entrando al sistema. Justo lo contrario de
# lo que se buscó al elegir el horario del almuerzo.
#
# Entonces: se acepta la corrida hasta $MargenHoras después de la hora prevista.
# Más tarde que eso, se deja para el día siguiente. No se pierde nada: la
# actualización sigue esperando en GitHub.
if ($HoraPrevista -and -not $Ahora) {
    $partes = $HoraPrevista -split ":"
    if ($partes.Count -eq 2) {
        # OJO con el nombre: PowerShell no distingue mayúsculas, así que llamar
        # "$ahora" a esta variable pisaba el parámetro -Ahora y rompía el candado.
        $momento = Get-Date
        $prevista = $momento.Date.AddHours([int]$partes[0]).AddMinutes([int]$partes[1])
        $minutos = ($momento - $prevista).TotalMinutes
        if ($minutos -lt -5 -or $minutos -gt ($MargenHoras * 60)) {
            Log ("Fuera de horario: son las {0} y esto corre a las {1} (margen {2} h). Se deja para la próxima." -f $momento.ToString("HH:mm"), $HoraPrevista, $MargenHoras)
            exit 0
        }
    }
}

# --- A qué stack le hablamos -------------------------------------------------
# docker compose bautiza al proyecto con el nombre de la CARPETA. Como cada PC
# tiene el sistema donde quiere (C:\Calidad\Vanina, Downloads\..., etc.), el
# nombre cambia de máquina en máquina; y si alguna vez se mueve o se renombra la
# carpeta, compose deja de ver el stack que está andando y un "up -d" levantaría
# uno NUEVO en paralelo, con la base VACÍA y los datos viejos huérfanos.
#
# Por eso no se confía en el nombre: se busca el proyecto que YA esté andando con
# ESTE mismo archivo de compose y se le habla a ese. Si no hay ninguno (PC recién
# instalada), se deja que compose elija como siempre y el stack nace con su nombre.
function ProyectoQueYaAnda {
    $rutaCompose = (Resolve-Path (Join-Path $ProjectDir $ComposeFile) -ErrorAction SilentlyContinue).Path
    if (-not $rutaCompose) { return $null }
    try {
        $crudo = (& docker compose ls --format json --all) -join ""
        if (-not $crudo) { return $null }
        foreach ($p in ($crudo | ConvertFrom-Json)) {
            foreach ($cf in ("$($p.ConfigFiles)" -split ",")) {
                if ("$cf".Trim() -eq $rutaCompose) { return "$($p.Name)" }
            }
        }
    } catch { }
    return $null
}

$ArgsProyecto = @()
$proyectoAdoptado = ProyectoQueYaAnda
if ($proyectoAdoptado) { $ArgsProyecto = @("-p", $proyectoAdoptado) }


if (-not (Test-Path $EnvFile)) {
    Log "No existe $EnvFile en $ProjectDir. No hay nada que actualizar."
    exit 1
}

# --- Puerto de ESTA PC, para poder consultar la salud -----------------------
$Puerto = "80"
foreach ($linea in (Get-Content $EnvFile -ErrorAction SilentlyContinue)) {
    $t = "$linea".Trim()
    if ($t -eq "" -or $t.StartsWith("#")) { continue }
    $i = $t.IndexOf("=")
    if ($i -lt 1) { continue }
    if ($t.Substring(0, $i).Trim() -eq "HTTP_PORT") { $Puerto = $t.Substring($i + 1).Trim() }
}

function Salud {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:$Puerto/api/health" -TimeoutSec 10 -UseBasicParsing
        $j = $r.Content | ConvertFrom-Json
        return @{ ok = ($j.status -eq "ok"); version = "$($j.version)"; marca = "$($j.marca)" }
    } catch {
        return @{ ok = $false; version = "(no responde)"; marca = "?" }
    }
}

# --- 1. ¿Hay algo nuevo? -----------------------------------------------------
# Se hace SIEMPRE primero y es lo único que corre la mayoría de las noches: si no
# hay novedades, el script no toca Docker ni reinicia nada.

& git fetch --quiet | Out-Null
if ($LASTEXITCODE -ne 0) {
    Log "No se pudo consultar GitHub (sin internet?). Se reintenta en la próxima corrida."
    exit 0
}

$local = (& git rev-parse HEAD).Trim()
$remoto = (& git rev-parse "@{u}" 2>$null).Trim()
if (-not $remoto) {
    Log "La rama local no sigue a ninguna rama remota. Nada que hacer."
    exit 0
}

if ($local -eq $remoto) {
    Log "Sin novedades (versión $($local.Substring(0,7)))."
    exit 0
}

$cuantos = (& git rev-list --count "HEAD..@{u}").Trim()
Log "Hay $cuantos cambio(s) nuevo(s) en GitHub. Se actualiza."
if ($proyectoAdoptado) { Log "Stack: proyecto '$proyectoAdoptado' (el que ya estaba andando)." }
else { Log "Stack: no había ninguno andando con este compose; se usa el nombre por defecto." }

# --- 2. Foto de lo que está andando, para poder volver -----------------------
# Se guardan los IDs de las imágenes ACTUALES. Si la versión nueva no levanta, se
# vuelven a etiquetar con el nombre que espera compose y el sistema arranca con
# la de antes. Sin esto, una actualización fallida deja el sistema caído toda la
# noche.
$antes = Salud
$estadoAntes = "CAIDA"
if ($antes.ok) { $estadoAntes = "OK" }
Log "Antes: marca $($antes.marca), versión $($antes.version), salud $estadoAntes"

# Se recorren los contenedores que ESTÁN CORRIENDO, no la lista de servicios del
# archivo. Preguntarle a compose "qué servicios hay" deja afuera los que están
# bajo un perfil (los de Volkswagen), y entonces la vuelta atrás dejaría a VW con
# la imagen rota mientras Ford vuelve a la buena. Con "ps -q" sin argumentos
# aparecen todos los del proyecto, tengan perfil o no.
$fotoImagenes = @{}
$contenedoresAntes = 0
try {
    $ids = & docker compose @ArgsProyecto -f $ComposeFile --env-file $EnvFile ps -q
    foreach ($cid in $ids) {
        $cid = "$cid".Trim()
        if ($cid -eq "") { continue }
        $contenedoresAntes++
        $img = (& docker inspect --format "{{.Image}}" $cid)
        $nombre = (& docker inspect --format "{{.Config.Image}}" $cid)
        if ($img -and $nombre) { $fotoImagenes["$nombre".Trim()] = "$img".Trim() }
    }
    Log "Andando: $contenedoresAntes contenedor(es). Se anotaron $($fotoImagenes.Count) imagen(es) por si hay que volver atrás."
} catch {
    Log "No se pudieron anotar las imágenes actuales: si algo sale mal, la vuelta atrás hay que hacerla a mano."
}

# CANDADO: el sistema responde, pero compose no encuentra ni un contenedor.
# Eso significa que compose está mirando OTRO proyecto (pasa si a la carpeta le
# cambiaron el nombre o la movieron). Si siguiéramos, el "up -d" levantaría un
# stack NUEVO y en paralelo, con la base VACÍA, y los datos de verdad quedarían
# huérfanos en el proyecto viejo. Se para acá, sin tocar nada.
if ($antes.ok -and $fotoImagenes.Count -eq 0) {
    Log "PARADA DE SEGURIDAD: el sistema responde pero docker compose no ve ningún contenedor de este proyecto."
    Log "Compose está apuntando a otro proyecto (¿le cambiaron el nombre a la carpeta?). NO se actualiza nada."
    Log "Se arregla a mano: revisar 'docker compose ls' y el 'name:' de docker-compose.prod.yml. Avisarle a Ignacio."
    exit 1
}

# --- 3. Traer y construir ----------------------------------------------------
$salidaPull = & git pull --ff-only
$codigoPull = $LASTEXITCODE
$salidaPull | ForEach-Object { Log "  git: $_" }
if ($codigoPull -ne 0) {
    Log "FALLÓ el pull. NO se reconstruye: el sistema sigue andando con la versión de antes."
    Log "Suele ser por cambios locales en la PC. Hay que resolverlo a mano (ver Actualizar-AHORA.bat)."
    exit 1
}

$commit = (& git rev-parse --short HEAD).Trim()
$titulo = (& git log -1 --pretty=%s).Trim()
Log "Versión nueva: $commit  $titulo"

$env:GIT_COMMIT = $commit
$salidaBuild = & docker compose @ArgsProyecto -f $ComposeFile --env-file $EnvFile build
$codigoBuild = $LASTEXITCODE
$salidaBuild | Select-Object -Last 5 | ForEach-Object { Log "  build: $_" }
if ($codigoBuild -ne 0) {
    Log "FALLÓ la construcción. El sistema sigue con la versión anterior (no se reinició nada)."
    exit 1
}

$salidaUp = & docker compose @ArgsProyecto -f $ComposeFile --env-file $EnvFile up -d
$salidaUp | Select-Object -Last 5 | ForEach-Object { Log "  up: $_" }

# Si antes había 7 contenedores y ahora quedan 5, el "up" dejó servicios afuera:
# pasa cuando VW corre por perfil pero .env.prod no tiene COMPOSE_PROFILES=vw. No
# es para abortar (Ford quedó bien), pero hay que verlo en el log a la mañana.
$contenedoresDespues = (& docker compose @ArgsProyecto -f $ComposeFile --env-file $EnvFile ps -q | Where-Object { "$_".Trim() -ne "" }).Count
if ($contenedoresAntes -gt 0 -and $contenedoresDespues -lt $contenedoresAntes) {
    Log "OJO: antes andaban $contenedoresAntes contenedor(es) y ahora hay $contenedoresDespues."
    Log "     Suele faltar COMPOSE_PROFILES=vw en .env.prod: Volkswagen se quedó sin actualizar. Avisarle a Ignacio."
}

# --- 4. ¿Volvió? Si no, se vuelve atrás --------------------------------------
Log "Esperando a que el sistema vuelva (aplica migraciones)..."
$despues = @{ ok = $false; version = "(no responde)" }
$limite = (Get-Date).AddSeconds($SegundosParaVolver)
while ((Get-Date) -lt $limite) {
    Start-Sleep -Seconds 10
    $despues = Salud
    if ($despues.ok -and $despues.version -eq $commit) { break }
}

if ($despues.ok -and $despues.version -eq $commit) {
    Log "LISTO. Actualizado a $commit y respondiendo bien."
    exit 0
}

# --- Vuelta atrás ------------------------------------------------------------
$estadoDespues = "CAIDA"
if ($despues.ok) { $estadoDespues = "OK" }
Log "LA VERSIÓN NUEVA NO RESPONDE (salud: $estadoDespues, versión: $($despues.version))."

if ($fotoImagenes.Count -eq 0) {
    Log "No hay imágenes anotadas: NO se puede volver atrás solo. REQUIERE REVISIÓN MANUAL."
    exit 1
}

Log "Volviendo a la versión anterior..."
foreach ($nombre in $fotoImagenes.Keys) {
    $idImagen = $fotoImagenes[$nombre]
    & docker tag $idImagen $nombre | Out-Null
}
# El código también vuelve, para que la próxima corrida no reintente lo mismo a
# ciegas: queda en la versión que sí andaba y el commit malo espera en GitHub.
& git reset --hard $local | Out-Null
$salidaVuelta = & docker compose @ArgsProyecto -f $ComposeFile --env-file $EnvFile up -d --force-recreate
$salidaVuelta | Select-Object -Last 3 | ForEach-Object { Log "  up: $_" }

$vuelta = @{ ok = $false }
$limite2 = (Get-Date).AddSeconds(180)
while ((Get-Date) -lt $limite2) {
    Start-Sleep -Seconds 10
    $vuelta = Salud
    if ($vuelta.ok) { break }
}

if ($vuelta.ok) {
    Log "Se volvió a la versión anterior ($($vuelta.version)) y el sistema responde. La actualización a $commit QUEDÓ PENDIENTE: avisarle a Ignacio."
    Log "OJO: volvió el código, NO la base de datos. Si la versión nueva llegó a aplicar una migración, sigue aplicada."
} else {
    Log "NO SE PUDO VOLVER ATRÁS Y EL SISTEMA NO RESPONDE. REQUIERE REVISIÓN MANUAL URGENTE."
}
exit 1
