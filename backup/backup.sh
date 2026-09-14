#!/bin/bash
# Backup diario de Postgres: pg_dump comprimido, rotación local de N días y
# copia a un bucket S3-compatible externo al VPS (AWS S3 / Backblaze B2 /
# DigitalOcean Spaces, según BACKUP_S3_ENDPOINT). El estado queda en status.json
# para que el backend lo muestre sin entrar por SSH.
#
# CRÍTICO: un backup que vive solo en el mismo servidor no sirve si el servidor
# se rompe o si borran el volumen. Por eso la copia offsite.
#
# UNA O VARIAS BASES:
#   - Sin POSTGRES_DBS (las PCs de hoy): respalda POSTGRES_DB, con los nombres de
#     archivo de siempre (calidad_<fecha>.sql.gz). No cambia nada.
#   - Con POSTGRES_DBS="calidad_ford calidad_vw" (el servidor, donde las dos
#     marcas comparten el mismo Postgres): respalda CADA base en su archivo
#     (<base>_<fecha>.sql.gz). Antes se respaldaba solo POSTGRES_DB, y con las dos
#     marcas juntas Volkswagen se habría quedado sin backup sin que nada lo dijera.
#   Si falla una base, las demás se respaldan igual.
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

lista="${POSTGRES_DBS:-}"
lista="${lista//,/ }"
if [ -n "${lista// /}" ]; then multi=true; else multi=false; lista="$POSTGRES_DB"; fi

# Aviso a un monitor EXTERNO (ej. healthchecks.io). Si el backup deja de correr
# del todo, el monitor no recibe el ping y avisa por mail: es lo único que detecta
# "no falla, directamente no corre", que es como estuvo 19 días muerto el
# respaldo de la PC de Ford sin que nadie se enterara. Vacío = no se avisa.
avisar_monitor() { # $1 = "" (éxito) o "/fail"
  [ -n "${BACKUP_HEALTHCHECK_URL:-}" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "${BACKUP_HEALTHCHECK_URL}$1" || \
    echo "[backup] AVISO: no se pudo avisar al monitor externo" >&2
}

s3_configurado=false
if [ -n "${BACKUP_S3_BUCKET:-}" ] && [ -n "${BACKUP_S3_ACCESS_KEY:-}" ]; then
  s3_configurado=true
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
fi

mkdir -p "$BACKUP_DIR"
ts="$(date +%Y%m%d_%H%M%S)"

todo_ok=true
todo_offsite=true
archivos=()
total_bytes=0
bases_json="[]"

for db in $lista; do
  if [ "$multi" = true ]; then nombre="${db}_${ts}.sql.gz"; patron="${db}_*.sql.gz"
  else nombre="calidad_${ts}.sql.gz"; patron="calidad_*.sql.gz"; fi
  file="$BACKUP_DIR/$nombre"

  echo "[backup] generando $file (db=$db host=$POSTGRES_HOST)"
  if ! pg_dump -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" "$db" | gzip > "$file"; then
    echo "[backup] ERROR: pg_dump de $db falló" >&2
    rm -f "$file"
    todo_ok=false
    todo_offsite=false
    bases_json="$(echo "$bases_json" | jq --arg b "$db" '. + [{base:$b, ok:false, archivo:null, tamanoBytes:0, subidoAOffsite:false}]')"
    continue
  fi

  size="$(stat -c%s "$file" 2>/dev/null || echo 0)"
  echo "[backup] dump de $db OK ($size bytes)"
  archivos+=("$nombre")
  total_bytes=$((total_bytes + size))

  # Rotación local: borra dumps de ESTA base más viejos que RETENTION_DAYS días
  find "$BACKUP_DIR" -name "$patron" -type f -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true

  subido=false
  if [ "$s3_configurado" = true ]; then
    if aws "${endpoint[@]}" s3 cp "$file" "s3://${BACKUP_S3_BUCKET}/$nombre"; then
      subido=true
      echo "[backup] copia offsite OK → s3://${BACKUP_S3_BUCKET}/$nombre"
    else
      echo "[backup] ERROR: no se pudo subir $nombre a S3" >&2
    fi
  fi
  [ "$subido" = true ] || todo_offsite=false

  bases_json="$(echo "$bases_json" | jq --arg b "$db" --arg f "$nombre" --argjson s "$size" --argjson o "$subido" \
    '. + [{base:$b, ok:true, archivo:$f, tamanoBytes:$s, subidoAOffsite:$o}]')"
done

if [ "$todo_ok" != true ]; then
  msg="FALLÓ el backup de al menos una base (ver detalle por base)"
elif [ "$s3_configurado" != true ]; then
  msg="Backup local OK (almacenamiento offsite no configurado)"
  echo "[backup] AVISO: S3 no configurado, solo copia local" >&2
elif [ "$todo_offsite" = true ]; then
  msg="Backup local + offsite OK"
else
  msg="Backup local OK, pero la copia offsite FALLÓ"
fi

# Misma forma de siempre (la tarjeta del tablero no cambia) + "bases" con el
# detalle de cada una. ok = TODAS las bases respaldadas.
update_status ultimoBackup "$(jq -n \
  --arg f "$(IFS=', '; echo "${archivos[*]:-}")" \
  --arg m "$msg" \
  --argjson size "$total_bytes" \
  --argjson ok "$todo_ok" \
  --argjson off "$( [ "$s3_configurado" = true ] && echo "$todo_offsite" || echo false )" \
  --argjson bases "$bases_json" \
  '{fecha: (now|todate), ok:$ok, archivo:(if $f == "" then null else $f end), tamanoBytes:$size, subidoAOffsite:$off, mensaje:$m, bases:$bases}')"

if [ "$todo_ok" = true ]; then
  avisar_monitor ""
  echo "[backup] listo"
else
  avisar_monitor "/fail"
  exit 1
fi
