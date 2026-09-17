# ============================================================================
# Respaldo-Calidad.ps1
# Copia de seguridad DIARIA de la base del Sistema de Calidad a una ubicación
# FUERA de la PC, para no perder NADA si el disco falla.
#
# Destino principal: la carpeta de OneDrive de la empresa del usuario que usa la
# PC (Ford -> yandino, Volkswagen -> ldip), que el cliente de OneDrive sincroniza
# a la nube. Con eso, si esta PC se rompe, la copia ya está arriba. (También
# soporta una carpeta de red por UNC, opcional.)
#
# Lo dispara el VIGILANTE, que ya corre cada 5 minutos en las dos PCs (ver el
# bloque "Respaldo diario" de vigilante.ps1). Antes hacía falta instalar una tarea
# programada a mano, y eso es justo lo que nunca se hizo: Ford estuvo 19 días sin
# respaldo con el log en verde. También se puede correr a mano con
# Respaldo-AHORA.bat.
#
# NUNCA usa el ">" de PowerShell para el dump (corrompe binarios): hace pg_dump
# DENTRO del contenedor y lo saca con "docker cp".
# ============================================================================
[CmdletBinding()]
param(
  [string]$DestinoNube,   # carpeta local que OneDrive sincroniza (si no, se detecta sola)
  [string]$DestinoRed,    # carpeta de red UNC opcional (\\servidor\...)
  [string]$Proyecto,      # carpeta del sistema (donde está docker-compose)
  [string]$EnvFile,       # .env.prod (se copia para poder restaurar el token de Meta)
  [int]$Retencion = 0,    # cuántas copias diarias conservar EN ESTA PC
  [int]$RetencionNube = 0,# cuántas conservar en la nube (decisión del dueño: 7)
  [string]$Contenedor,    # nombre del contenedor de Postgres (si no, se detecta solo)
  [switch]$SinClave,      # NO copiar el .env.prod a la nube (guardás la clave aparte)
  [switch]$SoloSiFalta    # no hacer nada si el respaldo de hoy ya salió bien
)
$ErrorActionPreference = "Stop"

# ---------- Config guardada por el instalador (si existe) ----------
$cfgPath = Join-Path $PSScriptRoot "Respaldo-Config.json"
$cfg = $null
if (Test-Path $cfgPath) {
  try { $cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $cfg = $null }
}
if (-not $Proyecto)    { if ($cfg -and $cfg.proyecto)    { $Proyecto = $cfg.proyecto }    else { $Proyecto = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent } }
if (-not $DestinoRed)  { if ($cfg -and $cfg.destinoRed)  { $DestinoRed  = $cfg.destinoRed } }
if (-not $EnvFile)     { if ($cfg -and $cfg.envFile)     { $EnvFile = $cfg.envFile }       else { $EnvFile = Join-Path $Proyecto ".env.prod" } }
if (-not $Contenedor)  { if ($cfg -and $cfg.contenedor)  { $Contenedor = $cfg.contenedor } }
if ($Retencion -le 0)  { if ($cfg -and $cfg.retencion)   { $Retencion = [int]$cfg.retencion } else { $Retencion = 14 } }

# Una variable del .env.prod puede mandar sobre todo lo demás. Es el lugar natural
# para algo que cambia por PC: ya está fuera del repo, la actualización de las
# 13:00 no lo toca, y se edita sin ser administrador.
function Leer-EnvProd([string]$clave) {
  if (-not (Test-Path $EnvFile)) { return "" }
  foreach ($linea in (Get-Content $EnvFile -ErrorAction SilentlyContinue)) {
    $t = "$linea".Trim()
    if ($t -eq "" -or $t.StartsWith("#")) { continue }
    $i = $t.IndexOf("=")
    if ($i -lt 1) { continue }
    if ($t.Substring(0, $i).Trim() -eq $clave) { return $t.Substring($i + 1).Trim() }
  }
  return ""
}
if ($RetencionNube -le 0) {
  if ($cfg -and $cfg.retencionNube) { $RetencionNube = [int]$cfg.retencionNube }
  else {
    $rn = Leer-EnvProd "RESPALDO_RETENCION_NUBE"
    if ($rn -match '^\d+$') { $RetencionNube = [int]$rn } else { $RetencionNube = 7 }
  }
}
if (-not $SinClave -and ((Leer-EnvProd "RESPALDO_SIN_CLAVE").ToLower() -eq "true")) { $SinClave = $true }

# ---------- Log y estado ----------
$localDir = Join-Path $Proyecto "Respaldos"
if (-not (Test-Path $localDir)) { New-Item -ItemType Directory -Force $localDir | Out-Null }
$logFile    = Join-Path $localDir "respaldo.log"
$statusFile = Join-Path $localDir "ultimo-respaldo.json"
# El mismo sello que mira el bucle de la PC de Volkswagen. Se escribe también acá
# para que, mientras el bucle viejo siga vivo en memoria (relee su propio archivo
# recién al iniciar sesión), no salga un segundo respaldo el mismo día.
$selloFile  = Join-Path $PSScriptRoot "ultimo-respaldo.txt"

# El log no rotaba nunca: en una PC que respalda todos los días crece para
# siempre. Se conserva una generación, igual que el del vigilante.
if ((Test-Path $logFile) -and ((Get-Item $logFile).Length / 1MB -gt 2)) {
  $viejoLog = "$logFile.1"
  if (Test-Path $viejoLog) { Remove-Item $viejoLog -Force -ErrorAction SilentlyContinue }
  Move-Item $logFile $viejoLog -Force -ErrorAction SilentlyContinue
}

function Log($msg) {
  $linea = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Add-Content -Path $logFile -Value $linea -Encoding UTF8
  Write-Host $linea
}

# El estado lo lee el backend para la tarjeta del Dashboard, así que se escribe
# SIN BOM: Set-Content -Encoding UTF8 de PowerShell 5.1 le mete EF BB BF adelante
# y el JSON.parse de Node se cae con eso.
function Guardar-Estado($objeto) {
  $json = $objeto | ConvertTo-Json -Depth 5
  [System.IO.File]::WriteAllText($statusFile, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Leer-Estado {
  if (-not (Test-Path $statusFile)) { return $null }
  try { return (Get-Content $statusFile -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}

# ---------- ¿Ya está hecho el de hoy? ----------
# Lo pregunta el vigilante en cada pasada (cada 5 minutos): sin esto, el respaldo
# se repetiría toda la tarde. Y sirve de red si además quedó instalada la tarea
# vieja "Respaldo Calidad M365" en alguna PC: no salen dos dumps el mismo día.
if ($SoloSiFalta) {
  $previo = Leer-Estado
  if ($previo -and $previo.ok) {
    $cuando = $null
    try { $cuando = [datetime]::Parse($previo.fecha) } catch { }
    if ($cuando -and $cuando.Date -eq (Get-Date).Date) {
      Write-Host "El respaldo de hoy ya está hecho ($($previo.fecha)). No hago nada."
      exit 0
    }
  }
}

# ---------- Dónde está la carpeta de OneDrive ----------
#
# Antes esta ruta se escribía a mano una sola vez, al instalar, y se guardaba en
# Respaldo-Config.json. Ese archivo NO viaja con la actualización (está fuera del
# repo a propósito), así que en una PC donde nadie corrió el instalador no había
# destino: el respaldo quedaba en el mismo disco que la base, que es lo mismo que
# no tener respaldo. Ahora se detecta sola, en este orden:
#   1. lo que venga por parámetro o por Respaldo-Config.json (lo ya instalado manda)
#   2. RESPALDO_DESTINO_NUBE en .env.prod
#   3. la carpeta de OneDrive de la EMPRESA del usuario que tiene la sesión abierta
#
# Lo que NO hace es adivinar: si encuentra varias candidatas o ninguna, avisa. Una
# carpeta equivocada sería otra vez "respaldos que nunca salieron de la PC".
function Carpeta-OneDrive {
  $candidatas = @()
  # La variable del cliente de OneDrive para la cuenta de empresa. Es la más
  # confiable: la pone el propio OneDrive en la sesión.
  if ($env:OneDriveCommercial) { $candidatas += $env:OneDriveCommercial }
  # El registro dice además que hay una cuenta VINCULADA (no solo una carpeta con
  # ese nombre, que puede ser el resto de una sincronización que ya no existe).
  foreach ($cuenta in @("Business1", "Business2", "Business3")) {
    try {
      $v = (Get-ItemProperty -Path "HKCU:\Software\Microsoft\OneDrive\Accounts\$cuenta" -Name "UserFolder" -ErrorAction Stop).UserFolder
      if ($v) { $candidatas += $v }
    } catch { }
  }
  # Solo valen las dos fuentes de arriba, que prueban que la cuenta está
  # VINCULADA. Las carpetas "OneDrive*" del perfil NO se usan como destino: al
  # cerrar sesión o desvincular, OneDrive deja la carpeta en el disco tal cual, y
  # copiar ahí es dejar el respaldo en la misma PC mientras el log dice "copia
  # offsite OK". Ese exacto falso verde es el que hizo que Ford estuviera 19 días
  # sin respaldo sin que nadie se enterara. Si aparece una de esas carpetas
  # huérfanas se usa para EXPLICAR el problema, no para copiar adentro.
  $validas = @($candidatas | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique)
  if ($validas.Count -eq 0) {
    $huerfanas = @(Get-ChildItem -Path $env:USERPROFILE -Directory -Filter "OneDrive*" -ErrorAction SilentlyContinue |
                     ForEach-Object { $_.FullName })
    if ($huerfanas.Count -gt 0) {
      $script:MotivoSinNube = "Hay una carpeta de OneDrive en el perfil ($($huerfanas -join ', ')) pero ninguna cuenta de empresa vinculada: OneDrive esta cerrado o se desvinculo, y copiar ahi seria dejar el respaldo en esta misma PC."
    }
    return $null
  }
  $deEmpresa = @($validas | Where-Object { (Split-Path $_ -Leaf) -like "OneDrive - *" })
  if ($deEmpresa.Count -ge 1) { return $deEmpresa[0] }
  return $validas[0]
}

$origenDestino = ""
if ($DestinoNube) { $origenDestino = "parametro" }
if (-not $DestinoNube -and $cfg -and $cfg.destinoNube) { $DestinoNube = $cfg.destinoNube; $origenDestino = "Respaldo-Config.json" }
if (-not $DestinoNube) {
  $delEnv = Leer-EnvProd "RESPALDO_DESTINO_NUBE"
  if ($delEnv) { $DestinoNube = $delEnv; $origenDestino = ".env.prod" }
}
if (-not $DestinoNube) {
  $raiz = Carpeta-OneDrive
  if ($raiz) {
    $DestinoNube = Join-Path $raiz "Respaldos Calidad"
    $origenDestino = "OneDrive detectado"
    # La SUBCARPETA sí se puede crear (es nuestra); la raíz de OneDrive no, porque
    # si no existe significa que OneDrive no está y hay que avisar, no fabricar
    # una carpeta local que parezca la nube.
    if (-not (Test-Path $DestinoNube)) {
      try { New-Item -ItemType Directory -Force $DestinoNube | Out-Null } catch { }
    }
  }
}

# Candado propio. -SoloSiFalta mira el estado ANTES de empezar, y el estado se
# escribe al final: si en una PC quedó instalada la tarea vieja "Respaldo Calidad
# M365" a la misma hora, los dos arrancaban juntos y se pisaban el archivo
# temporal de adentro del contenedor. Con esto, el segundo se va sin tocar nada.
$candado = Join-Path $localDir "respaldo.lock"
if (Test-Path $candado) {
  $edadCandado = ((Get-Date) - (Get-Item $candado).LastWriteTime).TotalMinutes
  if ($edadCandado -lt 60) {
    Write-Host "Ya hay otro respaldo corriendo (empezó hace $([int]$edadCandado) minutos). No hago nada."
    exit 0
  }
  Remove-Item $candado -Force -ErrorAction SilentlyContinue
}
Set-Content -Path $candado -Value $PID -Encoding UTF8

$fecha     = Get-Date -Format "yyyy-MM-dd_HHmm"
$destinosOk = @()
$rutasOk    = @()
$archivosHechos = @()   # un dump por base
$basesFallidas = @()
$nombre = ""

# Los 5 primeros bytes de un archivo: todo dump -Fc empieza con "PGDMP". Se leen
# solo esos: un dump puede pesar cientos de MB y leerlo entero en memoria en una
# PC de 5,8 GB es justo lo que no hay que hacer.
function Firma-Dump([string]$ruta) {
  try {
    $fs = [System.IO.File]::OpenRead($ruta)
    try {
      $buffer = New-Object byte[] 5
      if ($fs.Read($buffer, 0, 5) -eq 5) { return (-join ($buffer | ForEach-Object { [char]$_ })) }
    } finally { $fs.Close() }
  } catch { }
  return ""
}

# Rotación por DÍA y no por cantidad de archivos, y un solo archivo por día.
#
# Contando archivos, un día con la copia a OneDrive fallada (el vigilante
# reintenta cada hora) dejaba siete dumps del mismo día ocupando los catorce
# lugares: en dos días se borraba todo el historial local, justo cuando esa copia
# local es la única que hay.
function Rotar-Dumps([string]$carpeta, [string[]]$listaBases, [int]$dias) {
  foreach ($b in $listaBases) {
    $porDia = @(Get-ChildItem $carpeta -Filter "$b`_*.dump" -ErrorAction SilentlyContinue |
      Group-Object { if ($_.Name -match '(\d{4}-\d{2}-\d{2})') { $Matches[1] } else { $_.LastWriteTime.ToString("yyyy-MM-dd") } } |
      Sort-Object Name -Descending)
    $i = 0
    foreach ($g in $porDia) {
      $i++
      $delDia = @($g.Group | Sort-Object LastWriteTime -Descending)
      if ($i -gt $dias) { $delDia | Remove-Item -Force -ErrorAction SilentlyContinue }
      else { $delDia | Select-Object -Skip 1 | Remove-Item -Force -ErrorAction SilentlyContinue }
    }
  }
}

# Los comandos nativos (docker) escriben avisos en stderr, y con
# $ErrorActionPreference = "Stop" eso corta el script en seco aunque el comando
# haya terminado bien. Se baja a "Continue" solo alrededor de esas llamadas y se
# mira el código de salida, que es lo que de verdad dice si anduvo.
function Invocar-Docker {
  param([string[]]$Argumentos)
  $previo = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $salida = & docker @Argumentos 2>&1
    return [PSCustomObject]@{ codigo = $LASTEXITCODE; salida = $salida }
  } finally { $ErrorActionPreference = $previo }
}

try {
  Log "=== Iniciando respaldo ==="

  # 1) Detectar el contenedor de Postgres si no vino por config/parámetro.
  if (-not $Contenedor) {
    $r = Invocar-Docker @("ps", "--filter", "name=postgres", "--format", "{{.Names}}")
    # Solo lo que salió por la salida NORMAL: con 2>&1, lo de stderr llega como
    # ErrorRecord y lo de stdout como texto. Sin este filtro, un "WARNING: Error
    # loading config file" de docker (config.json dañado, o una actualización de
    # Docker Desktop) quedaba como nombre del contenedor y el respaldo del día
    # moría con un error que no tenía nada que ver.
    if ($r.codigo -eq 0) { $Contenedor = ($r.salida | Where-Object { $_ -is [string] -and $_.Trim() } | Select-Object -First 1) }
    if ($Contenedor) { $Contenedor = "$Contenedor".Trim() }
  }
  if (-not $Contenedor) {
    throw "No encontré el contenedor de Postgres corriendo. ¿Está prendido Docker y el sistema? (probá 'docker ps')."
  }
  Log "Contenedor Postgres: $Contenedor"

  # 2) TODAS las bases del contenedor, no solo una.
  #
  # Antes se dumpeaba la base de la variable POSTGRES_DB del contenedor, que es
  # una sola. Con dos marcas conviviendo en el mismo Postgres (calidad_ford y
  # calidad_vw), eso respaldaba Ford y dejaba Volkswagen afuera SIN AVISAR: el
  # respaldo seguía diciendo "ok" todas las noches. Ahora se pregunta la lista y
  # se dumpea cada una, así una marca nueva queda cubierta sola.
  # Se usa "psql -lqtA" (listar bases, sin encabezados, separado por "|") y NO una
  # consulta SQL: PowerShell rompe los argumentos que llevan espacios dentro de
  # comillas al pasárselos a docker.exe, y un "SELECT ... FROM ..." llegaba partido
  # al contenedor. Sin SQL no hay nada que romper.
  $r = Invocar-Docker @("exec", $Contenedor, "sh", "-c", 'psql -U "$POSTGRES_USER" -lqtA')
  if ($r.codigo -ne 0) { throw "No pude listar las bases del contenedor (código $($r.codigo))." }
  # Solo las líneas que TIENEN "|" son una base: las plantillas imprimen una
  # segunda línea con sus permisos (ej. "calidad=CTc/calidad") que, sin este
  # filtro, se tomaría como el nombre de una base inexistente.
  $bases = @(
    $r.salida |
      ForEach-Object { "$_" } |
      Where-Object { $_ -match '\|' } |
      ForEach-Object { ($_ -split '\|')[0].Trim() } |
      Where-Object { $_ -and $_ -ne "postgres" -and $_ -notlike "template*" }
  )
  if ($bases.Count -eq 0) { throw "El contenedor no tiene ninguna base de datos para respaldar." }
  Log ("Bases a respaldar: {0}" -f ($bases -join ", "))

  foreach ($base in $bases) {
    # Cada base se respalda por separado y un fallo NO frena a las demás: antes,
    # un problema en la segunda marca dejaba a la primera sin copia offsite ese
    # día, porque la etapa de copia venía después de todos los dumps.
    try {
      $nombreBase = "${base}_$fecha.dump"
      $archivoBase = Join-Path $localDir $nombreBase

      # ¿Ya hay un dump BUENO de esta base de hoy? Pasa cuando la copia a OneDrive
      # falló y el vigilante reintenta a la hora siguiente: sin esto son siete
      # pg_dump completos por día contra el Postgres que la agencia está usando al
      # mediodía, y siete archivos nuevos que empujan la rotación.
      $hoy = Get-Date -Format "yyyy-MM-dd"
      $previoHoy = Get-ChildItem $localDir -Filter "$base`_${hoy}_*.dump" -ErrorAction SilentlyContinue |
                     Sort-Object LastWriteTime -Descending | Select-Object -First 1
      if ($previoHoy -and (Firma-Dump $previoHoy.FullName) -eq "PGDMP") {
        $nombreBase = $previoHoy.Name
        $archivoBase = $previoHoy.FullName
        Log ("Reuso el dump de hoy de '{0}': {1}" -f $base, $nombreBase)
      } else {
        # El nombre de la base y el archivo temporal viajan como variables de
        # entorno del contenedor: así no hay que pelear con el escapado de
        # comillas entre PowerShell y sh. El temporal lleva el número de proceso
        # para que dos respaldos simultáneos nunca se pisen el archivo.
        $tmpCont = "/tmp/cal-$PID.dump"
        $d = Invocar-Docker @("exec", "-e", "BASE_A_RESPALDAR=$base", "-e", "ARCHIVO_TMP=$tmpCont", $Contenedor, "sh", "-c", 'pg_dump -U "$POSTGRES_USER" -Fc "$BASE_A_RESPALDAR" -f "$ARCHIVO_TMP"')
        if ($d.codigo -ne 0) { throw "falló pg_dump (código $($d.codigo))." }
        $c = Invocar-Docker @("cp", "${Contenedor}:$tmpCont", $archivoBase)
        if ($c.codigo -ne 0) { throw "falló 'docker cp' del dump (código $($c.codigo))." }
        Invocar-Docker @("exec", $Contenedor, "rm", "-f", $tmpCont) | Out-Null
      }

      # 3) Verificación por base: que el archivo exista y sea un dump de verdad.
      #
      # Se mira la FIRMA del formato (todo dump -Fc empieza con "PGDMP") y no un
      # tamaño mínimo. Con el mínimo de 1 KB que había antes, una base legítima
      # pero VACIA -la que Postgres crea con el nombre del usuario, o la de una
      # marca recién instalada- contaba como falla y arrastraba a todo el
      # respaldo: el estado quedaba en rojo y salía el aviso por correo aunque
      # las bases con datos estuvieran perfectas.
      if (-not (Test-Path $archivoBase)) { throw "el dump no se generó." }
      $bytesBase = (Get-Item $archivoBase).Length
      if ((Firma-Dump $archivoBase) -ne "PGDMP") { throw "el dump no tiene formato de respaldo de Postgres ($bytesBase bytes)." }
      Log ("Dump local OK: {0} ({1:N0} bytes)" -f $nombreBase, $bytesBase)
      # PSCustomObject y no una tabla hash: en PowerShell 5.1 Measure-Object no ve
      # las claves de un hashtable como propiedades y la suma de bytes falla.
      $archivosHechos += [PSCustomObject]@{
        base = $base; nombre = $nombreBase; ruta = $archivoBase; bytes = $bytesBase
      }
    } catch {
      $basesFallidas += $base
      Log "ERROR respaldando la base '$base': $($_.Exception.Message)"
    }
  }
  if ($archivosHechos.Count -eq 0) { throw "No se pudo respaldar ninguna base ($($basesFallidas -join ', '))." }

  $bytes = ($archivosHechos | Measure-Object -Property bytes -Sum).Sum
  $nombre = ($archivosHechos | ForEach-Object { $_.nombre }) -join ", "

  # 4) Copias offsite (nube M365 y/o red). Cada destino falla de forma aislada.
  $destinos = @()
  if ($DestinoNube) { $destinos += ,@("nube (OneDrive)", $DestinoNube, $RetencionNube) }
  if ($DestinoRed)  { $destinos += ,@("red", $DestinoRed, $Retencion) }
  if ($destinos.Count -eq 0) {
    Log "AVISO: no encontré ninguna carpeta de OneDrive y no hay destino configurado. La copia quedó SOLO en esta PC ($localDir)."
    Log "AVISO: iniciá sesión en OneDrive, o poné la carpeta en RESPALDO_DESTINO_NUBE del .env.prod."
  } else {
    Log ("Destino de nube: {0} (origen: {1})" -f $DestinoNube, $origenDestino)
  }
  foreach ($d in $destinos) {
    $etiqueta = $d[0]; $ruta = $d[1]; $cuantas = $d[2]
    try {
      # LA CARPETA DE DESTINO TIENE QUE EXISTIR. Antes, si no existia se la
      # creaba con -Force, y eso convirtio una falla en un exito falso: cuando
      # la biblioteca de OneDrive se desvincula o la renombran, el script
      # fabricaba una carpeta LOCAL comun con ese nombre, copiaba adentro, y
      # logueaba "Copia offsite OK" todas las noches. Meses de respaldos que
      # nunca salieron de la PC, con el log en verde. Ahora es un error de ese
      # destino: se avisa y NO cuenta como hecho.
      if (-not (Test-Path $ruta)) {
        throw "la carpeta de destino no existe. Si es la de OneDrive, fijate que siga sincronizada y que la sesión esté iniciada."
      }
      foreach ($a in $archivosHechos) {
        Copy-Item $a.ruta (Join-Path $ruta $a.nombre) -Force
      }
      $destinosOk += $etiqueta
      $rutasOk += $ruta
      Log ("Copia offsite OK -> {0} : {1} ({2} archivo/s)" -f $etiqueta, $ruta, $archivosHechos.Count)

      # Clave para restaurar: el .env.prod tiene CONFIG_ENCRYPTION_KEY, sin la
      # cual el token de Meta guardado en la base no se puede descifrar. Va a una
      # subcarpeta aparte que DEBE tener permisos restringidos (ver README).
      if (-not $SinClave -and (Test-Path $EnvFile)) {
        $restaurarDir = Join-Path $ruta "_RESTAURAR-NO-BORRAR"
        if (-not (Test-Path $restaurarDir)) { New-Item -ItemType Directory -Force $restaurarDir | Out-Null }
        Copy-Item $EnvFile (Join-Path $restaurarDir "env.prod.copia") -Force
      }

      # Rotación en el destino: N copias POR BASE, no N en total. Si se contaran
      # todas juntas, con dos marcas cada una conservaría la mitad de los días.
      # En la nube se guardan menos días que en la PC (decisión del dueño: 7),
      # para no comerse la cuota de OneDrive.
      Rotar-Dumps $ruta $bases $cuantas
    } catch {
      Log "ERROR copiando a $etiqueta ($ruta): $($_.Exception.Message)"
    }
  }

  # 5) Rotación local, también por base y por día.
  Rotar-Dumps $localDir $bases $Retencion
  # Dumps con el nombre VIEJO (calidad_<fecha>.dump, de una sola base): ya no se
  # generan, pero los que quedaron de antes hay que seguir rotándolos o se
  # acumulan para siempre.
  Get-ChildItem $localDir -Filter "calidad_20*.dump" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -Skip $Retencion |
    Remove-Item -Force -ErrorAction SilentlyContinue

  # 6) Estado: lo lee la tarjeta del Dashboard y el vigilante para avisar por mail.
  #
  # "ok" ES SI EL RESPALDO SALIO DE ESTA PC, no si el pg_dump anduvo. Antes era
  # $true fijo: con la copia offsite fallada, o directamente sin ningun destino
  # configurado, este archivo decia ok=true igual. Y el README manda a verificar
  # justo por ese campo. Un dump que queda en el mismo disco que la base no es
  # un respaldo: si ese disco se rompe, se rompen los dos.
  $salioDeLaPc = ($destinosOk.Count -gt 0)
  $motivo = $null
  if (-not $salioDeLaPc) {
    if ($destinos.Count -eq 0) {
      if ($script:MotivoSinNube) { $motivo = $script:MotivoSinNube + " Inicia sesion en OneDrive, o carga RESPALDO_DESTINO_NUBE en el .env.prod." }
      else { $motivo = "No hay ninguna carpeta de OneDrive donde copiar: la base quedo en esta misma PC. Inicia sesion en OneDrive o carga RESPALDO_DESTINO_NUBE en el .env.prod." }
    }
    else { $motivo = "Fallaron TODOS los destinos offsite: la copia quedo en esta misma PC. Ver respaldo.log." }
  } elseif ($basesFallidas.Count -gt 0) {
    $motivo = "Se respaldaron unas bases pero fallaron otras: $($basesFallidas -join ', '). Ver respaldo.log."
  }
  # La fecha va con zona horaria ("o" y no "s"): el backend la lee desde adentro
  # de un contenedor, que no siempre está en la misma hora que Windows.
  $estado = [ordered]@{
    fecha = (Get-Date -Format "o"); ok = ($salioDeLaPc -and $basesFallidas.Count -eq 0)
    archivo = $nombre; bytes = $bytes
    # Qué bases se respaldaron y cuánto pesó cada una. Sirve para darse cuenta de
    # que falta una: si un día aparece solo calidad_ford, algo pasó con la otra.
    bases = @($archivosHechos | ForEach-Object { [PSCustomObject]@{ base = $_.base; archivo = $_.nombre; bytes = $_.bytes } })
    basesFallidas = @($basesFallidas)
    destinosOffsite = @($destinosOk); rutasOffsite = @($rutasOk); contenedor = $Contenedor; error = $motivo
  }
  Guardar-Estado $estado
  if ($estado.ok) {
    # Sello compartido con el bucle de la PC de Volkswagen (ver arriba).
    try { Set-Content -Path $selloFile -Value (Get-Date -Format "yyyy-MM-dd") -Encoding UTF8 } catch { }
    Log "=== Respaldo terminado OK (offsite: $($destinosOk -join ', ')) ==="
  } elseif ($salioDeLaPc) {
    Log "=== Respaldo terminado A MEDIAS (faltaron bases: $($basesFallidas -join ', ')) ==="
  } else {
    Log "=== Respaldo terminado (SOLO LOCAL: sin copia fuera de la PC) ==="
  }
}
catch {
  $err = $_.Exception.Message
  $estado = [ordered]@{
    fecha = (Get-Date -Format "o"); ok = $false; archivo = $nombre; bytes = 0
    bases = @(); basesFallidas = @($basesFallidas)
    destinosOffsite = @($destinosOk); rutasOffsite = @($rutasOk); error = $err
  }
  try { Guardar-Estado $estado } catch { }
  Log "ERROR: $err"
  throw
}
finally {
  Remove-Item $candado -Force -ErrorAction SilentlyContinue
}
