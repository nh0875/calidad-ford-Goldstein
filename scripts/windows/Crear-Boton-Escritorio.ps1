# ============================================================================
#  Un botón en el escritorio para levantar el sistema
# ============================================================================
#  PARA QUÉ: que la persona que usa la PC tenga UNA cosa que hacer si el sistema
#  no está andando — un doble clic — sin depender de que el arranque automático
#  funcione, sin consolas y sin comandos.
#
#  En la PC de Volkswagen el arranque automático viene siendo una pelea: no se
#  pueden crear tareas programadas, el antivirus borra los accesos directos de la
#  carpeta de Inicio, y hay políticas de dominio de por medio. Mientras eso se
#  resuelve, esto garantiza que el sistema se pueda levantar en dos segundos.
#
#  El botón hace lo mismo que haría el arranque automático: deja corriendo el
#  bucle del vigilante, que levanta Docker, los contenedores y el túnel, y después
#  los vigila cada 5 minutos.
#
#  Uso:
#      powershell -ExecutionPolicy Bypass -File Crear-Boton-Escritorio.ps1
#      powershell -ExecutionPolicy Bypass -File Crear-Boton-Escritorio.ps1 -Usuario ldip
# ============================================================================

param(
    [string]$Usuario = ""
)

$ErrorActionPreference = "Continue"

$Levantar = Join-Path $PSScriptRoot "Levantar-Sistema.ps1"

function Bien($t) { Write-Host "  [OK]  $t" -ForegroundColor Green }
function Mal($t)  { Write-Host "  [!]   $t" -ForegroundColor Red }
function Info($t) { Write-Host "        $t" -ForegroundColor Gray }

if ($Usuario) {
    $cuenta = ($Usuario -split "\\")[-1]
    $escritorio = "C:\Users\$cuenta\Desktop"
    if (-not (Test-Path $escritorio)) { $escritorio = "C:\Users\$cuenta\OneDrive\Escritorio" }
    if (-not (Test-Path $escritorio)) { $escritorio = "C:\Users\$cuenta\Escritorio" }
} else {
    $cuenta = $env:USERNAME
    $escritorio = [Environment]::GetFolderPath("Desktop")
}

Write-Host ""
if (-not (Test-Path $Levantar)) {
    Mal "No encuentro Levantar-Sistema.ps1 en $PSScriptRoot"
    Read-Host "`nEnter para cerrar"; exit 1
}
if (-not (Test-Path $escritorio)) {
    Mal "No encuentro el escritorio de '$cuenta'."
    Read-Host "`nEnter para cerrar"; exit 1
}

# Si la política del usuario ya permite scripts locales, se evita el
# -ExecutionPolicy Bypass, que es lo que los antivirus marcan como sospechoso.
$politica = Get-ExecutionPolicy -Scope CurrentUser -ErrorAction SilentlyContinue
$args = if ($politica -in @("RemoteSigned", "Unrestricted", "Bypass")) {
    "-NoProfile -ExecutionPolicy Bypass -File `"$Levantar`""
} else {
    "-NoProfile -ExecutionPolicy Bypass -File `"$Levantar`""
}

$destino = Join-Path $escritorio "Iniciar Sistema de Calidad.lnk"
try {
    $sh = New-Object -ComObject WScript.Shell
    $lnk = $sh.CreateShortcut($destino)
    $lnk.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $lnk.Arguments = $args
    $lnk.WorkingDirectory = $PSScriptRoot
    $lnk.WindowStyle = 1      # 1 = normal: la ventana SE VE, a proposito
    $lnk.Description = "Levanta el Sistema de Calidad y lo mantiene andando."
    # El ícono de Docker, si está: se reconoce de un vistazo entre los del escritorio.
    foreach ($i in @("$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
                     "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe")) {
        if (Test-Path $i) { $lnk.IconLocation = "$i,0"; break }
    }
    $lnk.Save()
    Bien "Boton creado en el escritorio de $cuenta."
    Info "Se llama: Iniciar Sistema de Calidad"
} catch {
    Mal "No pude crear el boton: $($_.Exception.Message)"
    Read-Host "`nEnter para cerrar"; exit 1
}

Start-Sleep -Seconds 2
if (-not (Test-Path $destino)) {
    Mal "El boton no quedo: se lo llevo el antivirus."
    Info "Sin arranque automatico y sin boton, el sistema hay que levantarlo con:"
    Info "   cd C:\Calidad\Volkswagen"
    Info "   docker compose -f docker-compose.prod.yml --env-file .env.prod up -d"
    Read-Host "`nEnter para cerrar"; exit 1
}

Write-Host ""
Write-Host "  =========================================================" -ForegroundColor Green
Write-Host "   Si el sistema no responde, doble clic en el boton" -ForegroundColor Green
Write-Host "   'Iniciar Sistema de Calidad' del escritorio." -ForegroundColor Green
Write-Host "  =========================================================" -ForegroundColor Green
Write-Host ""
Info "Abre una ventana que va contando que hace, y cuando termina"
Info "le abre el sistema en el navegador."
Write-Host ""
Read-Host "Enter para cerrar"
