# ============================================================================
#  Dejar el webhook LISTO para configurarlo en Meta
# ============================================================================
#  EL PROBLEMA QUE RESUELVE: Meta valida la URL EN EL MOMENTO en que apretás
#  "Verificar y guardar". Si el túnel de ngrok no está vivo justo en ese
#  instante, rebota con un error que no explica nada, y uno se queda mirando el
#  panel sin saber si está mal el token, la URL, o qué.
#
#  Este script hace, en orden, lo que tiene que estar antes de tocar Meta:
#    1. Que el sistema conteste en esta PC.
#    2. Que ngrok esté corriendo (y si no, lo levanta).
#    3. Que el túnel llegue de verdad DESDE AFUERA hasta el sistema.
#    4. Que la URL pública conteste el saludo de verificación EXACTO que manda
#       Meta, con el token de esta PC.
#
#  Recién cuando los cuatro dan bien, imprime qué pegar en el panel.
# ============================================================================

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$ProjectDir = if ($PSScriptRoot) { Split-Path (Split-Path $PSScriptRoot -Parent) -Parent } else { (Get-Location).Path }
$EnvFile = Join-Path $ProjectDir ".env.prod"

function Leer([string]$clave, [string]$porDefecto = "") {
  if (-not (Test-Path $EnvFile)) { return $porDefecto }
  foreach ($linea in (Get-Content $EnvFile -ErrorAction SilentlyContinue)) {
    $l = "$linea".Trim()
    if ($l -eq "" -or $l.StartsWith("#")) { continue }
    $i = $l.IndexOf("=")
    if ($i -lt 1) { continue }
    if ($l.Substring(0, $i).Trim() -eq $clave) {
      $v = $l.Substring($i + 1).Trim()
      if ($v -ne "") { return $v }
    }
  }
  return $porDefecto
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

function Bien($t) { Write-Host "  [OK]  $t" -ForegroundColor Green }
function Mal($t)  { Write-Host "  [!]   $t" -ForegroundColor Red }
function Info($t) { Write-Host "        $t" -ForegroundColor Gray }

Write-Host ""
Write-Host "  Preparando el webhook..." -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $EnvFile)) {
  Mal "No encuentro el archivo .env.prod en $ProjectDir"
  Read-Host "`nEnter para cerrar"; exit 1
}

$dominio = Leer "NGROK_DOMAIN"
$puerto  = Leer "HTTP_PORT" "80"
$verify  = Leer "META_WEBHOOK_VERIFY_TOKEN"
$marca   = Leer "MARCA" "FORD"

if (-not $dominio) { Mal "Falta NGROK_DOMAIN en el .env.prod"; Read-Host "`nEnter para cerrar"; exit 1 }
if (-not $verify)  { Mal "Falta META_WEBHOOK_VERIFY_TOKEN en el .env.prod"; Read-Host "`nEnter para cerrar"; exit 1 }

# ---------- 1. El sistema, en esta PC ----------
Write-Host "  1/4  El sistema en esta PC" -ForegroundColor White
$urlLocal = if ($puerto -eq "80") { "http://localhost" } else { "http://localhost:$puerto" }
$vivo = $false
$ultimoError = ""
foreach ($intento in 1..30) {
  $r = Consultar-Web "$urlLocal/api/health" 8
  if ($r.ok) {
    try { if (($r.texto | ConvertFrom-Json).status -eq "ok") { $vivo = $true; break } } catch { }
  }
  $ultimoError = $r.error
  if ($intento -eq 1) { Info "todavia no responde, esperando (puede estar arrancando)..." }
  Start-Sleep -Seconds 5
}
if (-not $vivo) {
  Mal "El sistema no responde en $urlLocal"
  if ($ultimoError) { Info "Motivo exacto: $ultimoError" }
  Info "Si en el navegador SI se ve, avisale a Ignacio con ese motivo: puede ser"
  Info "el proxy de la empresa metiendose en una consulta local."
  Info "Si tampoco se ve, levantalo con Levantar-sistema.bat y volve a correr esto."
  Read-Host "`nEnter para cerrar"; exit 1
}
Bien "responde, y esta configurado como $marca"

# ---------- 2. ngrok corriendo ----------
Write-Host ""
Write-Host "  2/4  El tunel de ngrok" -ForegroundColor White
function NgrokVivo { return [bool](Get-Process -Name "ngrok" -ErrorAction SilentlyContinue) }

if (NgrokVivo) {
  Bien "ngrok ya estaba corriendo"
} else {
  Info "ngrok no estaba corriendo: lo levanto"
  # Si el instalador ya dejo la tarea programada, se usa esa (queda oculta y se
  # mantiene sola). Si no, se lanza a mano.
  $tarea = Get-ScheduledTask -TaskName "Sistema de Calidad - ngrok" -ErrorAction SilentlyContinue
  if ($tarea) {
    Start-ScheduledTask -TaskName "Sistema de Calidad - ngrok" -ErrorAction SilentlyContinue
    Info "arrancado por su tarea programada"
  } else {
    $exe = (Get-Command ngrok -ErrorAction SilentlyContinue).Source
    if (-not $exe) {
      $wg = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe"
      if (Test-Path $wg) { $exe = $wg }
    }
    if (-not $exe) {
      Mal "No encuentro ngrok instalado."
      Info "Instalalo con:  winget install --id Ngrok.Ngrok -e --source winget"
      Read-Host "`nEnter para cerrar"; exit 1
    }
    Start-Process -FilePath $exe -ArgumentList "http --domain=$dominio $puerto" -WindowStyle Hidden
    Info "arrancado a mano"
  }
  foreach ($i in 1..20) { Start-Sleep -Seconds 2; if (NgrokVivo) { break } }
  if (NgrokVivo) { Bien "ngrok arriba" } else { Mal "no pude levantar ngrok"; Read-Host "`nEnter para cerrar"; exit 1 }
}

# ---------- 3. El tunel llega DESDE AFUERA ----------
Write-Host ""
Write-Host "  3/4  Que el tunel llegue desde internet" -ForegroundColor White
Info "https://$dominio  ->  $urlLocal"
$llega = $false
$errorTunel = ""
foreach ($intento in 1..24) {
  $r = Consultar-Web "https://$dominio/api/health" 10
  if ($r.ok) {
    try { if (($r.texto | ConvertFrom-Json).status -eq "ok") { $llega = $true; break } } catch { }
  }
  $errorTunel = $r.error
  if ($intento -eq 1) { Info "el tunel tarda unos segundos en levantar..." }
  Start-Sleep -Seconds 5
}
if (-not $llega) {
  Mal "El tunel NO llega. Meta te va a rechazar el webhook."
  if ($errorTunel) { Info "Motivo exacto: $errorTunel" }
  Info "Revisa: (a) que el dominio del .env.prod sea el de ESTA cuenta de ngrok,"
  Info "        (b) que ngrok tenga cargado el token correcto,"
  Info "            ngrok config add-authtoken <el token de la cuenta>"
  Info "        (c) que no haya OTRO ngrok corriendo con otro dominio."
  Read-Host "`nEnter para cerrar"; exit 1
}
Bien "el tunel llega bien de punta a punta"

# ---------- 4. El saludo EXACTO que manda Meta ----------
Write-Host ""
Write-Host "  4/4  El saludo de verificacion de Meta" -ForegroundColor White
$desafio = "prueba" + (Get-Random -Minimum 100000 -Maximum 999999)
$url = "https://$dominio/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=" +
       [uri]::EscapeDataString($verify) + "&hub.challenge=$desafio"
$rs = Consultar-Web $url 20
if ($rs.ok) {
  $cuerpo = "$($rs.texto)".Trim()
  if ($cuerpo -eq $desafio) {
    Bien "contesta el saludo correctamente"
  } else {
    Mal "contesta, pero devuelve '$cuerpo' en vez de '$desafio'"
    Read-Host "`nEnter para cerrar"; exit 1
  }
} else {
  Mal "el saludo fallo: $($rs.error)"
  Info "Casi siempre es que el META_WEBHOOK_VERIFY_TOKEN del .env.prod no es el"
  Info "mismo que estas poniendo en el panel de Meta. Tienen que ser IDENTICOS."
  Read-Host "`nEnter para cerrar"; exit 1
}

# ---------- Lo que hay que pegar ----------
Write-Host ""
Write-Host "  =========================================================" -ForegroundColor Green
Write-Host "   TODO LISTO. Ya podes configurar el webhook en Meta." -ForegroundColor Green
Write-Host "  =========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "   Callback URL : " -ForegroundColor White -NoNewline
Write-Host "https://$dominio/api/webhooks/whatsapp" -ForegroundColor Yellow
Write-Host "   Verify token : " -ForegroundColor White -NoNewline
Write-Host "$verify" -ForegroundColor Yellow
Write-Host "   Suscribir a  : " -ForegroundColor White -NoNewline
Write-Host "messages" -ForegroundColor Yellow
Write-Host ""
Write-Host "   HACELO AHORA, sin cerrar esta ventana: mientras ngrok siga" -ForegroundColor Cyan
Write-Host "   corriendo, Meta va a poder verificar la URL." -ForegroundColor Cyan
Write-Host ""
Read-Host "Enter para cerrar"
