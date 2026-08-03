# Despliegue en el servidor de la empresa — Sistema de Calidad Ford

Guía para el equipo de **INDEN** para llevar el sistema desde la PC donde corre
hoy (Docker) al servidor de producción (Podman + Portainer + nginx).

Cualquier duda de la aplicación en sí: **Juan Ignacio Hilliard**.

---

## 1. Qué es y cómo está armado

App interna de Calidad de la concesionaria (seguimiento post-servicio por
WhatsApp + IA, RQR, fidelización). Es un stack de contenedores **estándar**, hoy
sobre Docker Compose; el mismo `docker-compose.prod.yml` del repo sirve para
Podman con cambios mínimos (ver §6).

Servicios del stack (`docker-compose.prod.yml`):

| Servicio   | Imagen / build            | Rol                                             | Puertos |
|------------|---------------------------|-------------------------------------------------|---------|
| `postgres` | postgres:16-alpine        | Base de datos                                   | interno |
| `redis`    | redis:7-alpine            | Colas de trabajo (BullMQ)                       | interno |
| `backend`  | build `./backend`         | API + workers (Node)                            | interno (3000) |
| `web`      | build `./frontend`        | nginx que sirve el frontend y proxya `/api`     | **127.0.0.1:8080** |
| `backup`   | build `./backup`          | pg_dump diario + (opcional) copia offsite S3    | ninguno |

Volúmenes con datos (persistentes): `pgdata_prod`, `redisdata_prod`, `backups`,
`backup_status`.

**Único punto de entrada:** el contenedor `web` publica en `127.0.0.1:8080`
(gracias a `HTTP_BIND=127.0.0.1`). Todo lo demás es red interna del stack. El
nginx del servidor es quien expone el sitio hacia afuera con TLS.

---

## 2. Modelo de acceso (definido con el cliente)

- **Público (internet):** SOLO la ruta del **webhook de Meta**
  `…/api/webhooks/whatsapp` (Meta necesita alcanzarla para entregar los mensajes).
- **Interno (red de la oficina):** TODO el resto (login, tableros, chat de
  Seguimiento, API). Los datos de clientes no se exponen a internet.

Esto se resuelve en nginx con el archivo **`nginx-calidad.conf`** de esta carpeta
(webhook abierto + resto restringido por IP de la oficina). Ajustar ahí las
subredes reales.

Dominio propuesto: **`calidad.apps.mariogoldsteinsa.com.ar`** (prod) y
**`calidad.dev.mariogoldsteinsa.com.ar`** (dev), bajo el comodín ya emitido.

---

## 3. Pasos de despliegue (producción)

> Requisitos previos que ya tienen: VM Ubuntu con Podman, Portainer, nginx con el
> certificado comodín, y una entrada DNS para `calidad.apps…` apuntando a la VM.

1. **Traer el código** a la VM de producción (git clone del repo, o el zip que
   les pasamos). Quedará, por ejemplo, en `/opt/calidad-ford`.

2. **Crear el `.env.prod`** a partir de `deploy/servidor/env.servidor.example`:
   ```bash
   cp deploy/servidor/env.servidor.example .env.prod
   # completar los secretos; ver §4 sobre los valores [COPIAR DE VANINA]
   ```

3. **Migrar los datos** desde la PC actual (§5). Hacerlo ANTES de exponer el
   sitio.

4. **Levantar el stack** (build + up). Con podman-compose:
   ```bash
   podman-compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
   ```
   > `--env-file .env.prod` es obligatorio: sin eso el backend aborta a propósito
   > (guarda anti-arranque con la config de desarrollo).
   >
   > Si prefieren **Portainer**: crear un **Stack** apuntando al repo /
   > `docker-compose.prod.yml`, cargar las variables del `.env.prod` en la sección
   > de environment del Stack, y desplegar. Portainer Business queda como panel
   > para ver logs, reiniciar y actualizar.

5. **nginx:** copiar `deploy/servidor/nginx-calidad.conf` a la config del nginx
   del server (ajustar subredes y, si hace falta, la ruta del certificado),
   `nginx -t` y recargar.

6. **Verificar** (desde la red de la oficina):
   - `https://calidad.apps.mariogoldsteinsa.com.ar/api/health` → `{"status":"ok"}`.
   - Entrar con un usuario y navegar.
   - Desde afuera de la oficina, esa misma URL debe dar **403** (y el webhook, 200).

7. **Apuntar el webhook en Meta** (§7).

---

## 4. Secretos que hay que copiar tal cual de la PC de Vanina

Están en el `.env.prod` actual de esa PC. **Críticos** para la migración:

- `CONFIG_ENCRYPTION_KEY` — **imprescindible igual**. Cifra el token de Meta que
  está guardado en la base; si cambia, la base migrada no lo puede leer y hay que
  recargar las credenciales de Meta a mano.
- `POSTGRES_PASSWORD` — la de la base que se va a restaurar.
- `GEMINI_API_KEY` (y `AI_PROVIDER=gemini`) — van por env, no están en la base.

`JWT_SECRET` puede ser nuevo (solo obliga a un re-login). Las credenciales de Meta
(`META_WHATSAPP_TOKEN`, etc.) pueden quedar vacías en el `.env` si se migra la base
con la misma `CONFIG_ENCRYPTION_KEY` (se leen cifradas de la base).

---

## 5. Runbook: migración de la base (PC de Vanina → servidor)

**En la PC de Vanina** (Docker), generar un dump comprimido:
```bash
docker exec vanina-postgres-1 pg_dump -U <POSTGRES_USER> -d calidad_ford -Fc -f /tmp/calidad.dump
docker cp vanina-postgres-1:/tmp/calidad.dump ./calidad.dump
```
Copiar `calidad.dump` al servidor (scp/rsync).

**En el servidor**, con el `.env.prod` ya armado:
```bash
# 1) Levantar SOLO la base y redis (todavía sin backend)
podman-compose -f docker-compose.prod.yml --env-file .env.prod up -d postgres redis

# 2) Restaurar el dump sobre la base recién creada
#    (el dump ya trae el esquema, los datos y el historial de migraciones)
podman exec -i <contenedor_postgres> \
  pg_restore -U <POSTGRES_USER> -d calidad_ford --clean --if-exists --no-owner < calidad.dump

# 3) Levantar el resto del stack (el backend corre las migraciones: no habrá
#    nada nuevo que aplicar, quedan iguales)
podman-compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```
> Alternativa: en la PC de Vanina el contenedor `backup` ya deja dumps en el
> volumen `backups`; se puede usar el último en vez de generar uno nuevo.

Verificar que estén los datos: entrar al sistema y ver que aparezcan los casos,
usuarios y la configuración de Meta.

---

## 6. Notas de Podman (diferencias con Docker)

El compose es estándar y no usa nada exótico. A tener en cuenta:

- **`depends_on: condition: service_healthy`**: lo soportan las versiones nuevas
  de `podman-compose` y el deploy de stacks de Portainer. Si su `podman-compose`
  es viejo y se queja, se pueden quitar las condiciones: el `backend` tiene
  `restart: unless-stopped`, así que reintenta hasta que la base esté lista.
- **Rootless**: el sitio se publica en `127.0.0.1:8080` (>1024, sin problema para
  rootless). La resolución por nombre entre contenedores (`postgres`, `redis`)
  funciona dentro de la red del compose.
- **`mem_limit`**: los topes del compose (backend 1024m, etc.) están dimensionados
  para una PC chica de 8 GB. En el servidor se pueden **subir o quitar** sin
  problema (son techos, no reservas). El backend es el que más conviene aflojar si
  hacen importaciones de Excel grandes.
- **Volúmenes**: nombrados, los maneja Podman igual. Ubuntu no fuerza SELinux, así
  que no hacen falta flags `:z`. El `backup_status` va montado `:ro` en el backend.
- **Zona horaria**: el backend usa `TZ=America/Argentina/Buenos_Aires` (importante
  para fechas/ventana de envío); ya viene en el `.env`.

---

## 7. Webhook de Meta (después de exponer el sitio)

En **developers.facebook.com → la app → WhatsApp → Configuración → Webhook**:

- **Callback URL:** `https://calidad.apps.mariogoldsteinsa.com.ar/api/webhooks/whatsapp`
- **Verify token:** el mismo que ya está configurado en el sistema (si se migró la
  base, se conserva; si no, se ve/edita en la pantalla de **Configuración** del
  sistema).
- Suscribir el campo **messages** (y `message_template_status_update`).

Meta hace un GET de verificación: si el token coincide, queda validado. A partir de
ahí, **el webhook es permanente** (no más ngrok).

---

## 8. Recomendación de seguridad (hardening)

Hoy el endpoint del webhook valida el *verify token* en el GET, pero el POST no
verifica la firma `X-Hub-Signature-256` de Meta. Con el webhook público, alguien
que adivine la URL podría, en teoría, inyectar "respuestas de cliente" falsas. Es
un riesgo acotado (no expone datos), pero **conviene cerrarlo**: podemos agregar la
validación de firma en la app (requiere el *App Secret* de Meta). Queda como mejora
recomendada; avisennos y lo sumamos.

---

## 9. Entorno de desarrollo (dev VM)

El mismo stack se puede levantar en la VM de dev con
`calidad.dev.mariogoldsteinsa.com.ar`, su propio `.env.prod` (base separada,
idealmente `MODO_DEMO=true` para no mandar WhatsApp reales) y el mismo esquema de
nginx. Sirve para probar cambios antes de pasarlos a producción.
