# Puesta en producción y migración a la máquina definitiva

Guía para dejar el sistema corriendo en la computadora Windows definitiva (con Docker Desktop) y el checklist final de puesta en marcha.

**Modelo de migración**: el **código** viaja por GitHub (repo privado), los **datos** por un backup de la base, y los **secretos** (`.env.prod`) se copian a mano. **Nunca** van a git: el `.env`/`.env.prod`, los Excel de clientes ni los backups (ya cubierto por `.gitignore`; las migraciones de Prisma **sí** se versionan).

---

## Estado actual (2026-07-22)

- **Modo**: **PRODUCCIÓN** — `docker-compose.prod.yml` + `.env.prod` (frontend compilado por nginx, sin dev server). Expuesto por ngrok estático `antitrust-trace-unloader.ngrok-free.dev` → puerto 80.
- **Base**: reseteada a **1 usuario ADMIN, 0 en todo lo demás**, en el volumen `vanina_pgdata_prod` (separado del de desarrollo `vanina_pgdata`, que quedó intacto como respaldo). Correlativo de RQR arranca en `RQR-2026-0001`.
- **Credenciales**: todas viven en **`.env.prod`** (Meta, Gemini, `JWT_SECRET`, `CONFIG_ENCRYPTION_KEY`, admin). La tabla `Configuracion` está vacía → el sistema usa el **fallback de `.env.prod`**. (Si se recargan por /configuracion, quedan cifradas en la base y tienen precedencia.)
- **Meta / WhatsApp**: "Probar conexión" **OK** contra el número de WhatsApp Business de la concesionaria. **Webhook configurado y verificado en el panel de Meta**: URL `https://antitrust-trace-unloader.ngrok-free.dev/api/webhooks/whatsapp`, verify token (el valor está en `.env.prod`, `META_WEBHOOK_VERIFY_TOKEN`), suscrito a `messages`, `message_template_status_update` y `phone_number_quality_update`. Verificado que el backend de prod responde el handshake por la URL pública.
- **Gemini (IA)**: **OK** — `gemini-2.5-flash`, tier pago.
- **Plantilla `contacto_posventa`**: ⏳ **EN REVISIÓN en Meta** → el primer envío de prueba queda pendiente hasta la aprobación.
- **Backups**: dump de seguridad pre-producción guardado **fuera del repo** en `C:\Users\hilli\Downloads\Goldstein\backups-calidad\`. El contenedor `backup` hace el dump diario automático.

---

## 0. Dos modos de ejecución (importante)

El proyecto tiene dos formas de levantarse:

| | Desarrollo (`docker-compose.yml`) | **Producción (`docker-compose.prod.yml`)** ← usar en la máquina definitiva |
|---|---|---|
| Frontend | Vite **dev server** (lento, más memoria; hay que listar los hosts en `VITE_ALLOWED_HOSTS` al exponer por ngrok) | **compilado, servido por nginx** (rápido; **sin** el problema de hosts) |
| Backend | `tsx watch` (dev) | JS compilado; **migraciones automáticas** al arrancar |
| Archivo de entorno | `.env` | `.env.prod` |
| Datos | volumen `pgdata` | volumen `pgdata_prod` |
| Backups automáticos | sí | sí |
| Comando | `docker compose up -d` | `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d` |

**Para la máquina definitiva usá el stack de producción.** No tiene el bloqueo de hosts de Vite (nginx sirve la SPA estática para cualquier Host), es más rápido y liviano, y aplica las migraciones solo.

---

## 1. Requisitos de la máquina nueva

- Windows con **Docker Desktop** (configurado para iniciar con Windows).
- **Git** (para clonar el repo) o el código copiado a mano.
- **ngrok** con un **dominio estático** (para el webhook de Meta por HTTPS).
- El archivo de **backup** de la base (`.sql.gz`) y el **`.env`** de producción, copiados a mano (pendrive / almacenamiento seguro, NO por git).

---

## 2. Instalación desde cero (comandos copiables)

Abrí una terminal (PowerShell o Git Bash) en la carpeta donde va a vivir el proyecto.

Todos los comandos usan el **stack de producción** (`-f docker-compose.prod.yml --env-file .env.prod`).

> **`--env-file .env.prod` NUNCA se omite.** Docker Compose interpola los `${...}` de `docker-compose.prod.yml` desde `.env` (el de **desarrollo**), no desde `.env.prod`. Sin ese flag, producción arranca con los valores de dev y no avisa. Pasó de verdad: el idioma de la plantilla volvió a `es_AR` y Meta rechazó todos los envíos con el error 132001, sin ningún indicio en los logs de arranque.
>
> Para que no pueda repetirse, `docker-compose.prod.yml` exige la variable `ENTORNO_PROD`, que existe **solo** en `.env.prod`. Si falta el flag, el comando corta de entrada con: `required variable ENTORNO_PROD is missing a value: falta --env-file .env.prod`. Si aparece ese error, el comando estaba mal escrito — agregar el flag, no borrar la guarda.

```bash
# 1. Traer el código
git clone <URL-del-repo-privado> Vanina
cd Vanina

# 2. Copiar el .env.prod a mano (NO está en git) a la raíz del proyecto.
#    Debe tener, completos: POSTGRES_PASSWORD, JWT_SECRET, CONFIG_ENCRYPTION_KEY,
#    GEMINI_API_KEY, ADMIN_EMAIL, ADMIN_PASSWORD_INICIAL, MODO_DEMO=false.
#    (Podés partir de .env.prod.example, que tiene la lista completa comentada.)
```

**Caso A — entrega en blanco (la usuaria carga todo desde cero):** no hay datos que restaurar.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
# El backend aplica las migraciones y crea el usuario ADMIN (de ADMIN_EMAIL /
# ADMIN_PASSWORD_INICIAL) solo. Listo: entrá a http://localhost e iniciá sesión.
```

**Caso B — migrar datos reales desde un backup:**

```bash
# B1. Levantar solo la base
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d postgres
#     esperar a que quede "healthy":
docker compose -f docker-compose.prod.yml --env-file .env.prod ps

# B2. Restaurar el backup en la base de PRODUCCION (pgdata_prod). Ajustá el nombre:
gunzip -c calidad_AAAAMMDD_HHMMSS.sql.gz | docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres psql -U calidad -d calidad_ford

# B3. Levantar el resto (el backend confirma migraciones; no-op si el backup ya las trae)
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

# B4. VERIFICAR el conteo de casos reales
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres psql -U calidad -d calidad_ford -tA -c "SELECT 'casos reales activos = ' || count(*) FROM \"Caso\" WHERE \"eliminadoEn\" IS NULL;"
```

En el caso B, el paso B4 debe imprimir el número de casos del backup. Verificación desde el navegador: entrá a `http://localhost`, iniciá sesión con el admin y mirá el Dashboard.

> **allowedHosts**: en el stack de producción el frontend lo sirve nginx estático, así que **no existe** el bloqueo de hosts de Vite al exponer por ngrok (nginx responde a cualquier Host). La variable `VITE_ALLOWED_HOSTS` es solo del stack de desarrollo.

---

## 3. Arranque automático y resiliencia (sistema desatendido)

El sistema corre sin supervisión técnica, así que hay **tres capas** para que se mantenga solo. Todo el detalle en **[scripts/windows/README.md](scripts/windows/README.md)**.

### 3.1 Límites de memoria (la causa de las caídas de Docker)

Docker corre dentro de **WSL2**, que por defecto toma **hasta el 50 % de la RAM y no la devuelve**. En una PC con poca memoria, Windows se queda sin aire y **Docker Desktop se cae** (fue lo que venía pasando).

- Archivo **`C:\Users\<usuaria>\.wslconfig`** con un tope explícito (`memory`, `processors`, `swap`, `autoMemoryReclaim=gradual`).
- En esta PC (5,8 GB de RAM) el tope quedó en **2 GB**: WSL bajó de 2909 MB → 1904 MB y Windows pasó de 0,6 GB → 1,0 GB libres.
- **Tabla de valores por RAM** en el README (regla: dejarle a Windows al menos 3 GB; subir el número por encima del 50 % no sirve, lo que resuelve es *bajarlo*).
- Además, cada contenedor tiene su `mem_limit` en `docker-compose.prod.yml` (448+128+640+128+160 = 1504m), para que un proceso desbocado no tumbe la VM entera.

> Los cambios de `.wslconfig` se aplican con `wsl --shutdown` o reiniciando la PC.

### 3.2 Arranque al prender la máquina

`scripts/windows/iniciar-sistema.bat` registrado en el Programador de tareas ("Al iniciar sesión", máximos privilegios): espera a Docker, levanta el stack de producción y lanza ngrok con el dominio estático.

### 3.3 Vigilante cada 5 minutos

`scripts/windows/vigilante.ps1` registrado como tarea que **se repite cada 5 minutos**, oculta y sin interacción. En cada corrida:

1. Docker Desktop caído → lo inicia (y si la app está abierta pero el engine colgado, la reinicia).
2. Contenedores caídos → levanta el stack de producción.
3. Llamada real a `/api/health`; si falla, **distingue la causa**: publicación de puerto rota → reinicia `web`; backend caído → reinicia `backend`; si persiste → reinicia el stack. Nunca reinicia un backend que todavía está arrancando.
4. ngrok caído o sin el túnel del dominio → lo relanza.
5. Registra cada acción en `scripts/windows/vigilante.log` (con rotación a los 2 MB).

Es **idempotente y silencioso**: si todo está bien no abre ventanas ni molesta, y escribe una sola línea `[OK]` por día.

> **Requisito**: la tarea corre como la usuaria y **necesita sesión iniciada** (Docker Desktop es una app de escritorio). Conviene activar el **inicio de sesión automático** de Windows para que tras un reinicio inesperado todo vuelva solo.

### 3.4 Qué mirar si algo anduvo mal

```powershell
Get-Content .\scripts\windows\vigilante.log -Tail 20
```
Si aparece repetido `[ERROR] ... Requiere revision manual`, hay un problema de fondo: revisar `docker compose -f docker-compose.prod.yml --env-file .env.prod logs`.

---

## 4. Checklist final de puesta en marcha con Meta (WhatsApp)

Todo el sistema funciona **sin** Meta (carga de Excel, análisis con Gemini, reportes, RQR, refuerzos, auditoría). Solo el **envío/recepción de WhatsApp** necesita las credenciales de Meta. Estado al 2026-07-22:

- [x] **(a) Credenciales cargadas** ✅ — están en `.env.prod` (token, phone number ID y verify token). "Probar conexión" da OK contra el número de la concesionaria. *Opcional: recargarlas por Configuración → WhatsApp para que queden cifradas en la base; si no, se usan las de `.env.prod`.*
- [x] **(b) Webhook configurado y verificado** ✅ — en el panel de Meta: URL `https://antitrust-trace-unloader.ngrok-free.dev/api/webhooks/whatsapp`, verify token (el valor está en `.env.prod`, `META_WEBHOOK_VERIFY_TOKEN`), suscrito a `messages`, `message_template_status_update` y `phone_number_quality_update`. *No hace falta re-verificar al cambiar de dev a prod: la URL y el verify token no cambian, y el backend de prod responde el handshake correctamente por esa misma URL.*
- [ ] **(c) Template `contacto_posventa`** ⏳ — **EN REVISIÓN en Meta**. Cuando lo aprueben, el nombre (`contacto_posventa`) y el idioma (`es_AR`) ya están en `.env.prod`. Variables del template: nombre, modelo, fecha de salida.
- [ ] **(d) Primer envío de prueba controlado** — **pendiente de la aprobación del template (c)**. Cuando esté aprobado: cargar 1 caso con **el número propio**, disparar la campaña filtrada a ese caso (el preview debe mostrar exactamente 1), confirmar recepción → respuesta → clasificación → agradecimiento. Recién después, envío a clientes reales.

Recordá: los envíos respetan la **ventana horaria** (09:00–19:00 AR) y el **tope diario** (200); fuera de eso, los mensajes esperan en cola y salen cuando abre la ventana.

---

## 5. Backups

- El contenedor **`backup`** hace un dump **diario** (03:00 AR por defecto), con **rotación de 14 días**, y una **verificación semanal** (restaura el último dump en una base descartable y controla que tenga datos). Si configurás las variables `BACKUP_S3_*`, además sube una **copia offsite** a un bucket S3-compatible (recomendado: un backup solo en la máquina no sirve si la máquina se rompe).
- **Estado sin entrar por consola**: en el **Dashboard** (como ADMIN) aparece la tarjeta "Estado de los backups" con la fecha del último y si la verificación pasó.
- **Backup manual** en cualquier momento:
  ```bash
  docker compose exec -T postgres pg_dump -U calidad calidad_ford | gzip > "C:\ruta\fuera\del\repo\calidad_manual.sql.gz"
  ```

---

## 6. Secretos y contraseñas

- Las contraseñas de **Postgres** y del **admin** se rotaron a valores fuertes al pasar a producción (están en el `.env` y en la base; guardalas en un gestor de contraseñas).
- **`CONFIG_ENCRYPTION_KEY`** cifra el token de Meta guardado en la base. **No la rotes** sin volver a cargar el token de Meta después (si la cambiás, el token guardado queda ilegible).
- El `.env` **no** viaja por git. Guardá una copia segura: sin él, el backup sirve pero hay que reconfigurar los secretos.

---

## 7. Actualizar el sistema (nueva versión)

```bash
cd Vanina
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
# El backend aplica las migraciones nuevas solo al arrancar.
```

Los datos (volumen `pgdata_prod`) y las credenciales de Meta (en la base) se conservan entre actualizaciones.
