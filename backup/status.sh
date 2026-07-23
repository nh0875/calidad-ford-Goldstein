#!/bin/bash
# Helper compartido: actualiza una clave de nivel superior del status.json que
# lee el backend en /api/sistema/estado-backup. backup.sh escribe "ultimoBackup"
# y verify-backup.sh escribe "ultimaVerificacion", sin pisarse entre sí.

STATUS_FILE="${BACKUP_STATUS_DIR:-/var/backup-status}/status.json"

update_status() {
  local key="$1" obj="$2"
  mkdir -p "$(dirname "$STATUS_FILE")"
  local base="{}"
  [ -f "$STATUS_FILE" ] && base="$(cat "$STATUS_FILE")"
  if echo "$base" | jq --argjson v "$obj" ". + {\"$key\": \$v}" > "$STATUS_FILE.tmp" 2>/dev/null; then
    mv "$STATUS_FILE.tmp" "$STATUS_FILE"
  else
    # Si el archivo previo estaba corrupto, se reescribe desde cero
    echo "{\"$key\": $obj}" > "$STATUS_FILE"
  fi
}
