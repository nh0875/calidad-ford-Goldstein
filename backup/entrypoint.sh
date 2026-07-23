#!/bin/bash
# Planificador simple (sin cron): un loop que despierta cada minuto y dispara el
# backup diario y la verificación semanal a la hora configurada. Se eligió un
# loop en vez de crond para que las variables de entorno del contenedor (credenciales
# de la base y de S3) estén siempre disponibles en los scripts, sin trucos de cron.
set -uo pipefail

export TZ="${TZ:-America/Argentina/Buenos_Aires}"
BACKUP_HOUR="${BACKUP_HOUR:-03}"     # HH (24h) del backup diario
VERIFY_DOW="${VERIFY_DOW:-7}"        # día de la verificación (1=lunes ... 7=domingo)
VERIFY_HOUR="${VERIFY_HOUR:-04}"     # HH (24h) de la verificación semanal

echo "[backup] contenedor iniciado. Backup diario ${BACKUP_HOUR}:00, verificación DOW=${VERIFY_DOW} ${VERIFY_HOUR}:00 (TZ=$TZ)"

# Corrida inmediata opcional al arrancar (útil para validar la configuración)
if [ "${BACKUP_ON_START:-false}" = "true" ]; then
  echo "[backup] BACKUP_ON_START=true → corriendo un backup inicial"
  /opt/backup/backup.sh || echo "[backup] el backup inicial falló (ver logs arriba)"
fi

last_backup_day=""
last_verify_day=""

while true; do
  hour="$(date +%H)"
  day="$(date +%Y-%m-%d)"
  dow="$(date +%u)"

  if [ "$hour" = "$BACKUP_HOUR" ] && [ "$day" != "$last_backup_day" ]; then
    last_backup_day="$day"
    /opt/backup/backup.sh || echo "[backup] el backup del $day falló"
  fi

  if [ "$dow" = "$VERIFY_DOW" ] && [ "$hour" = "$VERIFY_HOUR" ] && [ "$day" != "$last_verify_day" ]; then
    last_verify_day="$day"
    /opt/backup/verify-backup.sh || echo "[backup] la verificación del $day falló"
  fi

  sleep 60
done
