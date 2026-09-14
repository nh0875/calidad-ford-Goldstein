# ============================================================================
#  Migrar esta PC al servidor (OVHcloud)
# ============================================================================
#  Se corre UNA vez en cada PC (la de Ford y la de Volkswagen), la noche del
#  cambio, con doble clic en Migrar-A-Servidor.bat. NO como administrador: un
#  PowerShell elevado no llega a Docker Desktop.
#
#  Qué hace, en este orden:
#    1. Deja la marca SISTEMA-EN-SERVIDOR.txt. Desde ese momento el vigilante, el
#       arranque y la actualización automática de esta PC no levantan nada.
#    2. Detiene el backend: se congelan los datos y esta PC deja de mandar WhatsApp.
#    3. Saca la copia de la base de ESTA marca (pg_dump) y la comprueba.
#    4. Arma variables-servidor-<marca>.env con los nombres que usa el servidor.
#    5. Copia el logo de la marca.
#  Todo queda en la carpeta Migracion\ del sistema.
#
#  POR QUÉ LA MARCA VA ANTES DE DETENER: el vigilante revisa cada 5 minutos, y si
#  encuentra el backend parado lo vuelve a levantar. Sin la marca, a los 5 minutos
#  esta PC estaría otra vez corriendo, anotando datos que no van a llegar al
#  servidor y mandando WhatsApp en paralelo con él.
#
#  PARA VOLVER ATRÁS (si el servidor no anduviera): borrar SISTEMA-EN-SERVIDOR.txt
#  y abrir Levantar-sistema.bat. La base de esta PC no se toca.
# ============================================================================

param([switch]$SinConfirmar)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$ProjectDir = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $ProjectDir
$EnvFile  = Join-Path $ProjectDir ".env.prod"
$Marcador = Join-Path $ProjectDir "SISTEMA-EN-SERVIDOR.txt"

function Bien($t) { Write-Host "  [OK]  $t" -ForegroundColor Green }
function Mal($t)  { Write-Host "  [!]   $t" -ForegroundColor Red }
function Info($t) { Write-Host "        $t" -ForegroundColor Gray }
function Cortar($t) { Write-Host ""; Mal $t; Write-Host ""; exit 1 }

# Lee una variable del .env.prod. Una linea "CLAVE=   # nota" cuenta como vacia.
function Leer([string]$clave, [string]$porDefecto = "") {
    if (-not (Test-Path $EnvFile)) { return $porDefecto }
    foreach ($linea in (Get-Content $EnvFile -ErrorAction SilentlyContinue)) {
        $l = "$linea".Trim()
        if ($l -eq "" -or $l.StartsWith("#")) { continue }
        $i = $l.IndexOf("=")
        if ($i -lt 1) { continue }
        if ($l.Substring(0, $i).Trim() -ne $clave) { continue }
        $v = $l.Substring($i + 1).Trim()
        if ($v.StartsWith("#")) { $v = "" }
        if ($v -match '^(.*?)\s+#') { $v = $matches[1].Trim() }
        if ($v.Length -ge 2 -and (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'")))) {
            $v = $v.Substring(1, $v.Length - 2)
        }
        if ($v -ne "") { return $v }
    }
    return $porDefecto
}

Write-Host ""
Write-Host "  ================================================" -ForegroundColor Cyan
Write-Host "    MIGRAR ESTA PC AL SERVIDOR" -ForegroundColor Cyan
Write-Host "  ================================================" -ForegroundColor Cyan

if (-not (Test-Path $EnvFile)) { Cortar "No existe .env.prod en $ProjectDir. ¿Es la carpeta del sistema?" }

$marca = (Leer "MARCA" "FORD").ToUpper()
if ($marca -eq "VW") { $marca = "VOLKSWAGEN" }
$sufijo = if ($marca -eq "VOLKSWAGEN") { "vw" } else { "ford" }
$base = Leer "POSTGRES_DB" "calidad_ford"

Info "Carpeta : $ProjectDir"
Info "Marca   : $marca"
Info "Base    : $base"

# --- Docker y Postgres --------------------------------------------------------
$pg = (& docker ps --filter "name=postgres" --format "{{.Names}}" | Select-Object -First 1)
if (-not $pg) { Cortar "No encuentro el contenedor de Postgres corriendo. Abri Docker Desktop, espera a que arranque y volve a probar." }
Bien "Postgres: $pg"

$listado = & docker exec $pg sh -c 'psql -U "$POSTGRES_USER" -lqtA'
$bases = @($listado | ForEach-Object { ("$_" -split "\|")[0].Trim() } |
    Where-Object { $_ -and $_ -ne "postgres" -and $_ -notlike "template*" })
if ($bases -notcontains $base) { Cortar "El contenedor no tiene la base '$base' (tiene: $($bases -join ', ')). Revisa POSTGRES_DB en .env.prod." }
$otras = @($bases | Where-Object { $_ -ne $base })
if ($otras.Count -gt 0) { Info "Otras bases en esta PC que NO se migran: $($otras -join ', ')" }

# --- Confirmacion -------------------------------------------------------------
Write-Host ""
Write-Host "  Esto DETIENE el sistema en esta PC. Desde ahora esta PC no manda WhatsApp" -ForegroundColor Yellow
Write-Host "  ni vuelve a levantar sola: el sistema de $marca pasa a correr en el servidor." -ForegroundColor Yellow
Write-Host "  Hacelo fuera del horario de envio (despues de las 19)." -ForegroundColor Yellow
if (-not $SinConfirmar) {
    Write-Host ""
    $r = Read-Host "  Escribi MIGRAR para seguir (cualquier otra cosa cancela)"
    if ($r -ne "MIGRAR") { Write-Host "  Cancelado. No se toco nada."; exit 0 }
}

# --- 1. La marca, ANTES de detener nada ---------------------------------------
@"
El Sistema de Calidad de $marca se mudo al servidor el $(Get-Date -Format "dd/MM/yyyy HH:mm").

Mientras exista este archivo, esta PC NO levanta el sistema (ni el vigilante,
ni el arranque, ni la actualizacion automatica).

PARA VOLVER ATRAS (solo si el servidor no anduviera): borrar este archivo y
abrir Levantar-sistema.bat. La base de esta PC quedo intacta.
"@ | Set-Content -Path $Marcador -Encoding UTF8
Bien "Marca puesta: esta PC ya no levanta el sistema sola."

# --- 2. Detener el backend ----------------------------------------------------
$backends = @(& docker ps --filter "name=backend" --format "{{.Names}}")
foreach ($b in $backends) {
    Info "Deteniendo $b (espera a que termine lo que tenga entre manos)..."
    & docker stop -t 45 $b | Out-Null
}
if ($backends.Count -gt 0) { Bien "Backend detenido: los datos quedan congelados." } else { Info "No habia backend corriendo." }

# --- 3. La copia de la base ---------------------------------------------------
$carpeta = Join-Path $ProjectDir "Migracion"
New-Item -ItemType Directory -Force -Path $carpeta | Out-Null
$fecha = Get-Date -Format "yyyyMMdd-HHmm"
$archivo = Join-Path $carpeta "calidad-$sufijo-$fecha.dump"

Info "Generando la copia de $base..."
# pg_dump ADENTRO del contenedor y "docker cp" para sacarlo: el ">" de PowerShell
# corrompe los archivos binarios.
& docker exec -e BASE=$base $pg sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$BASE" -f /tmp/migracion.dump'
if ($LASTEXITCODE -ne 0) { Cortar "Fallo pg_dump. Para volver atras: borrar SISTEMA-EN-SERVIDOR.txt y abrir Levantar-sistema.bat." }
& docker exec $pg sh -c 'pg_restore -l /tmp/migracion.dump > /dev/null'
if ($LASTEXITCODE -ne 0) { Cortar "La copia se genero pero no se puede leer. No sigas: avisale a Ignacio." }
& docker cp "${pg}:/tmp/migracion.dump" $archivo
if ($LASTEXITCODE -ne 0) { Cortar "No se pudo sacar la copia del contenedor." }
& docker exec $pg rm -f /tmp/migracion.dump | Out-Null

$tam = [math]::Round((Get-Item $archivo).Length / 1MB, 2)
$sha = (Get-FileHash -Algorithm SHA256 $archivo).Hash.ToLower()
Bien "Copia: $archivo ($tam MB)"
Info "SHA256: $sha"

Write-Host ""
Info "Lo que hay en la copia (en el servidor tiene que dar lo mismo):"
foreach ($t in @("Caso", "RQR", "Usuario", "WhatsappMessage")) {
    # La consulta va por la entrada estandar: con comillas adentro, pasarla como
    # argumento a docker.exe la parte en pedazos.
    $n = ("SELECT COUNT(*) FROM `"$t`";" | & docker exec -i -e BASE=$base $pg sh -c 'psql -U "$POSTGRES_USER" -d "$BASE" -tA')
    Info ("  {0,-16} {1}" -f $t, "$n".Trim())
}

# --- 4. Variables para el servidor --------------------------------------------
# En el servidor, lo de Volkswagen lleva VW_ adelante (las dos marcas conviven en
# el mismo .env.prod). Ford va con los mismos nombres.
$claves = @(
    "CONFIG_ENCRYPTION_KEY", "JWT_SECRET", "ADMIN_EMAIL",
    "META_WHATSAPP_TOKEN", "META_PHONE_NUMBER_ID", "META_WEBHOOK_VERIFY_TOKEN",
    "META_TEMPLATE_NAME", "META_TEMPLATE_LANG", "META_TEMPLATE_VENTA_NAME",
    "META_FIDELIZACION_TEMPLATE_NAME", "META_RESPUESTA_NO_RECIBIDA_NAME", "META_RESPUESTA_NO_RECIBIDA_LANG",
    "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "AI_PROVIDER", "ANALISIS_MAX_POR_MINUTO",
    "MAIL_USUARIO", "MAIL_PASSWORD"
)
$prefijo = if ($sufijo -eq "vw") { "VW_" } else { "" }
$lineas = @(
    "# ==========================================================================",
    "#  Variables de $marca para el .env.prod del SERVIDOR",
    "#  Generado en esta PC el $(Get-Date -Format 'dd/MM/yyyy HH:mm').",
    "#",
    "#  TIENE CLAVES REALES. Pasarlo al servidor por un medio seguro (WinSCP/scp)",
    "#  y BORRARLO de esta PC despues. Nunca por WhatsApp ni por mail.",
    "#",
    "#  Falta agregar a mano: ${prefijo}META_APP_SECRET (Meta for Developers ->",
    "#  la app -> Configuracion -> Basica -> Clave secreta de la app).",
    "# =========================================================================="
)
$faltan = @()
foreach ($c in $claves) {
    $v = Leer $c ""
    if ($v -eq "") { $faltan += $c; continue }
    if ($v -match '[\s#]') { $v = '"' + $v + '"' }
    $lineas += "$prefijo$c=$v"
}
$varsArchivo = Join-Path $carpeta "variables-servidor-$sufijo.env"
$lineas | Set-Content -Path $varsArchivo -Encoding ASCII
Bien "Variables: $varsArchivo"
if (-not (Leer "CONFIG_ENCRYPTION_KEY" "")) { Mal "Esta PC NO tiene CONFIG_ENCRYPTION_KEY: el token de Meta guardado en la base no se va a poder leer en el servidor." }
if ($faltan.Count -gt 0) { Info "Vacias en esta PC (no se copian): $($faltan -join ', ')" }

# --- 5. Logo ------------------------------------------------------------------
$nombreLogo = if ($sufijo -eq "vw") { "logo-volkswagen.png" } else { "logo-ford.png" }
$logo = Join-Path $ProjectDir "backend\assets\$nombreLogo"
if (Test-Path $logo) { Copy-Item $logo $carpeta -Force; Bien "Logo copiado: $nombreLogo" }
else { Info "Esta PC no tiene $nombreLogo (el Word del RQR sale sin logo hasta que se cargue en el servidor)." }

# --- Resumen ------------------------------------------------------------------
Write-Host ""
Write-Host "  ================================================" -ForegroundColor Green
Write-Host "    LISTO. Esta PC quedo detenida y la copia armada." -ForegroundColor Green
Write-Host "  ================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Siguientes pasos (estan detallados en deploy\ovh\README.md):"
Write-Host "   1. Pasar la carpeta Migracion al servidor por un medio seguro."
Write-Host "   2. En el servidor:  calidad.sh restaurar $sufijo <archivo .dump>"
Write-Host "      y comparar el SHA256 y los conteos de arriba."
Write-Host "   3. Cambiar la URL del webhook en Meta y probar un WhatsApp."
Write-Host "   4. Cuando el servidor ande bien: Retirar-PC.bat en esta PC."
Write-Host ""
Write-Host "  Si algo sale mal ANTES del paso 4: borrar SISTEMA-EN-SERVIDOR.txt y abrir" -ForegroundColor Yellow
Write-Host "  Levantar-sistema.bat. Esta PC vuelve a quedar como estaba." -ForegroundColor Yellow
Write-Host ""
