# Recuperación ante desastres — restaurar el sistema desde cero

Este documento es el procedimiento **exacto y copiable** para volver a levantar el Sistema de Calidad en un servidor nuevo, restaurando el último backup desde el almacenamiento externo. Pensado para el peor caso: el servidor viejo ya no existe.

Tiempo estimado: 20–40 minutos (según la conexión y el tamaño del backup).

---

## Qué vas a necesitar

- Un VPS nuevo con **Linux + Docker + Docker Compose v2** (2 GB de RAM sobran).
- El código del proyecto (este repositorio).
- El archivo `.env.prod` con las credenciales **o**, como mínimo, saber la contraseña de Postgres, el `JWT_SECRET` y las credenciales del bucket S3 donde están los backups. Guardá una copia de `.env.prod` en un gestor de contraseñas: sin él, los backups siguen sirviendo pero tenés que reconfigurar todo.
- Las credenciales del bucket S3-compatible (`BACKUP_S3_*`) donde se guardaron las copias offsite.

---

## Paso 0 — Instalar Docker (si el VPS viene limpio)

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # cerrar sesión y volver a entrar tras esto
docker compose version            # verificar que Compose v2 está
```

## Paso 1 — Traer el código y las credenciales

```bash
# Clonar (o copiar) el repositorio
git clone <URL-DEL-REPO> calidad && cd calidad

# Restaurar el archivo de entorno de producción
cp .env.prod.example .env.prod
nano .env.prod   # completar: POSTGRES_PASSWORD, JWT_SECRET, ADMIN_EMAIL/PASSWORD,
                 # credenciales de Meta y de IA, y sobre todo los BACKUP_S3_*
```

> Importante: usá el **mismo `POSTGRES_USER`/`POSTGRES_DB`** que en el servidor original (por defecto `calidad` / `calidad_ford`). El `POSTGRES_PASSWORD` puede ser nuevo.

## Paso 2 — Levantar la infraestructura base (Postgres + Redis) primero

Levantamos solo la base y Redis para restaurar el dump **antes** de que arranque el backend (que aplicaría migraciones sobre una base vacía).

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d postgres redis
docker compose -f docker-compose.prod.yml --env-file .env.prod ps   # esperar a que postgres esté "healthy"
```

## Paso 3 — Bajar el último backup desde el almacenamiento externo

Usá las mismas credenciales `BACKUP_S3_*` del `.env.prod`. Ejemplo con la AWS CLI (funciona con Backblaze B2 y DO Spaces agregando `--endpoint-url`):

```bash
# Cargar las variables del entorno para tener las credenciales a mano
set -a; source .env.prod; set +a
export AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY"
export AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-us-east-1}"

# El flag de endpoint solo si NO es AWS S3 (Backblaze/DO Spaces sí lo necesitan)
ENDPOINT=""
[ -n "$BACKUP_S3_ENDPOINT" ] && ENDPOINT="--endpoint-url $BACKUP_S3_ENDPOINT"

# Listar los backups disponibles (el más reciente es el de nombre más alto)
aws $ENDPOINT s3 ls "s3://$BACKUP_S3_BUCKET/" | sort

# Descargar el más reciente (reemplazá el nombre por el que corresponda)
aws $ENDPOINT s3 cp "s3://$BACKUP_S3_BUCKET/calidad_AAAAMMDD_HHMMSS.sql.gz" ./ultimo_backup.sql.gz
```

## Paso 4 — Restaurar el dump en la base

```bash
# Restaurar dentro del contenedor de Postgres ya corriendo
gunzip -c ./ultimo_backup.sql.gz | \
  docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

Verificar que entraron datos:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c 'SELECT COUNT(*) AS casos FROM "Caso";'
```

## Paso 5 — Levantar el resto del sistema

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

El backend aplica las migraciones pendientes con `prisma migrate deploy` (es idempotente: no toca lo ya restaurado) y arranca la API + los workers + el cron. El contenedor `backup` retoma los backups diarios y la verificación semanal.

## Paso 6 — Verificar que quedó operativo

```bash
# Salud general (API + Postgres + Redis)
curl http://localhost/api/health

# La app responde
curl -I http://localhost/
```

Entrá al sistema con el usuario ADMIN, revisá el Dashboard (la tarjeta "Estado de los backups" debería empezar a poblarse tras la primera corrida) y confirmá que los casos y RQR históricos están.

---

## Paso 7 — Volver a exponer el webhook de Meta (si aplica)

Meta exige **HTTPS público** para entregar mensajes de WhatsApp. Volvé a poner delante del sistema un Cloudflare Tunnel o un certbot, y reconfigurá en Meta la URL del webhook:

```
https://<tu-dominio>/api/webhooks/whatsapp
```

con el mismo `META_WEBHOOK_VERIFY_TOKEN` del `.env.prod`.

---

## Alternativa: migrar datos entre dos servidores que SÍ conviven

Si el servidor viejo todavía funciona (mudanza planificada, no desastre):

```bash
# En el servidor viejo
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  pg_dump -U calidad calidad_ford | gzip > backup.sql.gz

# Copiar backup.sql.gz al servidor nuevo (scp/rsync) y en el nuevo:
gunzip -c backup.sql.gz | \
  docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  psql -U calidad calidad_ford
```

(O, si el volumen es chico, simplemente volver a subir los Excel por `/upload` e `/rqr`, que es idempotente.)

---

## Prueba de fuego (recomendado hacerla una vez al mes)

Un plan de recuperación que nunca se probó no es un plan. Cada tanto, en un VPS de prueba, seguí los pasos 1–6 con el último backup real y confirmá que el sistema levanta con los datos. La verificación semanal automática cubre la integridad del dump, pero probar el procedimiento completo a mano de vez en cuando asegura que **vos** podés ejecutarlo el día que haga falta.
