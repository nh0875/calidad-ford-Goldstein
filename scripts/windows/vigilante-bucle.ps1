# ============================================================================
#  Vigilante en bucle — para PCs donde no se pueden crear tareas programadas
# ============================================================================
#  QUE ES: corre vigilante.ps1 una vez cada 5 minutos, para siempre, en un solo
#  proceso que queda vivo. Es lo mismo que hacía la tarea programada, pero sin
#  tarea programada.
#
#  POR QUE EXISTE: en la PC de Volkswagen no se pueden registrar las tareas.
#  Se probó todo, variante por variante:
#    - los cmdlets de PowerShell fallan porque WMI está roto ("servidor CIM")
#    - schtasks /create /XML devuelve "Acceso denegado"
#    - schtasks con /SC ONLOGON devuelve "Acceso denegado"
#    - el usuario común no puede crear tareas ni para sí mismo
#    - el administrador tampoco puede crear una que ejecute PowerShell
#      a nombre de otro usuario
#  Son políticas del dominio y del antivirus corporativo, y no se pueden cambiar
#  desde la PC.
#
#  Este script se lanza desde la CARPETA DE INICIO de Windows, que es del propio
#  usuario y no necesita permisos de nadie. Arranca cuando la persona inicia
#  sesión, corre en SU sesión (que es la única que llega a Docker) y no hay nada
#  que registrar.
#
#  SI SE CIERRA: no vuelve solo hasta el próximo inicio de sesión. Es la única
#  desventaja frente a una tarea programada. Por eso el bucle está escrito para
#  no morirse nunca: cada pasada va adentro de un try/catch y cualquier error se
#  anota y se sigue.
# ============================================================================

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$Vigilante = Join-Path $PSScriptRoot "vigilante.ps1"
$Registro  = Join-Path $PSScriptRoot "vigilante-bucle.log"
$CadaSegundos = 300   # 5 minutos, igual que la tarea programada

# ---------------------------------------------------------------------------
#  Actualizacion diaria, enganchada aca
# ---------------------------------------------------------------------------
#  En las PCs donde no se pueden crear tareas programadas, la actualizacion
#  automatica tampoco se puede instalar como tarea. Pero este bucle YA corre en la
#  sesion de la persona, que es justo donde hace falta: el actualizador hace
#  "docker compose build" y Docker solo le responde a esa sesion.
#
#  Se aprovecha, entonces: una vez por dia, a la hora del almuerzo, el bucle corre
#  el actualizador en vez de la pasada normal del vigilante. Si no hay nada nuevo
#  en GitHub, el actualizador se da cuenta en dos segundos y no toca nada.
$Actualizador   = Join-Path $PSScriptRoot "Actualizacion-Automatica.ps1"
$HoraActualizar = 13     # 13:00, hora del almuerzo: la PC esta prendida y no hay nadie usando
$MargenHoras    = 3      # hasta las 16:00; mas tarde se deja para manana
$SelloUltima    = Join-Path $PSScriptRoot "ultima-actualizacion.txt"

# Respaldo diario, tambien enganchado aca y por el mismo motivo. Corre a las
# 12:00, UNA HORA ANTES que la actualizacion, a proposito: si una actualizacion
# sale mal, el respaldo de ese dia ya esta hecho y es anterior al problema.
# Solo corre si el respaldo esta configurado (Respaldo-Config.json, que lo deja
# Instalar-Respaldo-Diario.ps1 con la carpeta de OneDrive).
$Respaldo       = Join-Path $PSScriptRoot "Respaldo-Calidad.ps1"
$RespaldoConfig = Join-Path $PSScriptRoot "Respaldo-Config.json"
$HoraRespaldo   = 12
$SelloRespaldo  = Join-Path $PSScriptRoot "ultimo-respaldo.txt"

# El log va en la carpeta del script, pero si no se puede escribir ahi (pasa
# cuando la carpeta la creo OTRA cuenta, por ejemplo un administrador que hizo el
# git clone) se cae a la carpeta temporal del usuario.
#
# Antes esto tragaba el error en silencio, y el resultado era lo peor posible: el
# bucle moria sin dejar rastro y desde afuera parecia que nunca habia arrancado.
# Costo varias vueltas darse cuenta.
if (-not $Registro -or -not (Test-Path (Split-Path $Registro -Parent))) {
    $Registro = Join-Path $env:TEMP "vigilante-bucle.log"
}
try {
    Add-Content -Path $Registro -Value "" -Encoding UTF8 -ErrorAction Stop
} catch {
    $alternativo = Join-Path $env:TEMP "vigilante-bucle.log"
    Write-Host "  No puedo escribir el log en $Registro" -ForegroundColor Yellow
    Write-Host "  ($($_.Exception.Message))" -ForegroundColor Gray
    Write-Host "  Se usa en su lugar: $alternativo" -ForegroundColor Yellow
    $Registro = $alternativo
}

function Anotar($texto) {
    $linea = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $texto
    # Siempre a la consola tambien: si alguien corre esto a mano para ver que
    # pasa, tiene que VER algo. Corriendo oculto no molesta a nadie.
    Write-Host "  $linea"
    try { Add-Content -Path $Registro -Value $linea -Encoding UTF8 } catch { }
}

# Que no queden dos bucles dando vueltas si alguien inicia sesión dos veces o
# ejecuta el acceso directo a mano. El vigilante tiene su propio candado, pero
# dos bucles igual harían el doble de trabajo al pedo.
$mutex = New-Object System.Threading.Mutex($false, "Global\CalidadVigilanteBucle")
if (-not $mutex.WaitOne(0)) {
    Anotar "Ya hay otro bucle corriendo en esta sesion: este se cierra."
    Write-Host ""
    Write-Host "  Si querias arrancar uno nuevo, primero cerra el que ya esta corriendo." -ForegroundColor Yellow
    Write-Host "  El comando para hacerlo esta en el README de scripts/windows." -ForegroundColor Gray
    exit 0
}

if (-not (Test-Path $Vigilante)) {
    Anotar "No encuentro vigilante.ps1 en $PSScriptRoot. El bucle no arranca."
    exit 1
}

# El log se rota solo: son 288 pasadas por día y sin esto crecería para siempre.
if ((Test-Path $Registro) -and ((Get-Item $Registro).Length -gt 2MB)) {
    $viejo = "$Registro.1"
    if (Test-Path $viejo) { Remove-Item $viejo -Force -ErrorAction SilentlyContinue }
    Move-Item $Registro $viejo -Force -ErrorAction SilentlyContinue
}

Anotar "Bucle iniciado (cada $($CadaSegundos / 60) minutos). Usuario: $env:USERNAME"
Anotar "Registro en: $Registro"
Anotar "Primera pasada en 45 segundos (se le da tiempo a Docker)."

# Al iniciar sesión, Windows todavía está levantando cosas y Docker Desktop tarda
# bastante en estar listo. Se espera un poco antes de la primera pasada para no
# gastarla en falso.
Start-Sleep -Seconds 45

while ($true) {
    try {
        # Una vez al dia, en la ventana del mediodia, toca actualizar.
        $ahora = Get-Date
        $tocaActualizar = $false
        if ((Test-Path $Actualizador) -and
            ($ahora.Hour -ge $HoraActualizar) -and ($ahora.Hour -lt ($HoraActualizar + $MargenHoras))) {
            $ultima = ""
            if (Test-Path $SelloUltima) { $ultima = (Get-Content $SelloUltima -Raw -EA SilentlyContinue).Trim() }
            if ($ultima -ne $ahora.ToString("yyyy-MM-dd")) { $tocaActualizar = $true }
        }

        # Respaldo antes que actualizacion: si hoy toca respaldar, se hace primero.
        $tocaRespaldar = $false
        if ((Test-Path $Respaldo) -and (Test-Path $RespaldoConfig) -and
            ($ahora.Hour -ge $HoraRespaldo) -and ($ahora.Hour -lt ($HoraRespaldo + $MargenHoras))) {
            $ultimoR = ""
            if (Test-Path $SelloRespaldo) { $ultimoR = (Get-Content $SelloRespaldo -Raw -EA SilentlyContinue).Trim() }
            if ($ultimoR -ne $ahora.ToString("yyyy-MM-dd")) { $tocaRespaldar = $true }
        }

        if ($tocaRespaldar) {
            # El sello va ANTES, igual que con la actualizacion: si el respaldo
            # falla no queremos reintentarlo cada 5 minutos toda la tarde.
            Set-Content -Path $SelloRespaldo -Value $ahora.ToString("yyyy-MM-dd") -Encoding UTF8
            Anotar "Toca el respaldo diario."
            & powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden `
                -ExecutionPolicy Bypass -File $Respaldo 2>&1 | Out-Null
            Anotar "Respaldo diario terminado."
        } elseif ($tocaActualizar) {
            # El sello se escribe ANTES de correr, no despues: si la actualizacion
            # falla, no queremos que el bucle la reintente cada 5 minutos toda la
            # tarde. Se reintenta manana, y el problema queda en el log.
            Set-Content -Path $SelloUltima -Value $ahora.ToString("yyyy-MM-dd") -Encoding UTF8
            Anotar "Toca la revision diaria de actualizaciones."
            & powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden `
                -ExecutionPolicy Bypass -File $Actualizador -HoraPrevista "$($HoraActualizar):00" 2>&1 | Out-Null
            Anotar "Revision de actualizaciones terminada (ver actualizacion-automatica.log)."
        } else {
            & powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden `
                -ExecutionPolicy Bypass -File $Vigilante 2>&1 | Out-Null
        }
    } catch {
        # Nunca cortar el bucle por un error de una pasada: la próxima puede
        # andar, y si el bucle muere el sistema se queda sin vigilante hasta que
        # alguien vuelva a iniciar sesión.
        Anotar "Error en una pasada: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds $CadaSegundos
}
