<#
  instalar-todo.ps1 — Instalador TODO-EN-UNO del Sistema de Calidad.

  Corre en DOS FASES (una sola ejecución):
   • FASE NORMAL (sin elevar): carga el token de ngrok, espera a Docker, hace el
     build + arranque y restaura los datos. Va en modo NORMAL A PROPÓSITO: Docker
     Desktop solo deja que la sesión normal del usuario llegue a su motor; un
     proceso ELEVADO (admin) NO llega a Docker.
   • FASE ADMIN (se auto-eleva sola al final): deja la PC sin suspensión, pone
     Docker en el arranque y registra el VIGILANTE en modo normal, para que cada
     vez que la usuaria inicie sesión el sistema levante y se repare SOLO.

  Se corre con doble clic en INSTALAR-SISTEMA.bat (que NO eleva). La cuenta de
  Windows tiene que ser administradora. Es IDEMPOTENTE.

  ErrorActionPreference = Continue A PROPÓSITO (los comandos nativos escriben en
  stderr y con "Stop" cortan el script); se chequea el resultado con $LASTEXITCODE.
#>
[CmdletBinding()]
param([switch]$FaseAdmin, [string]$Proyecto, [string]$Usuario, [string]$NgrokExe)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"
function Titulo($t) { Write-Host "`n===== $t =====" -ForegroundColor Cyan }
function Ok($t)     { Write-Host "  [OK]  $t" -ForegroundColor Green }
function Info($t)   { Write-Host "  $t" -ForegroundColor Gray }
function Aviso($t)  { Write-Host "  [!]   $t" -ForegroundColor Yellow }
function Fatal($t)  { Write-Host "  [ERROR] $t" -ForegroundColor Red; Read-Host "`nEnter para salir"; exit 1 }

if (-not $Proyecto) { $Proyecto = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent }
$ComposeFile = Join-Path $Proyecto "docker-compose.prod.yml"
$EnvFile     = Join-Path $Proyecto ".env.prod"
$Vigilante   = Join-Path $PSScriptRoot "vigilante.ps1"

# ---------------------------------------------------------------------------
#  Registrar una tarea programada
# ---------------------------------------------------------------------------
#  DOS COSAS QUE NO SE PUEDEN USAR ACA, Y POR QUE:
#
#  1. Los cmdlets New-ScheduledTaskAction / -Trigger / -SettingsSet.
#     Hablan con el Programador a traves de WMI, y en la PC de Volkswagen esa
#     capa esta rota: todos fallan con "No se puede conectar al servidor CIM"
#     aunque el servicio Programador de tareas este corriendo perfecto.
#
#  2. schtasks /create /XML.
#     Probado en esa misma PC: devuelve "Acceso denegado", con y sin /RU. En
#     cambio schtasks con PARAMETROS SUELTOS funciona sin problema; se comprobo
#     creando tareas de prueba con cmd.exe y con powershell -ExecutionPolicy
#     Bypass, y las dos se crearon bien. Asi que el problema es el XML: no son
#     los permisos, ni el antivirus, ni una politica de dominio.
#
#  Por eso: parametros sueltos. Lo que se pierde con ellos, y como queda cubierto:
#
#    - IgnoreNew (no arrancar una segunda instancia): NO hace falta. El propio
#      vigilante.ps1 se protege con un archivo de candado (vigilante-calidad.lock,
#      con vencimiento por si queda huerfano).
#    - StartWhenAvailable: irrelevante con /SC MINUTE, que vuelve a intentar a los
#      5 minutos de todas formas.
#    - ExecutionTimeLimit: schtasks no tiene flag para esto, asi que las tareas
#      quedan con el limite por defecto de 72 horas. Para el vigilante da igual
#      (una corrida dura segundos). Para ngrok significa que a los 3 dias Windows
#      lo corta; lo revive el vigilante en la pasada siguiente, que es el
#      comportamiento que ya estaba previsto.
#
#  /RU + /IT registra la tarea A NOMBRE DE OTRO USUARIO sin pedir su contrasena.
#  Hace falta porque en la empresa el que instala es un administrador y el que usa
#  la PC es otra persona que, por politica del dominio, no puede ser
#  administrador. /IT (interactive only) es lo que evita la contrasena: la tarea
#  corre solo cuando ese usuario tiene sesion iniciada, que es justo lo que se
#  quiere, porque fuera de su sesion no llegaria a Docker igual.
function Registrar-Tarea {
  param(
    [string]$Nombre,
    [string]$Comando,
    [string]$Argumentos,
    [string]$Usuario,
    [string]$Descripcion,
    [int]$CadaMinutos = 0   # 0 = al iniciar sesion; >0 = cada N minutos
  )

  $tr = "$Comando $Argumentos"
  $parametros = @("/create", "/TN", $Nombre, "/TR", $tr)
  # CadaMinutos > 0  -> /SC MINUTE /MO N   (el vigilante)
  # CadaMinutos = 0  -> /SC ONLOGON        (ngrok, que tiene que quedar vivo)
  #
  # OJO CON ONLOGON: en la PC de Volkswagen es la UNICA variante que devuelve
  # "Acceso denegado". Se probaron todas las demas y se crean bien: /SC MINUTE,
  # /SC ONCE, con cmd.exe, con powershell, y con /RU de otra cuenta. Debe ser una
  # regla anti-persistencia del EDR corporativo, que es justo el disparador que
  # usa el malware para arrancar con la sesion.
  #
  # NO se cambia ONLOGON por MINUTE para ngrok: sin IgnoreNew (que schtasks no
  # sabe expresar) una tarea cada 5 minutos abriria un tunel nuevo cada vez.
  # En las PCs donde ONLOGON falla, la tarea de ngrok simplemente no se crea y el
  # vigilante se encarga; ver el aviso mas abajo.
  if ($CadaMinutos -gt 0) { $parametros += @("/SC", "MINUTE", "/MO", "$CadaMinutos") }
  else                    { $parametros += @("/SC", "ONLOGON") }

  # Si la tarea es para OTRA cuenta hace falta /RU. Si es para uno mismo, /RU
  # sobra y en algunas PCs molesta, asi que se omite.
  $propio = (-not $Usuario) -or ($Usuario -eq "$env:USERDOMAIN\$env:USERNAME")
  if (-not $propio) { $parametros += @("/RU", $Usuario, "/IT") }
  $parametros += "/F"

  $salida = & schtasks @parametros 2>&1
  if ($LASTEXITCODE -eq 0) { return @{ ok = $true; detalle = "" } }

  # Reintento sin /RU: sirve cuando el que instala ES el usuario de todos los dias.
  if (-not $propio) {
    $p2 = @("/create", "/TN", $Nombre, "/TR", $tr)
    if ($CadaMinutos -gt 0) { $p2 += @("/SC", "MINUTE", "/MO", "$CadaMinutos") }
    else                    { $p2 += @("/SC", "ONLOGON") }
    $p2 += "/F"
    $salida2 = & schtasks @p2 2>&1
    if ($LASTEXITCODE -eq 0) {
      return @{ ok = $true; detalle = "OJO: quedo a nombre de $env:USERNAME, no de $Usuario" }
    }
    $salida = (($salida | Out-String) + ($salida2 | Out-String))
  }
  return @{ ok = $false; detalle = ($salida | Out-String).Trim() }
}

# Lee una clave del .env.prod de ESTA PC. Igual que en vigilante.ps1 y en
# iniciar-sistema.bat: nada que dependa de la marca puede quedar escrito en el
# script, porque el mismo instalador corre en la PC de Ford y en la de VW.
function Leer-EnvProd([string]$clave, [string]$porDefecto = "") {
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

# Contenedor de un servicio, resuelto por el PROPIO compose (no por filtro de
# nombre, que es substring y podría pegarle a otro stack).
function Contenedor($svc) {
  return (docker compose -f $ComposeFile --env-file $EnvFile ps -q $svc 2>$null | Select-Object -First 1)
}

# Docker Desktop.exe: las versiones nuevas se instalan POR USUARIO en
# %LOCALAPPDATA%\Programs\DockerDesktop; las viejas en Program Files. Se usa la
# primera candidata que exista (asi no importa donde este instalado).
function Resolver-DockerExe {
  $c = @(
    "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe",
    "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
    "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($c) { return $c }
  return "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe"
}

# =====================================================================
#  FASE ADMIN (elevada): energía + Docker al arranque + tarea del vigilante
# =====================================================================
if ($FaseAdmin) {
  Titulo "Arranque automático (modo administrador)"
  $errores = 0
  # Usuario destino de la tarea/autostart: el ORIGINAL (por si se elevó con otra
  # cuenta admin). Si no vino, el actual.
  $usuarioDestino = if ($Usuario) { $Usuario } else { "$env:USERDOMAIN\$env:USERNAME" }
  $mismoUsuario = ($usuarioDestino -ieq "$env:USERDOMAIN\$env:USERNAME")

  # 1) La PC nunca se suspende.
  powercfg /change standby-timeout-ac 0   | Out-Null
  powercfg /change standby-timeout-dc 0   | Out-Null
  powercfg /change hibernate-timeout-ac 0 | Out-Null
  powercfg /change hibernate-timeout-dc 0 | Out-Null
  Ok "La PC ya no se suspende."

  # 2) Docker Desktop arranca al iniciar sesión (en el HKCU del usuario destino).
  $dockerExe = Resolver-DockerExe
  if (Test-Path $dockerExe) {
    if ($mismoUsuario) {
      Set-ItemProperty "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" "Docker Desktop" ('"' + $dockerExe + '" -Autostart') -ErrorAction SilentlyContinue
      Ok "Docker Desktop arranca al iniciar sesión."
    } else {
      Aviso "Elevaste con OTRA cuenta admin: el autostart de Docker hay que ponerlo en la sesión de $usuarioDestino a mano (Docker Desktop -> Settings -> General -> Start when you sign in)."
    }
  }

  # 3) VIGILANTE en modo NORMAL (RunLevel Limited): al iniciar sesión + cada 5 min.
  #    Limited (no Highest) para que, corriendo en la sesión de la usuaria, SÍ
  #    llegue a Docker y pueda levantar/reparar los contenedores y ngrok.
  if (Test-Path $Vigilante) {
    # SIN .vbs, A PROPOSITO. Antes esto se lanzaba con un VBS de dos lineas cuyo
    # unico trabajo era ocultar la ventana (wscript con ventana 0). Funcionaba,
    # pero un .vbs en carpeta de usuario que ejecuta "powershell -ExecutionPolicy
    # Bypass" es el patron de malware que todo antivirus busca: en la PC de Ford
    # el antivirus lo borro y el vigilante dejo de correr, o sea que el sistema
    # se quedo sin nadie que lo repare. Restaurarlo no sirve, lo vuelve a borrar.
    #
    # Lo que se pierde: con -WindowStyle Hidden, Windows puede alcanzar a mostrar
    # la consola un instante antes de esconderla. Es un parpadeo de milisegundos
    # cada 5 minutos. Molesto, pero infinitamente mejor que quedarse sin
    # vigilante. Se limpia el .vbs viejo si quedo dando vueltas de una
    # instalacion anterior.
    $vbsVig = Join-Path $PSScriptRoot "vigilante-oculto.vbs"
    if (Test-Path $vbsVig) { Remove-Item $vbsVig -Force -ErrorAction SilentlyContinue }
    $argVig = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command & '$Vigilante'"
    $r = Registrar-Tarea -Nombre "Sistema de Calidad - Vigilante" -Comando "powershell.exe" `
      -Argumentos $argVig -Usuario $usuarioDestino -CadaMinutos 5 `
      -Descripcion "Vigilante del Sistema de Calidad: levanta y repara el stack cada 5 minutos."
    if ($r.ok) {
      Ok "Vigilante registrado (arranca y repara solo, en modo normal)."
      # schtasks /run tampoco usa CIM, a diferencia de Start-ScheduledTask.
      if ($mismoUsuario) { schtasks /run /TN "Sistema de Calidad - Vigilante" 2>&1 | Out-Null }
    } else {
      Aviso "No pude registrar el vigilante: $($r.detalle)"
      $errores++
    }
  } else {
    Aviso "No encontré vigilante.ps1: no se registró el arranque automático."
    $errores++
  }

  # 4) ngrok CON TAREA PROPIA. Esto NO es opcional donde se pueda registrar.
  #
  #    Un ngrok lanzado por el vigilante queda como proceso HIJO de la tarea del
  #    vigilante, y Windows mata a los hijos cuando la tarea termina. En la PC de
  #    Ford eso se veia como "ngrok no estaba corriendo: relanzandolo" cada pocos
  #    minutos, para siempre. Con su propia tarea, ngrok es un proceso de primera
  #    clase y sobrevive.
  #
  #    Si la tarea no se puede crear (en Volkswagen /SC ONLOGON da "Acceso
  #    denegado"), NO es fatal: el vigilante detecta que la tarea no existe y
  #    lanza ngrok el mismo. Ahi no hay tarea que lo mate, porque en esas PCs el
  #    vigilante corre desde la carpeta de Inicio, no como tarea programada
  #    (ver Instalar-Arranque-Sin-Tareas.ps1).
  if ($NgrokExe -and (Test-Path $NgrokExe)) {
    $dominioNgrok = Leer-EnvProd "NGROK_DOMAIN" "dealer-occupant-brigade.ngrok-free.dev"
    $puertoNgrok  = Leer-EnvProd "HTTP_PORT" "80"
    Info "Tunel de esta PC: https://$dominioNgrok -> localhost:$puertoNgrok"
    $argNg = "-NoProfile -NonInteractive -WindowStyle Hidden -Command & '$NgrokExe' http --domain=$dominioNgrok $puertoNgrok"
    $r = Registrar-Tarea -Nombre "Sistema de Calidad - ngrok" -Comando "powershell.exe" `
      -Argumentos $argNg -Usuario $usuarioDestino -CadaMinutos 0 `
      -Descripcion "Tunel ngrok del Sistema de Calidad. Se mantiene vivo solo."
    if ($r.ok) {
      Ok "ngrok registrado como tarea propia (se mantiene vivo solo)."
      if ($mismoUsuario) { schtasks /run /TN "Sistema de Calidad - ngrok" 2>&1 | Out-Null }
    } else {
      Aviso "No pude registrar la tarea de ngrok: lo va a levantar el vigilante."
      Info  "Si el vigilante quedo como TAREA programada, ngrok se le puede morir seguido."
      Info  "En ese caso conviene el arranque por carpeta de Inicio:"
      Info  "   scripts\windows\Instalar-Arranque-Sin-Tareas.bat"
    }
  } else {
    Aviso "No encontre ngrok: no registro su tarea (lo intentara el vigilante)."
  }

  if ($errores -gt 0) { Read-Host "`nHubo un problema en el arranque automático. Enter para cerrar"; exit 1 }
  Start-Sleep 2
  exit 0
}

# =====================================================================
#  FASE NORMAL (sin elevar): ngrok + Docker + build + restore
# =====================================================================
Write-Host "Instalador del Sistema de Calidad" -ForegroundColor White
Info "Proyecto: $Proyecto"
$esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

# ---- 1) Token de ngrok ----
Titulo "1/5  Token de ngrok"
$ngrok = (Get-Command ngrok -ErrorAction SilentlyContinue).Source
if (-not $ngrok) {
  $wg = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe"
  if (Test-Path $wg) { $ngrok = $wg }
}
if (-not $ngrok) {
  Aviso "ngrok no está instalado. Instalalo con:"
  Info  "  winget install --id Ngrok.Ngrok -e --source winget --accept-source-agreements --accept-package-agreements"
} else {
  $tokenFile = Join-Path $PSScriptRoot "ngrok-token.txt"
  if (Test-Path $tokenFile) {
    $tok = ((Get-Content $tokenFile -Raw -ErrorAction SilentlyContinue) -replace '\s', '')
    if ($tok) { & $ngrok config add-authtoken $tok | Out-Null; Ok "Token de ngrok cargado desde ngrok-token.txt." }
    else { Info "ngrok-token.txt está vacío (se usa el token que ya tenga ngrok, si hay)." }
  } else {
    Info "No hay ngrok-token.txt (se usa el token que ya tenga ngrok configurado, si hay)."
  }
}

# ---- 2) Docker ----
Titulo "2/5  Docker"
function Docker-Vivo { cmd /c "docker info >nul 2>&1"; return ($LASTEXITCODE -eq 0) }
if (-not (Docker-Vivo)) {
  # Si estamos ELEVADOS, Docker nunca va a responder (el pipe es de la sesión
  # normal): cortamos de una con el mensaje correcto en vez de esperar 4 min.
  if ($esAdmin) {
    Fatal "Estás como ADMINISTRADOR y por eso Docker no responde. Cerrá esta ventana y abrí el instalador con DOBLE CLIC (sin 'ejecutar como administrador')."
  }
  Aviso "Docker no responde todavía. Abro Docker Desktop y espero (hasta 4 min)..."
  $exe = Resolver-DockerExe
  if (Test-Path $exe) { Start-Process $exe }
  for ($i = 0; $i -lt 40; $i++) { Start-Sleep 6; if (Docker-Vivo) { break } }
}
if (-not (Docker-Vivo)) {
  Fatal "Docker no responde. Abrí Docker Desktop, esperá a que diga 'Engine running', y corré el instalador de NUEVO (doble clic, SIN admin)."
}
Ok "Docker está corriendo."

# ---- 3) .env.prod ----
Titulo "3/5  Configuración (.env.prod)"
if (-not (Test-Path $EnvFile)) { Fatal "Falta el archivo .env.prod en la carpeta del proyecto." }
Ok ".env.prod encontrado."

# ---- 4) Construir y levantar ----
Titulo "4/5  Construir y levantar el sistema (la 1ra vez tarda VARIOS MINUTOS)"
docker compose -f $ComposeFile --env-file $EnvFile up -d --build
if ($LASTEXITCODE -ne 0) { Fatal "Falló el build/arranque de los contenedores. Revisá el error de arriba." }
Ok "Contenedores levantados."

# ---- 5) Restaurar datos ----
Titulo "5/5  Restaurar datos"

# Cuenta filas de tablas con datos REALES (no Usuario, que en una instalación
# fresca ya trae el admin sembrado). El SQL va por STDIN a propósito: pasarlo como
# argumento (-c "...\"Caso\"...") se parte en PowerShell 5.1 y el conteo nunca corre.
function Contar-Datos($contenedor) {
  $sql = 'SELECT COALESCE((SELECT count(*) FROM "Caso"),0) + COALESCE((SELECT count(*) FROM "WhatsappMessage"),0) + COALESCE((SELECT count(*) FROM "ClienteFidelizacion"),0);'
  $out = ($sql | docker exec -i $contenedor sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA 2>/dev/null')
  return ("" + $out).Trim()
}

$dump = Get-ChildItem -Path $Proyecto -Filter "*.dump" -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (-not $dump) { Info "No hay ningún .dump en la carpeta: la base queda como está (sin datos previos)." }
else {
  # Esperar a que el BACKEND esté sano: recién ahí existe el esquema (lo crea
  # 'prisma migrate deploy' al arrancar) y el conteo da un número confiable.
  for ($i = 0; $i -lt 36; $i++) {
    $be = Contenedor "backend"
    if ($be -and ((docker inspect -f "{{.State.Health.Status}}" $be 2>$null) -eq "healthy")) { break }
    Start-Sleep 5
  }
  $pg = Contenedor "postgres"
  if (-not $pg) {
    Aviso "No encontré el contenedor de Postgres; salteo el restore. Podés hacerlo a mano después."
  } else {
    # ¿la base YA tiene datos? (línea base, para no pisar sin aviso Y para verificar
    # después que el restore realmente cambió algo). FAIL-CLOSED: solo se saltea la
    # confirmación si el conteo da EXACTAMENTE "0".
    $conteoBase = Contar-Datos $pg
    $hacer = $true
    if ($conteoBase -ne "0") {
      $detalle = if ($conteoBase -match '^\d+$') { "La base YA tiene datos ($conteoBase registros)." }
                 else { "No pude verificar si la base tiene datos (por las dudas, confirmá)." }
      Aviso $detalle
      $resp = Read-Host "  ¿Restaurar '$($dump.Name)' y PISAR lo que haya en la base? Escribí SI (en MAYÚSCULAS) para confirmar"
      if ($resp -cne "SI") { $hacer = $false; Info "Restauración CANCELADA: se dejan los datos actuales." }
    }
    if ($hacer) {
      Info "Restaurando desde: $($dump.Name) ..."
      docker cp $dump.FullName "${pg}:/tmp/mig.dump"
      if ($LASTEXITCODE -ne 0) { Fatal "No se pudo copiar el dump al contenedor (docker cp falló)." }
      docker exec $pg sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists /tmp/mig.dump' 2>&1 | Out-Null
      docker exec $pg rm -f /tmp/mig.dump 2>&1 | Out-Null

      # Verificación POSITIVA con LÍNEA BASE: éxito = hay datos Y cambió respecto de
      # antes (en base fresca, base=0 y basta con que ahora haya datos). Si un
      # pg_restore falla sobre una base ya poblada, el conteo NO cambia -> no se
      # declara éxito ni se archiva el dump.
      $post = Contar-Datos $pg
      $exito = ($post -match '^\d+$') -and ([int]$post -gt 0) -and (($conteoBase -eq "0") -or ($post -ne $conteoBase))
      if ($exito) {
        Ok "Datos restaurados: $post registros (los warnings 'already exists' son normales)."
        try { Rename-Item $dump.FullName ($dump.Name + ".restaurado") -Force -ErrorAction SilentlyContinue } catch {}
        $beR = Contenedor "backend"
        if ($beR) { docker restart $beR | Out-Null; Info "Backend reiniciado (deja el esquema al día)." }
      } else {
        Aviso "No pude confirmar que el restore entró (antes: '$conteoBase', ahora: '$post'). Revisá el sistema o restaurá a mano; NO se archivó el dump."
      }
    }
  }
}

# ---- Fase admin: se auto-eleva (pide permisos UNA vez) ----
Titulo "Último paso: arranque automático (va a pedir permisos de administrador)"
$adminOk = $false
try {
  $proc = Start-Process powershell -Verb RunAs -PassThru -Wait -ErrorAction Stop -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"",
    "-FaseAdmin", "-Proyecto", "`"$Proyecto`"", "-Usuario", "`"$env:USERDOMAIN\$env:USERNAME`"",
    "-NgrokExe", "`"$ngrok`""
  )
  $adminOk = ($proc -and $proc.ExitCode -eq 0)
} catch {
  $adminOk = $false   # UAC cancelado (1223) u otro error de elevación
}

if ($adminOk) {
  Ok "Arranque automático configurado (energía + vigilante en modo normal)."
} else {
  Aviso "NO quedó configurado el arranque automático (¿cancelaste el pedido de permisos de administrador?)."
  Info  "El sistema YA está andando, pero para que arranque SOLO tras un reinicio, volvé a correr el"
  Info  "instalador y aceptá el permiso, o corré esto en una PowerShell COMO ADMINISTRADOR:"
  Info  "   powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`" -FaseAdmin -Proyecto `"$Proyecto`""
}

Write-Host "`n=========================================================" -ForegroundColor Cyan
Write-Host "  Pasos manuales que quedan:" -ForegroundColor White
Write-Host ""
$marcaPC   = Leer-EnvProd "MARCA" "FORD"
$dominioPC = Leer-EnvProd "NGROK_DOMAIN" "dealer-occupant-brigade.ngrok-free.dev"
$tokenPC   = Leer-EnvProd "META_WEBHOOK_VERIFY_TOKEN" "(el META_WEBHOOK_VERIFY_TOKEN de esta PC)"
$puertoPC  = Leer-EnvProd "HTTP_PORT" "80"
$urlLocal  = if ($puertoPC -eq "80") { "http://localhost" } else { "http://localhost:$puertoPC" }
Write-Host "  Esta PC quedó instalada como: $marcaPC" -ForegroundColor White
Write-Host ""
Write-Host "  1) Abrí $urlLocal  ->  login + tienen que estar los datos." -ForegroundColor White
Write-Host "  2) Webhook en Meta (los datos de ESTA PC):" -ForegroundColor White
Write-Host "       URL:          https://$dominioPC/api/webhooks/whatsapp" -ForegroundColor Gray
Write-Host "       Verify token: $tokenPC" -ForegroundColor Gray
Write-Host ""
Write-Host "  Para probar que anda solo: reiniciá, iniciá sesión y esperá 2-3 min." -ForegroundColor White
Write-Host "=========================================================" -ForegroundColor Cyan
Read-Host "`nEnter para cerrar"
