# ============================================================================
#  Levantar el túnel de ngrok adentro de Docker
# ============================================================================
#  PARA QUÉ. En la PC de Volkswagen el antivirus borra el ngrok.exe una y otra
#  vez (seis veces en dos días, según el propio registro de Defender, siempre
#  como "Trojan:Win32/Kepavll!rfn"; una de esas veces se llevó también la tarea
#  programada). No se puede excluir la carpeta porque esa máquina tiene COMODO,
#  McAfee y Defender con la protección contra manipulación encendida.
#
#  Adentro de un contenedor el binario nunca toca el disco de Windows, así que no
#  hay nada que borrar. Ver docker-compose.tunel.yml para el detalle.
#
#  QUÉ HACE, EN ORDEN:
#    1. Se niega a seguir si detecta un ngrok NATIVO sirviendo este mismo dominio
#       (o sea, si lo corrieron por error en la PC de Ford, donde el nativo anda).
#    2. Saca el authtoken del ngrok.yml que sobrevivió al antivirus y lo guarda en
#       .env.prod, que está en .gitignore y no se sube nunca.
#    3. Levanta el contenedor.
#    4. Espera a que el túnel esté realmente arriba y lo verifica contra el
#       dominio; si no, dice qué mirar.
#
#  Uso: doble clic en Instalar-Tunel-Docker.bat, o
#       powershell -ExecutionPolicy Bypass -File Instalar-Tunel-Docker.ps1
#
#  NO necesita permisos de administrador. Si los tiene, además borra la tarea
#  programada vieja, que quedó apuntando a un .exe que ya no existe.
# ============================================================================

param(
    # Para volver atrás: baja el contenedor y lo saca del arranque automático.
    [switch]$Quitar
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$ProyectoDir  = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$EnvFile      = Join-Path $ProyectoDir ".env.prod"
$ComposeTunel = Join-Path $ProyectoDir "docker-compose.tunel.yml"
$Contenedor   = "calidad-tunel-ngrok"
$TareaVieja   = "Sistema de Calidad - ngrok"

function Bien($t) { Write-Host "  [OK]  $t"  -ForegroundColor Green }
function Mal($t)  { Write-Host "  [!]   $t"  -ForegroundColor Red }
function Info($t) { Write-Host "        $t"  -ForegroundColor Gray }
function Paso($t) { Write-Host ""; Write-Host "  $t" -ForegroundColor Cyan }

Write-Host ""
Write-Host "  El tunel de ngrok, adentro de Docker" -ForegroundColor Cyan
Write-Host "  ------------------------------------" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
#  Leer .env.prod
# ---------------------------------------------------------------------------
function Leer-EnvProd([string]$clave) {
    if (-not (Test-Path $EnvFile)) { return "" }
    foreach ($linea in (Get-Content $EnvFile -ErrorAction SilentlyContinue)) {
        $l = "$linea".Trim()
        if ($l -eq "" -or $l.StartsWith("#")) { continue }
        $i = $l.IndexOf("=")
        if ($i -lt 1) { continue }
        if ($l.Substring(0, $i).Trim() -eq $clave) { return $l.Substring($i + 1).Trim() }
    }
    return ""
}

# A localhost SIN proxy. En esta PC el proxy de la empresa se mete hasta en las
# consultas locales y devuelve "no responde" con todo funcionando: ya nos hizo
# perder un día entero cuando la actualización automática se revertía sola.
function Consultar-Local([string]$url, [int]$segundos) {
    try {
        $req = [System.Net.HttpWebRequest]::Create($url)
        $req.Timeout = $segundos * 1000
        $req.Proxy = $null
        $resp = $req.GetResponse()
        $lector = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $texto = $lector.ReadToEnd()
        $lector.Close(); $resp.Close()
        return $texto
    } catch { return "" }
}

function Tunel-Arriba([string]$dominio) {
    $t = Consultar-Local "http://127.0.0.1:4040/api/tunnels" 8
    if (-not $t) { return $false }
    return ($t -match [regex]::Escape($dominio))
}

if (-not (Test-Path $ComposeTunel)) {
    Mal "No encuentro $ComposeTunel"
    Info "Corre 'git pull' en $ProyectoDir y volve a intentar."
    Write-Host ""; Read-Host "Enter para cerrar"; exit 1
}

$dominio = Leer-EnvProd "NGROK_DOMAIN"
if (-not $dominio) {
    Mal "No encuentro NGROK_DOMAIN en $EnvFile"
    Info "Sin el dominio no se sabe que tunel levantar. Cada marca tiene el suyo."
    Write-Host ""; Read-Host "Enter para cerrar"; exit 1
}

# ---------------------------------------------------------------------------
#  Quitar
# ---------------------------------------------------------------------------
if ($Quitar) {
    Paso "Bajando el tunel..."
    & docker compose -f $ComposeTunel --env-file $EnvFile down | Out-Null
    Bien "Contenedor bajado. Ya no arranca solo."
    Write-Host ""; Read-Host "Enter para cerrar"; exit 0
}

# ---------------------------------------------------------------------------
#  1. Guarda: que nadie lo corra en la PC donde el ngrok nativo YA anda
# ---------------------------------------------------------------------------
# ngrok no deja dos agentes sirviendo el mismo dominio reservado. Si esto se
# corre por error en la PC de Ford, el contenedor pelearia con el ngrok.exe que
# hoy funciona y el resultado seria dejar SIN tunel a la marca que estaba bien.
$nativo = Get-Process ngrok -ErrorAction SilentlyContinue
if ($nativo -and (Tunel-Arriba $dominio)) {
    Write-Host ""
    Mal "Esta PC YA tiene un ngrok nativo sirviendo https://$dominio"
    Info "Y esta funcionando. Meter un contenedor con el mismo dominio los haria"
    Info "pelear y te quedarias sin tunel."
    Info ""
    Info "Este script es para la PC donde el antivirus borra el ngrok.exe."
    Info "Si de verdad queres pasar ESTA maquina a Docker, primero pará el nativo."
    Write-Host ""; Read-Host "Enter para cerrar"; exit 1
}

# ---------------------------------------------------------------------------
#  2. El authtoken
# ---------------------------------------------------------------------------
Paso "1) Buscando el authtoken de ngrok..."

$token = Leer-EnvProd "NGROK_AUTHTOKEN"
if ($token) {
    Bien "Ya estaba en .env.prod."
} else {
    # El .exe lo borra el antivirus, pero el ngrok.yml SOBREVIVE: ahi esta el
    # token, y por eso no hay que ir a buscarlo al panel de ngrok.
    $candidatos = @(
        (Join-Path $ProyectoDir "ngrok.yml"),
        "$env:LOCALAPPDATA\ngrok\ngrok.yml",
        "$env:APPDATA\ngrok\ngrok.yml"
    )
    # Y en los demas perfiles: la sesion que instalo ngrok puede no ser esta.
    try {
        foreach ($p in (Get-ChildItem C:\Users -Directory -Force -ErrorAction SilentlyContinue)) {
            $candidatos += (Join-Path $p.FullName "AppData\Local\ngrok\ngrok.yml")
        }
    } catch { }

    foreach ($c in ($candidatos | Sort-Object -Unique)) {
        try {
            if (-not (Test-Path -LiteralPath $c -ErrorAction SilentlyContinue)) { continue }
            foreach ($linea in (Get-Content -LiteralPath $c -ErrorAction SilentlyContinue)) {
                # Sirve para v2 y para v3: en v3 la clave esta indentada adentro de
                # "agent:", pero el nombre y el formato son los mismos.
                if ("$linea" -match '^\s*authtoken\s*:\s*(\S+)\s*$') {
                    $token = $Matches[1].Trim('"').Trim("'")
                    Bien "Token encontrado en $c"
                    break
                }
            }
        } catch { }
        if ($token) { break }
    }

    if (-not $token) {
        Mal "No encontre el authtoken en ningun ngrok.yml."
        Info "Sacalo de https://dashboard.ngrok.com/get-started/your-authtoken"
        Info "y agregalo a mano al final de $EnvFile :"
        Info ""
        Info "    NGROK_AUTHTOKEN=el_token_que_copiaste"
        Info ""
        Info "Despues volve a correr este script."
        Write-Host ""; Read-Host "Enter para cerrar"; exit 1
    }

    # Se agrega al final, sin reescribir el resto: .env.prod tiene las
    # credenciales de Meta y de la base, y no se toca mas de lo necesario.
    try {
        Add-Content -Path $EnvFile -Value "" -Encoding ASCII -ErrorAction Stop
        Add-Content -Path $EnvFile -Value "# Token del agente de ngrok, para el tunel en contenedor (docker-compose.tunel.yml)" -Encoding ASCII -ErrorAction Stop
        Add-Content -Path $EnvFile -Value "NGROK_AUTHTOKEN=$token" -Encoding ASCII -ErrorAction Stop
        Bien "Guardado en .env.prod (que no se sube al repositorio)."
    } catch {
        Mal "No pude escribir en $EnvFile : $($_.Exception.Message)"
        Write-Host ""; Read-Host "Enter para cerrar"; exit 1
    }
}

# ---------------------------------------------------------------------------
#  3. La tarea programada vieja
# ---------------------------------------------------------------------------
Paso "2) Limpiando lo viejo..."

$null = & schtasks /query /TN $TareaVieja 2>&1
if ($LASTEXITCODE -eq 0) {
    # Apunta a un .exe que el antivirus ya borro: cada 5 minutos intenta arrancar
    # algo que no existe. Sacarla evita ruido y confusion mas adelante.
    $null = & schtasks /delete /TN $TareaVieja /F 2>&1
    if ($LASTEXITCODE -eq 0) { Bien "Borrada la tarea vieja, que apuntaba a un .exe que ya no existe." }
    else { Info "No pude borrar la tarea vieja (hace falta administrador). No es grave: apunta a un archivo que no existe y no hace nada." }
} else {
    Info "No hay tarea vieja que borrar."
}

# ---------------------------------------------------------------------------
#  4. Levantar
# ---------------------------------------------------------------------------
Paso "3) Levantando el contenedor del tunel..."
Info "dominio : https://$dominio"

& docker compose -f $ComposeTunel --env-file $EnvFile up -d
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Mal "docker compose no pudo levantar el tunel."
    Info "Revisá que Docker Desktop este andando:  docker ps"
    Write-Host ""; Read-Host "Enter para cerrar"; exit 1
}
Bien "Contenedor arriba."

# ---------------------------------------------------------------------------
#  5. Verificar de verdad
# ---------------------------------------------------------------------------
Paso "4) Esperando a que el tunel se establezca..."
Info "Puede tardar hasta un minuto."

$ok = $false
for ($i = 0; $i -lt 12 -and -not $ok; $i++) {
    Start-Sleep -Seconds 5
    $ok = Tunel-Arriba $dominio
}

Write-Host ""
if ($ok) {
    Write-Host "  =====================================================" -ForegroundColor Green
    Write-Host "   LISTO. El tunel esta activo:" -ForegroundColor Green
    Write-Host "   https://$dominio" -ForegroundColor Green
    Write-Host "  =====================================================" -ForegroundColor Green
    Info ""
    Info "Y ahora se levanta solo cuando prenden la PC, junto con el sistema."
    Info "No hay tarea programada, ni lanzador oculto, ni nada que el antivirus"
    Info "pueda borrar: el binario vive adentro del contenedor."
} else {
    Mal "El contenedor arranco pero el tunel no responde despues de un minuto."
    Info ""
    Info "Para ver que dice ngrok:"
    Info "   docker logs $Contenedor --tail 30"
    Info ""
    Info "Lo mas comun:"
    Info " - El token no es de la cuenta duena del dominio $dominio."
    Info " - OTRA PC esta usando el mismo dominio ahora mismo (ngrok no deja dos)."
    Info " - El sistema no responde en el puerto local: probá  docker ps"
}
Write-Host ""
Read-Host "Enter para cerrar"
