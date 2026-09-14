#!/bin/bash
# Verificación semanal de integridad: toma el dump más reciente de CADA base, lo
# restaura en una base temporal DESCARTABLE y comprueba que tenga datos (cuenta
# filas de Caso contra un mínimo esperado).
#
# Las bases salen de POSTGRES_DBS igual que en backup.sh; sin esa variable se
# verifica el último calidad_*.sql.gz, como siempre. Si falla, además de dejarlo
# en el log se avisa al monitor externo (VERIFY_HEALTHCHECK_URL).
set -uo pipefail
source /opt/backup/status.sh

: "${POSTGRES_HOST:=postgres}"
: "${POSTGRES_PORT:=5432}"
: "${POSTGRES_USER:?POSTGRES_USER es obligatorio}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD es obligatorio}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
MIN_CASOS="${VERIFY_MIN_CASOS:-1}"
export PGPASSWORD="$POSTGRES_PASSWORD"

lista="${POSTGRES_DBS:-}"
lista="${lista//,/ }"
if [ -n "${lista// /}" ]; then multi=true; else multi=false; lista="${POSTGRES_DB:-calidad_ford}"; fi

avisar_monitor() { # $1 = "" (éxito) o "/fail"
  [ -n "${VERIFY_HEALTHCHECK_URL:-}" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "${VERIFY_HEALTHCHECK_URL}$1" || \
    echo "[verify] AVISO: no se pudo avisar al monitor externo" >&2
}

todo_ok=true
total_filas=0
mensajes=()
bases_json="[]"

for db in $lista; do
  if [ "$multi" = true ]; then patron="${db}_*.sql.gz"; else patron="calidad_*.sql.gz"; fi
  latest="$(ls -1t "$BACKUP_DIR"/$patron 2>/dev/null | head -1)"
  ok=false
  filas=0

  if [ -z "$latest" ]; then
    msg="$db: no hay ningún backup para verificar"
    echo "[verify] ERROR: $msg" >&2
  else
    tmpdb="verify_restore_$(date +%s)"
    echo "[verify] restaurando $latest en base temporal $tmpdb"
    if ! createdb -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" "$tmpdb"; then
      msg="$db: no se pudo crear la base temporal"
      echo "[verify] ERROR: $msg" >&2
    else
      if gunzip -c "$latest" | psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$tmpdb" -q >/dev/null 2>&1; then
        filas="$(psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$tmpdb" -tAc 'SELECT COUNT(*) FROM "Caso";' 2>/dev/null || echo 0)"
        filas="${filas:-0}"
        if [ "$filas" -ge "$MIN_CASOS" ]; then
          ok=true
          msg="$db: restauración OK ($filas casos)"
          echo "[verify] OK: $msg"
        else
          msg="$db: restauró, pero Caso tiene $filas filas (< $MIN_CASOS esperadas)"
          echo "[verify] ERROR: $msg" >&2
        fi
      else
        msg="$db: la restauración del dump más reciente FALLÓ"
        echo "[verify] ERROR: $msg (archivo: $latest)" >&2
      fi
      # La base temporal siempre se descarta
      dropdb -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" "$tmpdb" 2>/dev/null || \
        echo "[verify] AVISO: no se pudo borrar la base temporal $tmpdb (borrala a mano)" >&2
    fi
  fi

  [ "$ok" = true ] || todo_ok=false
  total_filas=$((total_filas + filas))
  mensajes+=("$msg")
  bases_json="$(echo "$bases_json" | jq --arg b "$db" --argjson ok "$ok" --argjson f "$filas" --arg m "$msg" \
    '. + [{base:$b, ok:$ok, filasCaso:$f, mensaje:$m}]')"
done

update_status ultimaVerificacion "$(jq -n \
  --arg m "$(IFS='; '; echo "${mensajes[*]}")" \
  --argjson ok "$todo_ok" \
  --argjson filas "$total_filas" \
  --argjson bases "$bases_json" \
  '{fecha:(now|todate), ok:$ok, filasCaso:$filas, mensaje:$m, bases:$bases}')"

if [ "$todo_ok" = true ]; then
  avisar_monitor ""
else
  avisar_monitor "/fail"
  exit 1
fi
