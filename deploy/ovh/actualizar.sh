#!/usr/bin/env bash
# ============================================================================
#  actualizar.sh — deja puesta la última versión de main, o vuelve atrás sola
# ============================================================================
#  Lo corre el timer calidad-actualizar todas las noches a la 01:30 (hora de
#  Argentina). También a mano:  ./deploy/ovh/calidad.sh actualizar
#
#  POR QUÉ DE NOCHE Y NO AL MEDIODÍA: en las PCs era a las 13:00 porque de noche
#  estaban apagadas. El servidor no se apaga, y compilar con gente trabajando le
#  saca CPU y memoria al sistema. A la 01:30 no hay nadie, la ventana de envío de
#  WhatsApp está cerrada, y queda tiempo para volver atrás antes del backup de
#  las 03:00 y de que abran las concesionarias.
#
#  Qué hace:
#    1. Si no hay nada nuevo y las dos marcas corren la versión de git, nada.
#    2. Si hay: construye. Si el build falla, deja todo como estaba.
#    3. Levanta y espera a que Ford Y Volkswagen reporten la versión nueva.
#    4. Si no responden en 10 minutos, vuelve SOLO a la anterior.
#
#  Lo que NO puede volver atrás: la base. Si la versión nueva alcanzó a aplicar
#  una migración, queda aplicada (lo mismo que en las PCs).
#
#  Avisa a un monitor externo (ACTUALIZACION_HEALTHCHECK_URL): ping si salió bien,
#  /fail si no. Y como hace ping TODAS las noches, si el timer deja de correr el
#  monitor también avisa.
# ============================================================================
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ"
ENV_FILE="$RAIZ/.env.prod"
RAMA="${RAMA:-main}"

# Una sola a la vez: una corrida manual justo cuando arranca el timer compilaría
# dos veces encima y cualquiera de las dos podría "volver atrás" la otra.
exec 9>/tmp/calidad-actualizar.lock
if ! flock -n 9; then echo "Ya hay otra actualización corriendo."; exit 0; fi

log() { echo "[$(date '+%F %T')] $*"; }

dc() {
  docker compose -p calidad \
    -f docker-compose.prod.yml -f deploy/ovh/docker-compose.ovh.yml \
    --env-file "$ENV_FILE" --profile vw "$@"
}

leer_env() {
  grep -E "^[[:space:]]*$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- |
    sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]\{1,\}#.*$//' -e 's/[[:space:]]*$//' || true
}

avisar_monitor() {
  local url; url="$(leer_env ACTUALIZACION_HEALTHCHECK_URL)"
  case "$url" in ""|\#*) return 0 ;; esac
  curl -fsS -m 10 --retry 3 -o /dev/null "$url$1" || log "AVISO: no se pudo avisar al monitor externo"
}

version() { # puerto -> versión que reporta, o vacío
  curl -fsS -m 5 "http://127.0.0.1:$1/api/health" 2>/dev/null | jq -r 'select(.status=="ok") | .version' 2>/dev/null || true
}

esperar() { # versión -> 0 si las dos marcas la reportan sanas antes de 10 minutos
  local limite=$((SECONDS + 600))
  while [ $SECONDS -lt $limite ]; do
    [ "$(version 8081)" = "$1" ] && [ "$(version 8082)" = "$1" ] && return 0
    sleep 10
  done
  log "Ford reporta '$(version 8081)', Volkswagen reporta '$(version 8082)'"
  return 1
}

[ -f "$ENV_FILE" ] || { log "No existe $ENV_FILE: no hay nada instalado para actualizar."; exit 1; }

if ! git fetch --quiet origin "$RAMA"; then
  log "No se pudo consultar GitHub. Queda todo como está."
  avisar_monitor "/fail"; exit 1
fi

actual="$(git rev-parse --short HEAD)"
nuevo="$(git rev-parse --short "origin/$RAMA")"

if [ "$actual" = "$nuevo" ] && [ "$(version 8081)" = "$actual" ] && [ "$(version 8082)" = "$actual" ]; then
  log "Sin novedades: las dos marcas corren $actual."
  avisar_monitor ""; exit 0
fi

libre_gb="$(df --output=avail -BG / | tail -1 | tr -dc '0-9')"
if [ "${libre_gb:-0}" -lt 5 ]; then
  log "Quedan ${libre_gb} GB libres: no alcanza para compilar sin riesgo. No se actualiza."
  avisar_monitor "/fail"; exit 1
fi

if ! git merge --ff-only --quiet "origin/$RAMA"; then
  log "No se pudo avanzar a $nuevo (¿hay archivos del sistema editados en el servidor? git status). No se actualiza."
  avisar_monitor "/fail"; exit 1
fi

log "Actualizando $actual -> $nuevo: $(git log -1 --pretty=%s)"

if ! GIT_COMMIT="$nuevo" dc build; then
  log "FALLÓ la construcción. Lo que está corriendo no se tocó; el código vuelve a $actual."
  git reset --hard --quiet "$actual"
  avisar_monitor "/fail"; exit 1
fi

GIT_COMMIT="$nuevo" dc up -d

if esperar "$nuevo"; then
  log "LISTO: las dos marcas corren $nuevo."
  # Cada compilación deja imágenes y caché viejas. Sin limpiar, en unos meses
  # llenan el disco y un día la actualización (o la base) se queda sin lugar.
  docker image prune -f --filter "until=168h" >/dev/null 2>&1 || true
  docker builder prune -f --filter "until=168h" >/dev/null 2>&1 || true
  avisar_monitor ""; exit 0
fi

log "La versión $nuevo NO respondió. Volviendo a $actual..."
git reset --hard --quiet "$actual"
GIT_COMMIT="$actual" dc up -d --build
if esperar "$actual"; then
  log "Vuelta atrás OK: corre $actual. OJO: si $nuevo alcanzó a aplicar una migración, quedó aplicada."
else
  log "LA VUELTA ATRÁS TAMBIÉN FALLÓ. El sistema puede estar caído: ./deploy/ovh/calidad.sh logs backend"
fi
avisar_monitor "/fail"
exit 1
