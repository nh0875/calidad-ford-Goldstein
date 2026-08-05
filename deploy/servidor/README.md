# Despliegue en el servidor (Podman + Portainer + Nginx Proxy Manager)

Guía para **INDEN** para desplegar el Sistema de Calidad respetando la topología
(VMs Ubuntu, **Podman rootless**, **Portainer**, **Nginx Proxy Manager**).
Dudas de la app: **Juan Ignacio Hilliard**.

## 0. Cómo está pensado (según sus reglas)

- **No se compila en el servidor.** Las imágenes las construye **GitHub Actions**
  (`.github/workflows/docker-build.yml`) y las publica en **GHCR**, etiquetadas por
  rama: `dev` (VM de desarrollo) y `main` (VM de producción).
- El stack del servidor es **`docker-compose.servidor.yml`**: usa `image:` de GHCR
  (sin `build:`), rutas en minúsculas, **solo volúmenes nombrados**, y **un puerto
  alto** (8080) para que **NPM** enrute. No se tocan 80/443 ni el firewall.
- Las credenciales se cargan como **variables en Portainer** (nunca en el repo).

Imágenes que publica el pipeline (minúsculas):
```
ghcr.io/nh0875/calidad-ford-goldstein-backend:<rama>
ghcr.io/nh0875/calidad-ford-goldstein-web:<rama>
ghcr.io/nh0875/calidad-ford-goldstein-backup:<rama>
```

## 1. Acceso a GHCR (una vez)

Las imágenes salen privadas. Dos opciones:
- **(A) Registry en Portainer** *(recomendado)*: Portainer → **Registries** → Add
  registry → **Custom**, URL `ghcr.io`, usuario = usuario de GitHub, password = un
  **PAT** con scope `read:packages`. Así Portainer puede bajarlas privadas.
- **(B) Hacerlas públicas**: en GitHub → el repo → **Packages** → cada paquete →
  *Package settings* → *Change visibility → Public*. (Las imágenes **no** contienen
  credenciales: los secretos entran por variables en runtime.)

## 2. Crear el stack en Portainer

Portainer → **Stacks → + Add stack**, nombre `calidad`.
- **Build method: Repository**
  - Repository URL: `https://github.com/nh0875/calidad-ford-Goldstein.git`
  - Reference: `refs/heads/main` (prod) — en la VM de dev: `refs/heads/dev`
  - **Compose path: `docker-compose.servidor.yml`**
  - Authentication: usuario de GitHub + PAT (repo privado)
  > (También sirve **Web editor** pegando el `docker-compose.servidor.yml`, porque
  > ya no compila nada: solo baja imágenes.)

## 3. Variables de entorno (en Portainer)

Cargar el `.env.prod` de la PC de Vanina (**Load variables from .env file**), y
**ajustar/asegurar** estas:

| Variable | Valor |
|---|---|
| `TAG` | `main` (prod) · `dev` (staging) |
| `HTTP_PORT` | `8080` (el que enruta NPM) |
| `FRONTEND_URL` | `https://calidad.apps.mariogoldsteinsa.com.ar` |
| `ENTORNO_PROD` | `1` |
| `CONFIG_ENCRYPTION_KEY` | **la misma de Vanina** (si no, no se lee el token de Meta migrado) |
| `POSTGRES_PASSWORD`, `JWT_SECRET`, `GEMINI_API_KEY` | los de Vanina |
| `MODO_DEMO` | `false` |

**Deploy.** Portainer baja las imágenes de GHCR y levanta el stack.

## 4. Migrar los datos (runbook)

El stack arranca con la base vacía. Restaurar el dump de la PC de Vanina:
```bash
# En la PC de Vanina (Docker): generar el dump
docker exec vanina-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > calidad.dump
# Copiarlo al servidor y restaurarlo en el contenedor postgres del stack:
podman exec -i <postgres_del_stack> \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < calidad.dump
```
⚠️ La `CONFIG_ENCRYPTION_KEY` del stack **debe** ser la misma que la de Vanina.

## 5. Nginx Proxy Manager (webhook público / resto interno)

En NPM, crear un **Proxy Host**:
- Domain: `calidad.apps.mariogoldsteinsa.com.ar`
- Forward Hostname/Port: la IP de la VM (o `127.0.0.1`) **puerto 8080**
- SSL: el certificado comodín `*.apps.mariogoldsteinsa.com.ar`, Force SSL.

**Regla de acceso** (definida con el cliente): **solo `/api/webhooks/` accesible
desde internet; el resto solo desde la red de la oficina.** En NPM se hace con una
**Access List** (allow subredes de la oficina, deny el resto) aplicada al host, y
dejando la ruta del webhook abierta. El bloque nginx de referencia está en
`deploy/servidor/nginx-calidad.conf` (se puede pegar en la pestaña **Advanced** del
Proxy Host). Ajustar las subredes de la oficina.

## 6. Webhook de Meta

En Meta → WhatsApp → Configuración → Webhook:
- Callback URL: `https://calidad.apps.mariogoldsteinsa.com.ar/api/webhooks/whatsapp`
- Verify token: el que ya usa el sistema (se conserva al migrar la base).
- Suscribir `messages` y `message_template_status_update`.

## 7. Actualizaciones futuras

`git push` a `dev` o `main` → GitHub Actions reconstruye la imagen de esa rama en
GHCR. En Portainer: **Stacks → calidad → Pull and redeploy** (baja la imagen nueva).
Nada de compilar en el servidor.

## Hardening pendiente

El POST del webhook no valida `X-Hub-Signature-256`. Al quedar público, conviene
sumar esa validación (requiere el App Secret de Meta). Avisar y se agrega.
