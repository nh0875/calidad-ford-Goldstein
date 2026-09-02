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

function Anotar($texto) {
    $linea = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $texto
    try { Add-Content -Path $Registro -Value $linea -Encoding UTF8 } catch { }
}

# Que no queden dos bucles dando vueltas si alguien inicia sesión dos veces o
# ejecuta el acceso directo a mano. El vigilante tiene su propio candado, pero
# dos bucles igual harían el doble de trabajo al pedo.
$mutex = New-Object System.Threading.Mutex($false, "Global\CalidadVigilanteBucle")
if (-not $mutex.WaitOne(0)) {
    Anotar "Ya hay otro bucle corriendo: este se cierra."
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

# Al iniciar sesión, Windows todavía está levantando cosas y Docker Desktop tarda
# bastante en estar listo. Se espera un poco antes de la primera pasada para no
# gastarla en falso.
Start-Sleep -Seconds 45

while ($true) {
    try {
        & powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden `
            -ExecutionPolicy Bypass -File $Vigilante 2>&1 | Out-Null
    } catch {
        # Nunca cortar el bucle por un error de una pasada: la próxima puede
        # andar, y si el bucle muere el sistema se queda sin vigilante hasta que
        # alguien vuelva a iniciar sesión.
        Anotar "Error en una pasada: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds $CadaSegundos
}
