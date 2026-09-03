# ============================================================================
#  Por que no llegan los mensajes de los clientes
# ============================================================================
#  SINTOMA que resuelve: "mando el WhatsApp y le llega al cliente, pero cuando
#  el cliente contesta, la respuesta no aparece en el sistema".
#
#  Eso tiene DOS causas posibles y opuestas, y a ojo no se distinguen:
#
#    A) Meta no esta entregando nada  -> el problema esta en el panel de Meta
#    B) Meta entrega y el sistema lo descarta -> el problema esta aca
#
#  Este script decide cual de las dos es. La clave: los acuses de entrega
#  (enviado / entregado / leido) viajan por EL MISMO webhook que los mensajes
#  entrantes. Entonces, mirando los mensajes que YA mandamos:
#
#    - si quedaron en "sent" y nunca pasaron a "delivered"  -> Meta no llama al
#      webhook. Es (A): no hay nada roto en esta PC.
#    - si dicen "delivered" o "read"                        -> Meta SI llama al
#      webhook y el sistema SI le contesta. Es (B), y el resto del informe dice
#      donde se perdio el mensaje.
#
#  Uso:
#      powershell -ExecutionPolicy Bypass -File Diagnostico-Webhook.ps1
# ============================================================================

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$ProjectDir = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$Compose    = Join-Path $ProjectDir "docker-compose.prod.yml"
$EnvProd    = Join-Path $ProjectDir ".env.prod"

function Titulo($t) {
    Write-Host ""
    Write-Host "  -------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host "   $t" -ForegroundColor Cyan
    Write-Host "  -------------------------------------------------------" -ForegroundColor DarkGray
}
function Bien($t) { Write-Host "  [OK]  $t" -ForegroundColor Green }
function Mal($t)  { Write-Host "  [!]   $t" -ForegroundColor Red }
function Ojo($t)  { Write-Host "  [?]   $t" -ForegroundColor Yellow }
function Info($t) { Write-Host "        $t" -ForegroundColor Gray }

Clear-Host
Write-Host ""
Write-Host "   =======================================================" -ForegroundColor Cyan
Write-Host "      POR QUE NO LLEGAN LOS MENSAJES DE LOS CLIENTES" -ForegroundColor Cyan
Write-Host "   =======================================================" -ForegroundColor Cyan

if (-not (Test-Path $Compose)) { Mal "No encuentro docker-compose.prod.yml en $ProjectDir"; Read-Host "`nEnter"; exit 1 }
if (-not (Test-Path $EnvProd)) { Mal "No encuentro .env.prod en $ProjectDir"; Read-Host "`nEnter"; exit 1 }

Push-Location $ProjectDir

# --- Consultar la base. El SQL va por la entrada estandar para no pelear con
# --- las comillas: adentro del contenedor las variables ya estan puestas.
function Sql([string]$consulta) {
    $salida = $consulta | docker compose -f $Compose --env-file $EnvProd exec -T postgres `
        sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -t -A -F "|" -v ON_ERROR_STOP=1' 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return @($salida | Where-Object { "$_".Trim() -ne "" })
}

# --- Consultar a esta misma PC SIN pasar por el proxy de la empresa.
function Web([string]$url) {
    try {
        $req = [System.Net.HttpWebRequest]::Create($url)
        $req.Timeout = 8000
        $req.Proxy = $null
        $resp = $req.GetResponse()
        $lector = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $texto = $lector.ReadToEnd(); $lector.Close(); $resp.Close()
        return $texto
    } catch { return $null }
}

# ============================================================================
Titulo "1. El sistema esta andando?"
# ============================================================================
# Antes de nada: Docker RESPONDE? En este proyecto Docker ya se colgo varias
# veces (WSL sin tope de memoria), y cuando pasa, cualquier comando se queda
# esperando para siempre. Sin este tope la ventana se congela sin decir nada y
# la persona no tiene idea de que hacer.
$sonda = Start-Job { docker version --format "{{.Server.Version}}" 2>$null }
if (-not (Wait-Job $sonda -Timeout 45)) {
    Stop-Job $sonda -ErrorAction SilentlyContinue
    Remove-Job $sonda -Force -ErrorAction SilentlyContinue
    Mal "Docker no responde (espere 45 segundos y no contesto)."
    Info "No esta colgado el diagnostico: esta colgado Docker."
    Info "Cerra Docker Desktop desde el icono de la barra, volve a abrirlo,"
    Info "espera a que el icono deje de moverse y proba de nuevo."
    Pop-Location; Read-Host "`nEnter para cerrar"; exit 1
}
$version = (Receive-Job $sonda) -join ""
Remove-Job $sonda -Force -ErrorAction SilentlyContinue
if ("$version".Trim() -eq "") {
    Mal "Docker esta instalado pero el motor no esta andando."
    Info "Abri Docker Desktop y espera a que diga 'Engine running'."
    Pop-Location; Read-Host "`nEnter para cerrar"; exit 1
}
Bien "Docker responde (motor $($version.Trim()))."

$contenedores = @(docker compose -f $Compose --env-file $EnvProd ps -q 2>$null | Where-Object { "$_".Trim() -ne "" })
if ($contenedores.Count -eq 0) {
    Mal "No hay contenedores corriendo. El sistema esta apagado."
    Info "Levantalo con el boton del escritorio y volve a correr esto."
    Pop-Location; Read-Host "`nEnter para cerrar"; exit 1
}
Bien "$($contenedores.Count) contenedores corriendo."

$prueba = Sql "SELECT 1;"
if ($null -eq $prueba) {
    Mal "No pude consultar la base de datos."
    Info "Proba de nuevo en un minuto: puede estar todavia arrancando."
    Pop-Location; Read-Host "`nEnter para cerrar"; exit 1
}
Bien "La base de datos responde."

# ============================================================================
Titulo "2. LA PRUEBA QUE DECIDE: Meta esta llamando al webhook?"
# ============================================================================
# Los acuses de entrega llegan por el mismo webhook que los mensajes entrantes.
$estados = Sql @"
SELECT COALESCE(status,'(sin estado)'), count(*)
FROM "WhatsappMessage"
WHERE direction = 'SALIENTE' AND "createdAt" > now() - interval '7 days'
GROUP BY 1 ORDER BY 2 DESC;
"@

$totalSal = 0; $conAcuse = 0
Write-Host ""
if (-not $estados -or $estados.Count -eq 0) {
    Ojo "No se mando ningun WhatsApp en los ultimos 7 dias."
    Info "Manda uno desde el sistema, esperá un minuto y volve a correr esto."
} else {
    Info "Mensajes que MANDAMOS en los ultimos 7 dias, por estado:"
    foreach ($fila in $estados) {
        $p = "$fila".Split("|")
        $estado = $p[0].Trim(); $cant = [int]$p[1]
        $totalSal += $cant
        if ($estado -in @("delivered", "read")) { $conAcuse += $cant }
        Write-Host ("          {0,-14} {1}" -f $estado, $cant) -ForegroundColor White
    }
}

Write-Host ""
$metaLlama = $null
if ($totalSal -gt 0) {
    if ($conAcuse -gt 0) {
        $metaLlama = $true
        Bien "Meta SI esta llamando al webhook."
        Info "$conAcuse mensajes figuran como entregados o leidos, y ese dato solo"
        Info "puede haber llegado por el webhook. O sea: la URL esta bien puesta,"
        Info "el tunel funciona y el sistema le contesta a Meta."
    } else {
        $metaLlama = $false
        Mal "Meta NO esta llamando al webhook."
        Info "Ningun mensaje paso de 'sent' a 'delivered'. Los acuses viajan por el"
        Info "webhook igual que las respuestas: si no llegan los acuses, no esta"
        Info "llegando NADA. El problema esta en el panel de Meta, no en esta PC."
    }
}

# ============================================================================
Titulo "3. Llego alguna respuesta de un cliente?"
# ============================================================================
$entrantes = Sql @"
SELECT count(*) FROM "WhatsappMessage"
WHERE direction = 'ENTRANTE' AND "createdAt" > now() - interval '7 days';
"@
$huerfanos = Sql @"
SELECT count(*) FROM "MensajeHuerfano"
WHERE "receivedAt" > now() - interval '7 days';
"@

$nEnt = 0; $nHue = 0
if ($entrantes) { $nEnt = [int]("$($entrantes[0])".Trim()) }
if ($huerfanos) { $nHue = [int]("$($huerfanos[0])".Trim()) }

Write-Host ""
Info "Respuestas guardadas en un caso  : $nEnt"
Info "Respuestas sin dueño (huerfanas) : $nHue"
Write-Host ""

if ($nEnt -gt 0) {
    Bien "SI llegan respuestas y se guardan bien."
    Info "Si igual no las ves en pantalla, el problema es de visibilidad:"
    Info "el caso puede ser de otra provincia o de otra area que tu usuario no ve."
} elseif ($nHue -gt 0) {
    Ojo "Las respuestas SI LLEGAN, pero no matchean con ningun caso."
    Info "Quedaron guardadas como huerfanas. Casi siempre es que el telefono"
    Info "cargado en el caso no es el mismo desde el que contesto el cliente."
    Write-Host ""
    Info "Los ultimos numeros que contestaron sin encontrar caso:"
    $ultimos = Sql @"
SELECT telefono, left(content, 40), to_char("receivedAt",'DD/MM HH24:MI')
FROM "MensajeHuerfano" ORDER BY "receivedAt" DESC LIMIT 5;
"@
    foreach ($fila in @($ultimos)) {
        $p = "$fila".Split("|")
        Write-Host ("          {0,-16} {1,-42} {2}" -f $p[0], $p[1], $p[2]) -ForegroundColor White
    }
} else {
    Mal "No llego NINGUNA respuesta en 7 dias, ni siquiera huerfana."
    Info "Confirma lo de arriba: el mensaje del cliente no esta entrando."
}

# ============================================================================
Titulo "4. Que vio el tunel de ngrok"
# ============================================================================
# El inspector de ngrok muestra TODO lo que entro por el tunel, aunque el
# sistema lo haya rechazado. Es la prueba mas directa de que Meta toca la puerta.
$json = Web "http://127.0.0.1:4040/api/requests/http?limit=100"
if (-not $json) {
    Ojo "No pude consultar el inspector de ngrok (localhost:4040)."
    Info "O ngrok no esta corriendo, o se arranco sin la interfaz web."
} else {
    try {
        $datos = $json | ConvertFrom-Json
        $webhookReqs = @($datos.requests | Where-Object { "$($_.uri)" -like "*webhooks*" })
        $posts = @($webhookReqs | Where-Object { $_.method -eq "POST" })
        Write-Host ""
        Info "Requests al webhook que entraron por el tunel : $($webhookReqs.Count)"
        Info "  de esos, POST (mensajes de verdad)          : $($posts.Count)"
        Write-Host ""
        if ($posts.Count -gt 0) {
            Bien "Meta esta tocando la puerta. El tunel y la URL estan bien."
            foreach ($r in ($posts | Select-Object -First 5)) {
                Write-Host ("          POST  ->  {0}" -f $r.response.status) -ForegroundColor White
            }
        } else {
            Mal "Ningun POST de Meta entro por el tunel."
            Info "El tunel funciona (esta pagina abre), pero Meta no le manda nada."
        }
        Info "(ngrok solo recuerda lo ultimo; si se reinicio, empieza de cero.)"
    } catch {
        Ojo "El inspector de ngrok contesto algo que no pude leer."
    }
}

# ============================================================================
Titulo "5. Que dice el registro del sistema"
# ============================================================================
$logs = docker compose -f $Compose --env-file $EnvProd logs backend --since 168h --no-color 2>$null |
        Select-String -Pattern "\[webhook\]" | Select-Object -Last 12
if ($logs) {
    foreach ($l in $logs) { Write-Host "        $($l.Line.Trim())" -ForegroundColor Gray }
} else {
    Info "El sistema no anoto ninguna actividad de webhook en 7 dias."
}

# ============================================================================
Titulo "QUE HACER AHORA"
# ============================================================================
Write-Host ""
if ($metaLlama -eq $false -or ($nEnt -eq 0 -and $nHue -eq 0)) {
    Write-Host "   El problema esta en el panel de Meta, NO en esta PC." -ForegroundColor Yellow
    Write-Host ""
    Info "Entra a developers.facebook.com, elegi la app de Volkswagen y:"
    Write-Host ""
    Write-Host "   1) WhatsApp -> Configuration -> Webhook" -ForegroundColor White
    Info "   Que la URL sea EXACTAMENTE la del tunel de Volkswagen."
    Info "   Si dice el dominio de Ford, ahi esta el error: las respuestas"
    Info "   de los clientes de VW se estan yendo a la PC de Ford."
    Write-Host ""
    Write-Host "   2) En esa misma pantalla, boton 'Manage' de Webhook fields" -ForegroundColor White
    Info "   Que 'messages' tenga el tilde en la columna Subscribed."
    Write-Host ""
    Write-Host "   3) Que la app sea LA MISMA que la del token" -ForegroundColor White
    Info "   Es el error mas comun cuando hay dos apps (Ford y Volkswagen):"
    Info "   el token es de una app y el webhook quedo configurado en la otra."
    Info "   Con eso el ENVIO funciona perfecto y la RESPUESTA no vuelve nunca,"
    Info "   que es exactamente lo que esta pasando."
} elseif ($nHue -gt 0 -and $nEnt -eq 0) {
    Write-Host "   Meta entrega bien. El problema son los telefonos." -ForegroundColor Yellow
    Write-Host ""
    Info "Compara el numero de la lista de arriba con el que tiene cargado"
    Info "el caso. Suelen diferir en el 15 o en el codigo de area."
} else {
    Write-Host "   El circuito de mensajes esta funcionando." -ForegroundColor Green
    Write-Host ""
    Info "Si no ves las respuestas en pantalla, es un tema de permisos:"
    Info "revisa la provincia y el area del usuario con el que entras."
}

Pop-Location
Write-Host ""
Read-Host "Enter para cerrar"
