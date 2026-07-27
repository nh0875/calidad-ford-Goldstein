# ==============================================================================
#  RESETEO ENTRE MENSAJES DE LA DEMO
#
#  Deja el caso listo para recibir un SEGUNDO mensaje y que el sistema le vuelva
#  a responder:
#    - agradecimientoEnviadoEn = NULL  (si no, el sistema no responde de nuevo:
#      el agradecimiento es una-sola-vez por caso)
#    - estadoContacto = ENVIADO        (garantiza el match del webhook por la
#      via principal, que busca primero un caso en ENVIADO con ese telefono)
#
#  USO (desde la carpeta del proyecto):
#      .\scripts\windows\demo-reset.ps1 2617624989
#      .\scripts\windows\demo-reset.ps1 "+54 9 261 762-4989"
#
#  Acepta el numero en cualquier formato: lo normaliza igual que el backend.
# ==============================================================================

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Telefono
)

$ErrorActionPreference = "Stop"

# --- Normalizacion a E.164 argentino (+549XXXXXXXXXX), igual que el backend ---
function Normalizar-TelefonoAR {
    param([string]$valor)
    $d = ($valor -replace '\D', '')
    if (-not $d) { return $null }
    $d = $d -replace '^00', ''
    if ($d.StartsWith('54')) { $d = $d.Substring(2) }
    if ($d.StartsWith('9') -and $d.Length -gt 10) { $d = $d.Substring(1) }
    $d = $d -replace '^0+', ''
    # El "15" local despues del codigo de area (area de 2 a 4 digitos)
    if ($d.Length -ge 11 -and $d.Length -le 13) {
        foreach ($area in 2, 3, 4) {
            $resto = $d.Substring($area)
            if ($resto.StartsWith('15') -and ($area + ($resto.Length - 2)) -eq 10) {
                $d = $d.Substring(0, $area) + $resto.Substring(2)
                break
            }
        }
    }
    if ($d.Length -lt 8 -or $d.Length -gt 11) { return $null }
    return "+549$d"
}

$tel = Normalizar-TelefonoAR $Telefono
if (-not $tel) {
    Write-Host "No pude interpretar el numero '$Telefono'. Revisalo." -ForegroundColor Red
    exit 1
}

Write-Host "Reseteando el caso del telefono $tel ..." -ForegroundColor Cyan

# El SQL va por STDIN (no como argumento): asi PowerShell no se come las
# comillas dobles que Postgres necesita para los nombres de tabla/columna.
$sql = "UPDATE `"Caso`" SET `"agradecimientoEnviadoEn`"=NULL, `"estadoContacto`"='ENVIADO' WHERE whatsapp='$tel' OR celular='$tel';"
$res = $sql | docker exec -i vanina-postgres-1 psql -U calidad -d calidad_ford

if ("$res" -match 'UPDATE\s+(\d+)') {
    $n = [int]$Matches[1]
    if ($n -gt 0) {
        Write-Host "LISTO: $n caso(s) reseteado(s). Ya puede recibir el segundo mensaje." -ForegroundColor Green
    } else {
        Write-Host "OJO: no se encontro ningun caso con ese telefono. Revisa el numero." -ForegroundColor Yellow
    }
} else {
    Write-Host "Respuesta inesperada de la base:" -ForegroundColor Red
    Write-Host $res
    exit 1
}

# Estado del caso despues del reseteo, para confirmar de un vistazo
$ver = "SELECT `"numeroOrden`" || ' | estado=' || `"estadoContacto`" || ' | agradecimiento=' || COALESCE(`"agradecimientoEnviadoEn`"::text,'NULL') FROM `"Caso`" WHERE whatsapp='$tel' OR celular='$tel';"
$ver | docker exec -i vanina-postgres-1 psql -U calidad -d calidad_ford -tA
