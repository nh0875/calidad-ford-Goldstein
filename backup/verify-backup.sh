#!/bin/bash
# Verificación semanal de integridad: toma el dump más reciente, lo restaura en
# una base temporal DESCARTABLE y comprueba que tenga datos (cuenta filas de
# Caso contra un mínimo esperado). Si algo falla, deja un log con nivel ERROR
# para que se note en una revisión (todavía no hay alertas por mail).
set -uo pipefail
source /opt/backup/status.sh

: "${POSTGRES_HOST:=postgres}"
: "${POSTGRES_PORT:=5432}"
: "${POSTGRES_USER:?POSTGRES_USER es obligatorio}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD es obligatorio}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
MIN_CASOS="${VERIFY_MIN_CASOS:-1}"
export PGPASSWORD="$POSTGRES_PASSWORD"

latest="$(ls -1t "$BACKUP_DIR"/calidad_*.sql.gz 2>/dev/null | head -1)"
if [ -z "$latest" ]; then
  echo "[verify] ERROR: no hay ningún backup para verificar en $BACKUP_DIR" >&2
  update_status ultimaVerificacion "$(jq -n --arg m 'No hay backups para verificar' '{fecha:(now|todate), ok:false, filasCaso:0, mensaje:$m}')"
  exit 1
fi

tmpdb="verify_restore_$(date +%s)"
echo "[verify] restaurando $latest en base temporal $tmpdb"

ok=false
filas=0
msg=""

if ! createdb -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" "$tmpdb"; then
  echo "[verify] ERROR: no se pudo crear la base temporal $tmpdb" >&2
  update_status ultimaVerificacion "$(jq -n --arg m 'No se pudo crear la base temporal' '{fecha:(now|todate), ok:false, filasCaso:0, mensaje:$m}')"
  exit 1
fi

if gunzip -c "$latest" | psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$tmpdb" -q >/dev/null 2>&1; then
  filas="$(psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$tmpdb" -tAc 'SELECT COUNT(*) FROM "Caso";' 2>/dev/null || echo 0)"
  filas="${filas:-0}"
  if [ "$filas" -ge "$MIN_CASOS" ]; then
    ok=true
    msg="Restauración OK: $filas filas en Caso"
    echo "[verify] OK: la restauración funciona ($filas casos)"
  else
    msg="Restauró, pero Caso tiene $filas filas (< $MIN_CASOS esperadas)"
    echo "[verify] ERROR: $msg" >&2
  fi
else
  msg="La restauración del dump más reciente FALLÓ"
  echo "[verify] ERROR: $msg (archivo: $latest)" >&2
fi

# La base temporal siempre se descarta
dropdb -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" "$tmpdb" 2>/dev/null || \
  echo "[verify] AVISO: no se pudo borrar la base temporal $tmpdb (borrala a mano)" >&2

update_status ultimaVerificacion "$(jq -n \
  --arg m "$msg" \
  --argjson ok "$ok" \
  --argjson filas "$filas" \
  '{fecha:(now|todate), ok:$ok, filasCaso:$filas, mensaje:$m}')"

[ "$ok" = "true" ] || exit 1
