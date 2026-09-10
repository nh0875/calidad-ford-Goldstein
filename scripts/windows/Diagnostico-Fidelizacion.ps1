# ============================================================================
#  Por qué Seguimiento aparece vacío para los usuarios de Fidelización
# ============================================================================
#  EL SÍNTOMA. Alguien con rol FIDELIZACION entra a Seguimiento y ve "No hay
#  conversaciones para mostrar", aunque se hayan mandado recordatorios.
#
#  Solo hay TRES motivos posibles, y este script decide cuál es. Vale la pena
#  entenderlos porque se arreglan de formas muy distintas:
#
#    1. NUNCA SALIÓ UN MENSAJE. Seguimiento solo lista clientes que tienen al
#       menos un WhatsApp registrado; sin eso la pantalla está vacía y tiene
#       razón. Pasa si la plantilla de fidelización todavía no está aprobada en
#       Meta, o si los envíos fallaron.
#    2. LOS MENSAJES SALIERON PERO NO QUEDARON ATADOS al cliente. Ahí el mensaje
#       existe pero Seguimiento no lo puede encontrar.
#    3. LA PROVINCIA LOS ESTÁ ESCONDIENDO. Si el usuario tiene provincia asignada
#       y el cliente NO tiene ninguna cargada, la comparación da distinto y el
#       cliente desaparece. Ojo con este: el cliente sin provincia queda
#       invisible para todos los que sí tienen una.
#
#  NO TOCA NADA: solo lee y cuenta.
#
#  Uso: doble clic en Diagnostico-Fidelizacion.bat
# ============================================================================

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$ProyectoDir = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$Compose = Join-Path $ProyectoDir "docker-compose.prod.yml"
$EnvProd = Join-Path $ProyectoDir ".env.prod"

function Bien($t) { Write-Host "  [OK]  $t" -ForegroundColor Green }
function Mal($t)  { Write-Host "  [!]   $t" -ForegroundColor Red }
function Info($t) { Write-Host "        $t" -ForegroundColor Gray }
function Paso($t) { Write-Host ""; Write-Host "  $t" -ForegroundColor Cyan }

if (-not (Test-Path $Compose)) {
    Mal "No encuentro $Compose"
    Write-Host ""; Read-Host "Enter para cerrar"; exit 1
}

# El separador por defecto de psql en modo -A ya es "|": pasarlo con -F desde
# PowerShell lo mangea y sh termina viendo un pipe pelado. Probado, no tocar.
$script:Fallo = $false
function Sql([string]$consulta) {
    $salida = $consulta | docker compose -f $Compose --env-file $EnvProd exec -T postgres `
        sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -t -A -v ON_ERROR_STOP=1' 2>$null
    if ($LASTEXITCODE -ne 0) { $script:Fallo = $true; return $null }
    $script:Fallo = $false
    return ,@($salida | Where-Object { "$_".Trim() -ne "" })
}

function Uno([string]$consulta) {
    $r = Sql $consulta
    if ($script:Fallo) { return $null }
    if (-not $r -or $r.Count -eq 0) { return "0" }
    return "$($r[0])".Trim()
}

Write-Host ""
Write-Host "  Por qué Seguimiento está vacío para Fidelización" -ForegroundColor Cyan
Write-Host "  ------------------------------------------------" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
Paso "1) Los clientes de fidelización"
$total = Uno 'SELECT count(*) FROM "ClienteFidelizacion" WHERE "eliminadoEn" IS NULL;'
if ($null -eq $total) {
    Mal "No se pudo consultar la base. ¿Está andando el sistema?  docker ps"
    Write-Host ""; Read-Host "Enter para cerrar"; exit 1
}
Info "cargados en total            : $total"

$conMensajes = Uno 'SELECT count(DISTINCT c.id) FROM "ClienteFidelizacion" c JOIN "WhatsappMessage" m ON m."clienteFidelizacionId" = c.id WHERE c."eliminadoEn" IS NULL;'
Info "con al menos un WhatsApp     : $conMensajes   <- ESTO es lo que lista Seguimiento"

$sinProvincia = Uno 'SELECT count(*) FROM "ClienteFidelizacion" WHERE "eliminadoEn" IS NULL AND ("sucursal" IS NULL OR btrim("sucursal") = '''');'
Info "sin provincia cargada        : $sinProvincia"

# ---------------------------------------------------------------------------
Paso "2) Los mensajes de fidelización"
$msjFidel = Uno 'SELECT count(*) FROM "WhatsappMessage" WHERE "clienteFidelizacionId" IS NOT NULL;'
Info "atados a un cliente          : $msjFidel"

$msjHuerfanos = Uno 'SELECT count(*) FROM "WhatsappMessage" WHERE "clienteFidelizacionId" IS NULL AND "casoId" IS NULL;'
Info "sin caso NI cliente (sueltos): $msjHuerfanos"

# ---------------------------------------------------------------------------
Paso "3) Los usuarios de Fidelización y su provincia"
$usuarios = Sql 'SELECT nombre || '' | provincia: '' || COALESCE(NULLIF(btrim(sucursal), ''''), ''(ninguna: ve todas)'') FROM "Usuario" WHERE rol = ''FIDELIZACION'' AND "activo" = true;'
if ($usuarios -and $usuarios.Count -gt 0) {
    foreach ($u in $usuarios) { Info $u }
} else {
    Info "(no hay usuarios con rol FIDELIZACION activos)"
}

Write-Host ""
Info "Provincias que tienen los clientes CON mensajes:"
$prov = Sql 'SELECT COALESCE(NULLIF(btrim(c."sucursal"), ''''), ''(sin provincia)'') || '' -> '' || count(DISTINCT c.id) FROM "ClienteFidelizacion" c JOIN "WhatsappMessage" m ON m."clienteFidelizacionId" = c.id WHERE c."eliminadoEn" IS NULL GROUP BY 1 ORDER BY 2 DESC;'
if ($prov -and $prov.Count -gt 0) { foreach ($p in $prov) { Info "   $p" } }
else { Info "   (ninguno)" }

# ---------------------------------------------------------------------------
Paso "VEREDICTO"

$nTotal = [int]($total -as [int])
$nConMsj = [int]($conMensajes -as [int])
$nMsjFidel = [int]($msjFidel -as [int])

if ($nTotal -eq 0) {
    Mal "No hay ningún cliente de fidelización cargado."
    Info "Seguimiento está vacío porque no hay a quién mostrar. Cargá la planilla."
} elseif ($nMsjFidel -eq 0) {
    Mal "MOTIVO 1: nunca salió un WhatsApp de fidelización."
    Info "Hay $nTotal cliente(s) cargado(s) pero CERO mensajes registrados."
    Info "Seguimiento solo lista clientes con al menos un mensaje, así que está"
    Info "vacío con razón: no hay nada que mostrar todavía."
    Info ""
    Info "Lo más probable: la plantilla de fidelización no está aprobada en Meta,"
    Info "o los envíos fallaron. Revisalo en la pantalla de Fidelización."
} elseif ($nConMsj -eq 0) {
    Mal "MOTIVO 2: hay mensajes pero NO están atados a ningún cliente."
    Info "$nMsjFidel mensaje(s) con clienteFidelizacionId, pero ningún cliente los"
    Info "reconoce como suyos. Esto es un problema de datos: avisale a Ignacio."
} else {
    Bien "Hay $nConMsj cliente(s) con mensajes: Seguimiento TENDRÍA que mostrarlos."
    Info ""
    Info "Si aun así se ve vacío, es MOTIVO 3: la provincia."
    Info "Compará arriba la provincia del usuario con las provincias de los"
    Info "clientes. Si el usuario tiene una asignada y los clientes figuran como"
    Info "'(sin provincia)', quedan escondidos: la comparación da distinto."
    Info ""
    Info "Salida rápida: sacarle la provincia al usuario (queda viendo todas) o"
    Info "cargarle la provincia a esos clientes."
}

Write-Host ""
Read-Host "Enter para cerrar"
