# ============================================================================
#  Que Docker Desktop no abra su ventana al arrancar
# ============================================================================
#  El sistema necesita que Docker esté corriendo, pero NO que su panel se abra
#  cada vez que la persona inicia sesión. Para quien usa la PC todos los días eso
#  es una ventana más que aparece sola, que hay que cerrar, y que se puede cerrar
#  mal (cerrar el panel está bien, pero "Quit Docker Desktop" apaga el motor y se
#  cae el sistema entero).
#
#  Docker Desktop tiene una opción para esto. En su configuración se llama
#  "Open Docker Dashboard when Docker Desktop starts"; en el archivo de
#  configuración es OpenUIOnStartupDisabled.
#
#  Este script la deja puesta. El motor sigue arrancando igual: lo único que
#  cambia es que no se abre la ventana.
#
#  Uso:
#      powershell -ExecutionPolicy Bypass -File Docker-Sin-Ventana.ps1
#      powershell -ExecutionPolicy Bypass -File Docker-Sin-Ventana.ps1 -Usuario ldip
#      powershell -ExecutionPolicy Bypass -File Docker-Sin-Ventana.ps1 -Mostrar
# ============================================================================

param(
    # Cuenta a la que aplicarle el cambio. Vacío = la del que corre esto.
    [string]$Usuario = "",
    # Volver atrás: que el panel SÍ se abra al arrancar.
    [switch]$Mostrar
)

$ErrorActionPreference = "Continue"

function Bien($t) { Write-Host "  [OK]  $t" -ForegroundColor Green }
function Mal($t)  { Write-Host "  [!]   $t" -ForegroundColor Red }
function Info($t) { Write-Host "        $t" -ForegroundColor Gray }

if ($Usuario) {
    $cuenta = ($Usuario -split "\\")[-1]
    $config = "C:\Users\$cuenta\AppData\Roaming\Docker\settings-store.json"
} else {
    $cuenta = $env:USERNAME
    $config = "$env:APPDATA\Docker\settings-store.json"
}

Write-Host ""
Write-Host "  Docker Desktop, cuenta $cuenta" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $config)) {
    # Las versiones viejas usaban otro nombre de archivo.
    $viejo = Split-Path $config -Parent
    $alterno = Join-Path $viejo "settings.json"
    if (Test-Path $alterno) {
        $config = $alterno
    } else {
        Mal "No encuentro la configuracion de Docker Desktop de '$cuenta'."
        Info "Buscaba: $config"
        Info "Docker Desktop tiene que haberse abierto al menos una vez con esa cuenta."
        Read-Host "`nEnter para cerrar"; exit 1
    }
}

try {
    $datos = Get-Content $config -Raw | ConvertFrom-Json
} catch {
    Mal "La configuracion de Docker no se pudo leer: $($_.Exception.Message)"
    Read-Host "`nEnter para cerrar"; exit 1
}

$valor = -not $Mostrar   # -Mostrar => que SI se abra => Disabled = false

# ConvertFrom-Json devuelve un PSCustomObject: si la propiedad no existe hay que
# agregarla, no alcanza con asignarla.
if ($datos.PSObject.Properties.Name -contains "OpenUIOnStartupDisabled") {
    $datos.OpenUIOnStartupDisabled = $valor
} else {
    $datos | Add-Member -NotePropertyName "OpenUIOnStartupDisabled" -NotePropertyValue $valor
}

# Se guarda una copia antes de tocar nada: si algo sale mal, la configuracion de
# Docker de esa persona se puede volver a poner como estaba.
$copia = "$config.antes"
if (-not (Test-Path $copia)) { Copy-Item $config $copia -Force -ErrorAction SilentlyContinue }

try {
    $datos | ConvertTo-Json -Depth 20 | Set-Content $config -Encoding UTF8
    if ($Mostrar) { Bien "Listo: el panel de Docker VUELVE a abrirse al arrancar." }
    else          { Bien "Listo: Docker arranca sin abrir su ventana." }
} catch {
    Mal "No pude guardar la configuracion: $($_.Exception.Message)"
    Info "Si la cuenta es otra, corre esto como administrador."
    Read-Host "`nEnter para cerrar"; exit 1
}

Write-Host ""
Info "El cambio se aplica la proxima vez que Docker Desktop arranque."
Info "Para verlo ahora, cerra Docker Desktop desde el icono de la bandeja"
Info "(clic derecho -> Quit) y dejá que el vigilante lo vuelva a levantar."
Write-Host ""
Info "Para volver atras:  Docker-Sin-Ventana.ps1 -Mostrar"
Write-Host ""
Read-Host "Enter para cerrar"
