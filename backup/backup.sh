#!/bin/bash
# Backup diario de Postgres: pg_dump comprimido, rotación local de N días y
# copia a un bucket S3-compatible externo al VPS (AWS S3 / Backblaze B2 /
# DigitalOcean Spaces, según BACKUP_S3_ENDPOINT). El estado queda en status.json
# para que el backend lo muestre sin entrar por SSH.
#
# CRÍTICO: un backup que vive solo en el mismo servidor no sirve si el servidor
# se rompe o si borran el volumen. Por eso la copia offsite.
set -uo pipefail
source /opt/backup/status.sh

: "${POSTGRES_HOST:=postgres}"
: "${POSTGRES_PORT:=5432}"
: "${POSTGRES_USER:?POSTGRES_USER es obligatorio}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD es obligatorio}"
: "${POSTGRES_DB:=calidad_ford}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
export PGPASSWORD="$POSTGRES_PASSWORD"

mkdir -p "$BACKUP_DIR"
ts="$(date +%Y%m%d_%H%M%S)"
file="$BACKUP_DIR/calidad_${ts}.sql.gz"

echo "[backup] generando $file (db=$POSTGRES_DB host=$POSTGRES_HOST)"
if ! pg_dump -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$file"; then
  echo "[backup] ERROR: pg_dump falló" >&2
  rm -f "$file"
  update_status ultimoBackup "$(jq -n --arg m 'pg_dump falló' '{fecha: (now|todate), ok:false, archivo:null, tamanoBytes:0, subidoAOffsite:false, mensaje:$m}')"
  exit 1
fi

size="$(stat -c%s "$file" 2>/dev/null || echo 0)"
echo "[backup] dump OK ($size bytes)"

# Rotación local: borra dumps más viejos que RETENTION_DAYS días
find "$BACKUP_DIR" -name 'calidad_*.sql.gz' -type f -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true

# Copia offsite a S3-compatible (si está configurado)
offsite=false
msg="Backup local OK"
if [ -n "${BACKUP_S3_BUCKET:-}" ] && [ -n "${BACKUP_S3_ACCESS_KEY:-}" ]; then
  export AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY"
  export AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_KEY:-}"
  export AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-us-east-1}"
  # COMPATIBILIDAD con proveedores S3-compatible (Backblaze B2, DO Spaces...):
  # aws-cli v2.23+ manda checksums (x-amz-sdk-checksum-algorithm) por defecto y
  # varios proveedores los rechazan, haciendo fallar la subida. Con esto solo se
  # mandan cuando la operación realmente los exige. En AWS S3 no cambia nada.
  export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
  export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
  endpoint=()
  [ -n "${BACKUP_S3_ENDPOINT:-}" ] && endpoint=(--endpoint-url "$BACKUP_S3_ENDPOINT")
  if aws "${endpoint[@]}" s3 cp "$file" "s3://${BACKUP_S3_BUCKET}/$(basename "$file")"; then
    offsite=true
    msg="Backup local + offsite OK"
    echo "[backup] copia offsite OK → s3://${BACKUP_S3_BUCKET}/$(basename "$file")"
  else
    msg="Backup local OK, pero la copia offsite FALLÓ"
    echo "[backup] ERROR: no se pudo subir a S3" >&2
  fi
else
  msg="Backup local OK (almacenamiento offsite no configurado)"
  echo "[backup] AVISO: S3 no configurado, solo copia local" >&2
fi

update_status ultimoBackup "$(jq -n \
  --arg f "$(basename "$file")" \
  --arg m "$msg" \
  --argjson size "$size" \
  --argjson off "$offsite" \
  '{fecha: (now|todate), ok:true, archivo:$f, tamanoBytes:$size, subidoAOffsite:$off, mensaje:$m}')"

echo "[backup] listo"
