# Contenedor de backups: corre un loop de cron con dos tareas:
#  - backup diario de Postgres (pg_dump comprimido + rotación 14 días + copia
#    a un bucket S3-compatible externo al VPS)
#  - verificación semanal de integridad (restaura el último dump en una base
#    temporal descartable y chequea que tenga datos)
#
# Incluye el cliente de Postgres 16 (para que pg_dump coincida con el server) y
# aws-cli (compatible con AWS S3, Backblaze B2 y DigitalOcean Spaces vía
# --endpoint-url).
FROM postgres:16-alpine

# aws-cli, jq, bash y coreutils (date/stat) para los scripts
RUN apk add --no-cache aws-cli jq bash coreutils tzdata

WORKDIR /opt/backup
COPY status.sh backup.sh verify-backup.sh entrypoint.sh ./
RUN chmod +x backup.sh verify-backup.sh entrypoint.sh

# Directorios de trabajo (se montan como volúmenes en docker-compose)
ENV BACKUP_DIR=/backups
ENV BACKUP_STATUS_DIR=/var/backup-status

ENTRYPOINT ["/opt/backup/entrypoint.sh"]
