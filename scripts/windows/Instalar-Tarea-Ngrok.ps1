# ============================================================================
#  Darle a ngrok una tarea propia, para que no se muera con el vigilante
# ============================================================================
#  EL PROBLEMA QUE RESUELVE. Cuando el vigilante lanza ngrok con Start-Process,
#  ngrok queda como HIJO suyo. Y el vigilante, a su vez, es hijo de la tarea
#  programada. Windows agrupa todo ese árbol y, cuando la tarea termina o la
#  matan, se lleva puesto TODO — ngrok incluido.
#
#  En la PC de Volkswagen eso pasaba cada 5 minutos: la tarea reiniciaba el
#  bucle, ngrok moría con él, y el túnel quedaba muerto hasta la pasada
#  siguiente. Síntoma para quien abre el link: la página de ngrok con
#  ERR_NGROK_3200, "el endpoint está offline" — el dominio existe pero no hay
#  nadie del otro lado.
#
#  LA SOLUCIÓN. Que ngrok tenga su PROPIA tarea. Una tarea disparada con
#  "schtasks /run" la lanza el servicio de tareas de Windows, NO el proceso que
#  la pide: nace como proceso de primera clase y no muere con nadie. El vigilante
#  ya sabe usarla — si la encuentra, la prefiere; el problema era que nunca se
#  llegaba a crear.
#
#  POR QUÉ NO SE CREABA. El instalador la registra con /SC ONLOGON, y ESA es
#  justamente la única variante que la política de esta PC bloquea ("Acceso
#  denegado"). Se probaron todas las demás y se crean bien.
#
#  Por eso acá se intenta ONLOGON primero (es la mejor: arranca sola al iniciar
#  sesión) y, si la bloquean, se cae a /SC ONCE con fecha lejana: nunca se
#  dispara por su cuenta, pero queda registrada y el vigilante la puede correr
#  con "schtasks /run" cada vez que encuentre el túnel caído.
#
#  Uso (PowerShell COMO ADMINISTRADOR, porque la cuenta que usa la PC no puede
#  crear tareas):
#      powershell -ExecutionPolicy Bypass -File Instalar-Tarea-Ngrok.ps1 -Usuario ldip
# ============================================================================

param(
    # Cuenta en cuya sesión tiene que correr ngrok. Es importante: Docker y el
    # sistema viven en ESA sesión.
    [string]$Usuario = "",
    [switch]$Quitar
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$NombreTarea = "Sistema de Calidad - ngrok"
$ProjectDir = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$EnvFile = Join-Path $ProjectDir ".env.prod"

function Bien($t) { Write-Host "  [OK]  $t" -ForegroundColor Green }
function Mal($t)  { Write-Host "  [!]   $t" -ForegroundColor Red }
function Info($t) { Write-Host "        $t" -ForegroundColor Gray }

Write-Host ""
Write-Host "  Tarea propia para ngrok" -ForegroundColor Cyan
Write-Host ""

if ($Quitar) {
    $null = & schtasks /delete /TN $NombreTarea /F 2>&1
    if ($LASTEXITCODE -eq 0) { Bien "Tarea borrada." } else { Info "No estaba creada." }
    Write-Host ""
    Read-Host "Enter para cerrar"; exit 0
}

# ---------- Datos de ESTA PC ----------
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

# El dominio sale del .env.prod de ESTA máquina, nunca fijo en el script: cada
# marca tiene el suyo y usar el de la otra deja el túnel apuntando a ningún lado.
$dominio = Leer-EnvProd "NGROK_DOMAIN"
$puerto = Leer-EnvProd "HTTP_PORT"
if (-not $puerto) { $puerto = "80" }

if (-not $dominio) {
    Mal "No encuentro NGROK_DOMAIN en $EnvFile"
    Info "Sin el dominio no se puede armar el comando de ngrok."
    Write-Host ""
    Read-Host "Enter para cerrar"; exit 1
}

# ---------- Dónde está ngrok ----------
$rutas = @(
    "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe",
    "$env:ProgramFiles\ngrok\ngrok.exe",
    "$env:LOCALAPPDATA\ngrok\ngrok.exe"
)
$exe = $rutas | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $exe) {
    $cmd = Get-Command ngrok -ErrorAction SilentlyContinue
    if ($cmd) { $exe = $cmd.Source }
}
if (-not $exe) {
    Mal "No encuentro ngrok.exe."
    Info "Buscado en:"
    $rutas | ForEach-Object { Info "   $_" }
    Info "y en el PATH. Instalalo o pasame la ruta."
    Write-Host ""
    Read-Host "Enter para cerrar"; exit 1
}

Info "ngrok    : $exe"
Info "dominio  : $dominio"
Info "puerto   : $puerto"
Write-Host ""

$comando = "`"$exe`" http --domain=$dominio $puerto"

# ---------- Registrar ----------
# Se intenta ONLOGON primero: es la mejor, porque ngrok arranca solo al iniciar
# sesión y no depende de que el vigilante lo note. Si la política la bloquea
# (pasa en la PC de Volkswagen), se cae a ONCE con fecha lejana: no se dispara
# nunca sola, pero queda registrada y el vigilante la corre cuando hace falta.
    # ngrok corre como SYSTEM, no como la persona. Tres motivos, los tres
    # aprendidos a los golpes en la PC de Volkswagen:
    #
    #   1. En la sesion 0 NO PUEDE haber ventana. Corriendo como la persona,
    #      ngrok abria una consola que, si alguien la cerraba, mataba el tunel.
    #   2. No hace falta ningun lanzador oculto. El .vbs que usa Ford para
    #      esconder la ventana lo BLOQUEA el antivirus de esta PC
    #      ("800700E1: el archivo contiene un virus o software potencialmente no
    #      deseado"), aunque solo ejecute el .exe y no PowerShell.
    #   3. Arranca sin que nadie inicie sesion. ngrok solo necesita llegar a
    #      localhost:80; no toca Docker ni nada de la sesion del usuario.
    #
    # /SC MINUTE /MO 5 se REPARA SOLO: si ngrok se cae, a los 5 minutos vuelve, y
    # si esta vivo Windows ignora la instancia nueva (IgnoreNew es el valor por
    # defecto de las tareas creadas con schtasks). Es la misma idea que Ford.
function Intentar([string[]]$extra, [string]$comoSeLlama, [switch]$ComoUsuario) {
    $p = @("/create", "/TN", $NombreTarea, "/TR", $comando) + $extra
    if ($ComoUsuario -and $Usuario) { $p += @("/RU", $Usuario, "/IT") }
    else { $p += @("/RU", "SYSTEM") }
    $p += "/F"
    $salida = & schtasks @p 2>&1
    if ($LASTEXITCODE -eq 0) {
        Bien "Tarea creada ($comoSeLlama)."
        return $true
    }
    Info "No se pudo con $comoSeLlama : $($salida | Select-Object -First 1)"
    return $false
}

# Como SYSTEM y cada 5 minutos: sin ventana, sin depender de la sesion, y se
# repara solo. Es lo mejor de las dos formas que probamos.
$listo = Intentar @("/SC", "MINUTE", "/MO", "5") "cada 5 minutos, como SYSTEM"

if (-not $listo) {
    # 01/01/2099, con ceros y a mano. Probado: schtasks NO acepta el formato corto
    # de Windows (rechaza "1/1/2099" pidiendo "dd/mm/yyyy"), y el orden dia/mes
    # depende del idioma. El 1 de enero esquiva las dos cosas: "01/01" se escribe
    # igual en dd/mm que en mm/dd.
    $fechaLejana = "01/01/2099"
    $listo = Intentar @("/SC", "ONCE", "/SD", $fechaLejana, "/ST", "00:00") "a pedido, como SYSTEM"
    if (-not $listo) {
        # Ultimo recurso: como la persona. Vuelve la ventana, pero es preferible
        # un tunel con ventana a no tener tunel.
        $listo = Intentar @("/SC", "MINUTE", "/MO", "5") "cada 5 minutos, en la sesion" -ComoUsuario
    }
    if ($listo) {
        Info "Esta variante NO arranca sola: la dispara el vigilante cuando ve"
        Info "el tunel caido. Como el vigilante pasa cada 5 minutos, el tunel"
        Info "vuelve solo como mucho en ese rato."
    }
}

if (-not $listo) {
    Write-Host ""
    Mal "No se pudo crear la tarea de ninguna forma."
    Info "Sin ella ngrok queda como proceso hijo del vigilante y se muere con el."
    Info "Proba correr esto como ADMINISTRADOR."
    Write-Host ""
    Read-Host "Enter para cerrar"; exit 1
}

# ---------- Arrancarla ahora ----------
Write-Host ""
Info "Arrancando ngrok..."
$null = & schtasks /run /TN $NombreTarea 2>&1

$ok = $false
for ($i = 0; $i -lt 8 -and -not $ok; $i++) {
    Start-Sleep -Seconds 5
    try {
        # A localhost SIN proxy: en esta PC el proxy de la empresa se come hasta
        # las consultas locales y devuelve que no responde con todo andando.
        $req = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:4040/api/tunnels")
        $req.Timeout = 5000
        $req.Proxy = $null
        $resp = $req.GetResponse()
        $lector = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $texto = $lector.ReadToEnd(); $lector.Close(); $resp.Close()
        $ok = ($texto -match [regex]::Escape($dominio))
    } catch { }
}

Write-Host ""
if ($ok) {
    Write-Host "  =========================================================" -ForegroundColor Green
    Write-Host "   LISTO. El tunel esta activo en https://$dominio" -ForegroundColor Green
    Write-Host "  =========================================================" -ForegroundColor Green
    Info "Y ahora ngrok vive por su cuenta: ya no se muere cuando la tarea"
    Info "del vigilante se reinicia."
} else {
    Mal "La tarea quedo creada pero el tunel no responde despues de 40 segundos."
    Info "Revisá que el token de ngrok este cargado en esta PC:"
    Info "   ngrok config check"
    Info "Y que NO haya otra PC usando el mismo token con el mismo dominio."
}
Write-Host ""
Read-Host "Enter para cerrar"
