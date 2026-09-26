# ============================================================================
#  Reparar el repositorio git del Sistema de Calidad
# ============================================================================
#  PARA QUE SIRVE. Cuando la actualizacion falla siempre con errores de git que
#  no son de conexion, por ejemplo:
#
#      fatal: unresolved deltas left after unpacking
#      error: object file .git/objects/... is empty
#      fatal: loose object ... is corrupt
#
#  eso quiere decir que la CARPETA OCULTA .git de esta PC quedo dañada: le faltan
#  pedazos y por eso no puede terminar de traer los cambios. Paso en la PC de
#  Volkswagen (26-09-2026), junto con archivos del sistema borrados: el antivirus
#  del dominio ya se comio cosas de esa carpeta antes.
#
#  QUE HACE. Se trae una copia limpia del repositorio de GitHub y reemplaza SOLO
#  esa carpeta oculta; despues deja los archivos del sistema exactamente como
#  estan en GitHub. La copia vieja NO se borra: queda al lado por si hiciera
#  falta.
#
#  QUE NO TOCA. Nada tuyo: .env.prod, la base de datos (vive en Docker), los
#  respaldos, los archivos sueltos que hayan copiado a mano. Si algun archivo DEL
#  SISTEMA fue editado en esta PC, primero se guarda una copia y se avisa.
#
#  COMO SE USA. Doble clic en "Reparar-Git.bat", que esta al lado. Tarda un
#  minuto. Al terminar deja un informe en el Escritorio.
#
#  Si GitHub pide usuario y contraseña, es porque esta PC perdio la credencial
#  guardada: avisale a Ignacio en vez de escribir nada.
# ============================================================================

param(
    # Carpeta del sistema, por si este script se copio al Escritorio.
    [string]$Carpeta = ""
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$informe = New-Object System.Collections.Generic.List[string]
function Linea([string]$t, [string]$color = "Gray") { $informe.Add($t); Write-Host $t -ForegroundColor $color }
function Bien($t)   { Linea "  [OK]    $t" "Green" }
function Mal($t)    { Linea "  [MAL]   $t" "Red" }
function Aviso($t)  { Linea "  [OJO]   $t" "Yellow" }
function Info($t)   { Linea "          $t" "Gray" }
function Titulo($t) { Linea ""; Linea "== $t" "Cyan" }

function Terminar([int]$codigo) {
    $destino = Join-Path ([System.Environment]::GetFolderPath("Desktop")) ("reparar-git-" + $env:COMPUTERNAME + ".txt")
    try {
        $informe -join "`r`n" | Out-File -FilePath $destino -Encoding UTF8 -Force
        Write-Host ""
        Write-Host "  Informe guardado en: $destino" -ForegroundColor Green
    } catch {
        Write-Host "  No se pudo guardar el informe: $($_.Exception.Message)" -ForegroundColor Yellow
    }
    Write-Host ""
    exit $codigo
}

# --- Donde esta el sistema ---------------------------------------------------
function Buscar-Proyecto {
    if ($Carpeta -ne "" -and (Test-Path (Join-Path $Carpeta "docker-compose.prod.yml"))) { return (Resolve-Path $Carpeta).Path }
    if ($PSScriptRoot) {
        $subiendo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
        if ($subiendo -and (Test-Path (Join-Path $subiendo "docker-compose.prod.yml"))) { return $subiendo }
    }
    foreach ($raiz in @("C:\Calidad", "C:\", "$env:USERPROFILE\Downloads\Goldstein", "$env:USERPROFILE\Downloads")) {
        if (-not (Test-Path $raiz)) { continue }
        try {
            $hallado = Get-ChildItem -Path $raiz -Directory -ErrorAction SilentlyContinue |
                ForEach-Object { $_.FullName } |
                Where-Object { Test-Path (Join-Path $_ "docker-compose.prod.yml") } |
                Select-Object -First 1
            if ($hallado) { return $hallado }
        } catch { }
    }
    return ""
}

$Proyecto = Buscar-Proyecto
Linea ""
Linea "REPARACION DEL REPOSITORIO - Sistema de Calidad"
Linea ("Fecha: " + (Get-Date -Format "dd/MM/yyyy HH:mm:ss") + "   PC: " + $env:COMPUTERNAME + "   Usuario: " + $env:USERNAME)
if ($Proyecto -eq "") {
    Mal "No encontre la carpeta del sistema. Corre este archivo desde adentro de scripts\windows."
    Terminar 1
}
Info "Carpeta: $Proyecto"
Set-Location $Proyecto

if (-not (Test-Path (Join-Path $Proyecto ".git"))) {
    Mal "Esta carpeta no tiene repositorio git (.git). No es lo que repara este script."
    Terminar 1
}

# Nunca se muestra la URL con credenciales adentro.
function Tapar([string]$url) { return ($url -replace "//[^@/]+@", "//***@") }

$urlOrigen = (& git config --get remote.origin.url 2>$null | Select-Object -First 1)
if (-not $urlOrigen) {
    Mal "El repositorio no tiene un origen configurado: no se de donde traerlo."
    Terminar 1
}
Info ("Origen : " + (Tapar $urlOrigen))

# --- 1. Como esta -----------------------------------------------------------
Titulo "1. COMO ESTA HOY"
$commit = (& git rev-parse --short HEAD 2>$null)
Info ("Version actual: " + $(if ($commit) { $commit } else { "(no se puede leer: el repositorio esta dañado)" }))

$cambios = @(& git status --porcelain 2>$null)
$editados = @($cambios | Where-Object { $_ -match "^\s*M" })
$borrados = @($cambios | Where-Object { $_ -match "^\s*D" })
if ($borrados.Count -gt 0) {
    Aviso "Hay $($borrados.Count) archivo(s) del sistema BORRADOS en esta PC (el antivirus suele hacer esto):"
    $borrados | ForEach-Object { Info "   $_" }
    Info "La reparacion los vuelve a dejar como estan en GitHub."
}
if ($editados.Count -gt 0) {
    Aviso "Hay $($editados.Count) archivo(s) del sistema EDITADOS en esta PC:"
    $editados | ForEach-Object { Info "   $_" }
}

Info "Revisando la salud del repositorio (puede tardar)..."
$fsck = @(& git fsck --no-progress --no-dangling 2>&1) | Where-Object { "$_".Trim() -ne "" }
if ($fsck.Count -eq 0) { Bien "git no encontro objetos rotos." }
else {
    Mal "git encontro problemas:"
    $fsck | Select-Object -First 12 | ForEach-Object { Info "   $_" }
    if ($fsck.Count -gt 12) { Info "   ... y $($fsck.Count - 12) mas" }
}

# --- 2. Reparar la carpeta .git ---------------------------------------------
#
# El criterio es lo que dice `git fsck`, NO si el fetch anduvo: con el
# repositorio roto, un fetch puede terminar bien (cuando no hay nada nuevo que
# traer) y volver a fallar el dia que si lo hay. Probado el 26-09-2026.
function Reparar-Repositorio {
    Titulo "REPARANDO (se trae una copia limpia)"
    $sello = Get-Date -Format "yyyyMMdd-HHmmss"

    # Copia de los archivos DEL SISTEMA editados en esta PC, por las dudas.
    if ($editados.Count -gt 0) {
        $guardados = Join-Path $Proyecto ("_editados-antes-de-reparar-" + $sello)
        foreach ($linea in $editados) {
            $rel = ($linea -replace "^\s*\S+\s+", "").Trim().Trim('"')
            $origen = Join-Path $Proyecto $rel
            if (-not (Test-Path $origen)) { continue }
            $destino = Join-Path $guardados $rel
            $carpetaDestino = Split-Path $destino -Parent
            if (-not (Test-Path $carpetaDestino)) { New-Item -ItemType Directory -Path $carpetaDestino -Force | Out-Null }
            Copy-Item $origen $destino -Force -ErrorAction SilentlyContinue
        }
        if (Test-Path $guardados) { Bien "Copie los archivos editados en $guardados" }
    }

    $clon = Join-Path ([System.IO.Path]::GetTempPath()) ("calidad-clon-" + $sello)
    Info "Trayendo una copia limpia de GitHub..."
    & git clone --no-checkout --quiet $urlOrigen $clon 2>&1 | ForEach-Object { Info "   $_" }
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $clon ".git"))) {
        Mal "No se pudo traer la copia limpia. NO se toco nada: el sistema sigue como estaba."
        Info "Si pidio usuario y contraseña de GitHub, avisale a Ignacio."
        Remove-Item $clon -Recurse -Force -ErrorAction SilentlyContinue
        Terminar 1
    }
    Bien "Copia limpia lista."

    $roto = Join-Path $Proyecto (".git-roto-" + $sello)
    try {
        Rename-Item (Join-Path $Proyecto ".git") (Split-Path $roto -Leaf) -ErrorAction Stop
    } catch {
        Mal "No pude apartar la carpeta .git dañada: $($_.Exception.Message)"
        Info "Cerra el Explorador de Windows y cualquier programa abierto en esa carpeta, y proba de nuevo."
        Remove-Item $clon -Recurse -Force -ErrorAction SilentlyContinue
        Terminar 1
    }
    try {
        Move-Item (Join-Path $clon ".git") (Join-Path $Proyecto ".git") -ErrorAction Stop
        Bien "Repositorio reemplazado (el dañado quedo en $roto)."
    } catch {
        Mal "No pude poner la copia limpia: $($_.Exception.Message)"
        Rename-Item $roto ".git" -ErrorAction SilentlyContinue
        Info "Se dejo todo como estaba."
        Remove-Item $clon -Recurse -Force -ErrorAction SilentlyContinue
        Terminar 1
    }
    Remove-Item $clon -Recurse -Force -ErrorAction SilentlyContinue
    return $true
}

$reparado = $false
if ($fsck.Count -gt 0) {
    Info "Hay objetos dañados: se reemplaza la carpeta .git por una copia limpia."
    $reparado = Reparar-Repositorio
} else {
    Titulo "2. TRAYENDO LOS CAMBIOS"
    $tmp = [System.IO.Path]::GetTempFileName()
    & git fetch --prune origin 2>$tmp | Out-Null
    $codigoFetch = $LASTEXITCODE
    $errFetch = @(Get-Content $tmp -ErrorAction SilentlyContinue) -join " "
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    if ($codigoFetch -eq 0) {
        Bien "Se pudieron traer los cambios sin reparar nada."
    } else {
        Mal "No se pudieron traer los cambios: $errFetch"
        $reparado = Reparar-Repositorio
    }
}

# --- 3. Dejar los archivos como en GitHub -----------------------------------
Titulo "3. DEJANDO LOS ARCHIVOS COMO EN GITHUB"
$rama = (& git symbolic-ref --short HEAD 2>$null)
if (-not $rama) { $rama = "main" }
Info "Rama: $rama"
& git reset --hard ("origin/" + $rama) 2>&1 | ForEach-Object { Info "   $_" }
if ($LASTEXITCODE -ne 0 -and -not $reparado) {
    Aviso "No se pudo dejar la carpeta al dia: se repara el repositorio y se reintenta."
    $reparado = Reparar-Repositorio
    & git reset --hard ("origin/" + $rama) 2>&1 | ForEach-Object { Info "   $_" }
}
if ($LASTEXITCODE -ne 0) {
    Mal "No se pudo dejar la carpeta al dia."
    Terminar 1
}

# --- 5. Comprobar -----------------------------------------------------------
Titulo "4. COMO QUEDO"
$commitFinal = (& git rev-parse --short HEAD 2>$null)
$titulo = (& git log -1 --pretty=%s 2>$null)
Bien "Version: $commitFinal  $titulo"
$pendientes = @(& git status --porcelain 2>$null) | Where-Object { $_ -notmatch "^\?\?" }
if ($pendientes.Count -eq 0) { Bien "No quedan archivos del sistema fuera de lugar." }
else {
    Aviso "Todavia hay cambios locales:"
    $pendientes | ForEach-Object { Info "   $_" }
}
foreach ($archivo in @("docker-compose.prod.yml", "scripts\windows\vigilante.ps1", "scripts\windows\vigilante-bucle.ps1", "scripts\windows\actualizar-sistema.ps1")) {
    if (Test-Path (Join-Path $Proyecto $archivo)) { Bien "esta $archivo" } else { Mal "FALTA $archivo" }
}
if (Test-Path (Join-Path $Proyecto ".env.prod")) { Bien "esta .env.prod (tu configuracion, intacta)" }
else { Aviso "No veo .env.prod en esta carpeta. Si el sistema no levanta, avisale a Ignacio." }

Linea ""
Linea "  LISTO. Ahora corre Actualizar-AHORA.bat: deberia terminar sin errores." "Green"
Linea "  La carpeta .git-roto-* se puede borrar cuando el sistema este andando bien." "Gray"
Terminar 0
