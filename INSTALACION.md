# Instalación en la PC definitiva — paso a paso

Guía para dejar el **Sistema de Calidad** funcionando solo en la computadora donde va a quedar.

**Equipo destino**: Windows · 8 GB de RAM · Intel i7-1255U · 500 GB de disco.

**Lo que hay que tener a mano antes de empezar:**

| Qué | Dónde conseguirlo |
|---|---|
| Pendrive con el archivo **`.env.prod`** | Lo llevás vos (NO está en GitHub) |
| Usuario y contraseña de **GitHub** | Para clonar el repositorio privado |
| **Authtoken de ngrok** + dominio fijo reservado | Panel de ngrok |
| Credenciales de **Meta** (WhatsApp) | Ya están dentro del `.env.prod` |
| Contraseña de Windows de esa PC | Para el auto-login y las tareas programadas |

> ⏱️ Tiempo estimado: 45–60 minutos (la mayor parte es descarga e instalación).

---

## Paso 1 — Instalar Docker Desktop y Git

1. **Docker Desktop**: descargar de <https://www.docker.com/products/docker-desktop/> e instalar.
   - Durante la instalación, dejar tildado **"Use WSL 2 instead of Hyper-V"**.
   - Al terminar, abrir Docker Desktop → ⚙️ **Settings → General** → tildar **"Start Docker Desktop when you sign in"**. Aplicar y reiniciar Docker.
2. **Git**: descargar de <https://git-scm.com/download/win> e instalar (todo "Siguiente", los valores por defecto están bien).

**Cómo verificar que salió bien** — abrir PowerShell y correr:
```powershell
docker --version
git --version
docker run --rm hello-world
```
Las tres tienen que responder sin error (la última imprime "Hello from Docker!").

**Si falla:**
- `docker: command not found` → cerrar y volver a abrir PowerShell (el PATH se actualiza al reabrir).
- Docker no arranca o pide habilitar WSL → abrir PowerShell **como administrador** y correr `wsl --install`, después reiniciar la PC.

---

## Paso 2 — Configurar el límite de memoria de WSL (importante)

Sin esto, Docker se cae solo cada tanto: WSL2 toma la mitad de la RAM y no la devuelve.

1. Copiar el archivo `scripts/windows/wslconfig-8gb.txt` del proyecto a la carpeta de tu usuario, **renombrándolo** a `.wslconfig`:

   **Ruta exacta destino**: `C:\Users\<TU-USUARIO>\.wslconfig`

   (Si todavía no clonaste el repo, hacé este paso después del Paso 3.)

   Desde PowerShell, ya con el repo clonado:
   ```powershell
   Copy-Item .\scripts\windows\wslconfig-8gb.txt "$env:USERPROFILE\.wslconfig"
   ```

2. Aplicarlo:
   ```powershell
   wsl --shutdown
   ```
   (Docker Desktop se va a reiniciar solo en unos segundos.)

**Cómo verificar:**
```powershell
wsl -d docker-desktop -- free -m
```
La fila `Mem:` en la columna `total` tiene que dar **~3000** (no ~4000). Si da ~4000, el archivo quedó mal ubicado o mal nombrado (fijate que no haya quedado como `.wslconfig.txt`: en el Explorador, Ver → tildar "Extensiones de nombre de archivo").

---

## Paso 3 — Clonar el repositorio

```powershell
cd $env:USERPROFILE\Documents
git clone https://github.com/<TU-USUARIO>/<TU-REPO>.git Vanina
cd Vanina
```
Git va a pedir usuario y contraseña de GitHub (o el token personal).

**Cómo verificar:** `dir` tiene que mostrar `docker-compose.prod.yml`, `backend`, `frontend`, `scripts`.

**Si falla:** `repository not found` casi siempre es falta de permisos: confirmá que la cuenta tenga acceso al repo privado.

---

## Paso 4 — Copiar el archivo de credenciales (`.env.prod`)

1. Enchufar el pendrive y copiar el archivo `.env.prod` **a la raíz de la carpeta del proyecto** (al lado de `docker-compose.prod.yml`):
   ```powershell
   Copy-Item E:\.env.prod .\.env.prod    # cambiar E: por la letra del pendrive
   ```

2. **Variables que SÍ hay que revisar en la máquina nueva** (abrir `.env.prod` con el Bloc de notas):

   | Variable | Qué revisar |
   |---|---|
   | `ADMIN_EMAIL` / `ADMIN_PASSWORD_INICIAL` | Es el usuario con el que se entra la primera vez. Anotalos. |
   | `META_*` | Deben estar completas (token, phone number id, verify token). Si están vacías no se puede enviar WhatsApp. |
   | `GEMINI_API_KEY` | La misma key sirve; no hace falta cambiarla por mudar de PC. |
   | `ANALISIS_MAX_POR_MINUTO` | `30` si la cuenta de Gemini tiene facturación; `8` si es free tier. |
   | `BACKUP_S3_*` | Se completan en el **Paso 11** (Backblaze B2). Por ahora pueden quedar vacías. |
   | `HTTP_PORT` | Dejar `80` salvo que ese puerto esté ocupado en la PC nueva. |

   El resto (`JWT_SECRET`, `CONFIG_ENCRYPTION_KEY`, `POSTGRES_PASSWORD`) se copia **tal cual**: no los cambies o el sistema no va a poder leer lo ya guardado.

**Cómo verificar:**
```powershell
Test-Path .\.env.prod        # tiene que decir True
```

---

## Paso 5 — Levantar el sistema

```powershell
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

La **primera vez tarda entre 5 y 15 minutos** (descarga imágenes y compila). Es normal que parezca trabado: está compilando.

**Cómo verificar:**
```powershell
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
```
Tienen que aparecer **5 servicios** (`postgres`, `redis`, `backend`, `web`, `backup`) en estado `running`.

**Si falla:**
- `error during connect` / `docker daemon is not running` → abrir Docker Desktop y esperar a que el ícono deje de moverse.
- `variable is not set` → falta una variable en `.env.prod` (el mensaje dice cuál).
- `port is already allocated` → el puerto 80 está ocupado (Skype/IIS). Cambiar `HTTP_PORT=8080` en `.env.prod` y repetir. Si lo cambiás, ngrok después apunta a 8080.

---

## Paso 6 — Verificar que arrancó bien

1. **Salud del sistema** (PowerShell):
   ```powershell
   Invoke-WebRequest http://localhost/api/health -UseBasicParsing | Select-Object -Expand Content
   ```
   Debe responder: `{"status":"ok","checks":{"api":"ok","database":"ok","redis":"ok"}}`

2. **Entrar al sistema**: abrir el navegador en <http://localhost>, iniciar sesión con el `ADMIN_EMAIL` y `ADMIN_PASSWORD_INICIAL` del `.env.prod`.
   👉 **Cambiar la contraseña** apenas entres (menú superior → "Cambiar contraseña").

3. **Recorrer las pantallas** y confirmar que cargan sin error (van a estar vacías, es lo esperado en una instalación nueva):
   Dashboard · Casos · Cargar Excel · Reportes · RQR · Refuerzos · Normalización · Supresión · Auditoría · Usuarios · Configuración.

**Si falla:**
- La página no abre pero los contenedores están `running` → esperá 1 minuto (el backend aplica migraciones al arrancar) y recargá.
- `database: error` → `docker compose -f docker-compose.prod.yml --env-file .env.prod logs postgres`
- Sigue sin abrir → reiniciar el que publica el puerto: `docker compose -f docker-compose.prod.yml --env-file .env.prod restart web`

---

## Paso 7 — Instalar y configurar ngrok

ngrok es lo que le da al sistema una dirección pública HTTPS para que **Meta pueda entregar los mensajes de WhatsApp**.

1. Instalar (PowerShell):
   ```powershell
   winget install Ngrok.Ngrok
   ```
   Cerrar y volver a abrir PowerShell.

2. Autenticar con el token de tu cuenta:
   ```powershell
   ngrok config add-authtoken <TU-AUTHTOKEN>
   ```

3. Probar el dominio fijo (el mismo que ya está configurado en Meta):
   ```powershell
   ngrok http --domain=<TU-DOMINIO>.ngrok-free.dev 80
   ```
   Dejalo abierto un momento y, desde otra ventana:
   ```powershell
   Invoke-WebRequest https://<TU-DOMINIO>.ngrok-free.dev/api/health -UseBasicParsing | Select-Object StatusCode
   ```
   Tiene que dar **200**. Después cerrá esa ventana de ngrok (el vigilante lo va a levantar solo).

4. **Anotar la ruta del ejecutable** (la vas a necesitar en el Paso 9):
   ```powershell
   (Get-Command ngrok).Source
   ```

**Si falla:**
- `ERR_NGROK_108` (sesión ya activa) → cerrar otras instancias: `Stop-Process -Name ngrok -Force`
- El dominio no es válido → verificá en el panel de ngrok que el dominio esté reservado en **tu** cuenta.

---

## Paso 8 — Auto-login de Windows (necesario)

Docker Desktop es una aplicación de escritorio: **necesita una sesión de usuario iniciada**. Si la PC se reinicia sola (corte de luz, actualización) y queda en la pantalla de login, **el sistema no arranca**.

1. Tecla Windows → escribir `netplwiz` → Enter.
2. Destildar **"Los usuarios deben escribir su nombre y contraseña para usar el equipo"**.
3. Aceptar → escribir dos veces la contraseña de Windows de esa PC.

**Cómo verificar:** reiniciar la PC. Tiene que entrar sola al escritorio, sin pedir contraseña.

> 🔒 Si preocupa la privacidad: podés dejar el auto-login y bloquear la pantalla con `Win + L`. La sesión sigue viva y el sistema sigue funcionando.

---

## Paso 9 — Dejar el sistema desatendido (un solo comando)

Para que el sistema **arranque y se repare solo** (Docker + ngrok) sin que la usuaria toque nada, hay un único script que lo configura y lo verifica todo. Reemplaza a los pasos manuales sueltos, para que la instalación **no pueda quedar a medias**.

Abrir PowerShell **como administrador**, en la carpeta del proyecto, y correr:

```powershell
.\scripts\windows\configurar-pc.ps1
```

El script, de forma idempotente (se puede repetir sin romper nada):

- Verifica que Docker Desktop y ngrok estén instalados, y que ngrok tenga **authtoken**.
- Configura Docker Desktop para arrancar al iniciar sesión.
- **Registra el vigilante** (tarea cada 5 min, al iniciar sesión, con privilegios máximos) que repara Docker y ngrok si se caen.
- Levanta todo (primera corrida) y verifica en vivo que ngrok y la app respondan.
- Chequea el **auto-login** de Windows y avisa si falta (es lo único que no puede hacer solo, porque necesita la contraseña de la PC).

Al terminar imprime un **checklist**: si dice `TODO CUBIERTO`, la usuaria no tiene que tocar nada. Si falta algo (típicamente el auto-login), lo resolvés y volvés a verificar:

```powershell
.\scripts\windows\configurar-pc.ps1 -SoloVerificar
```

> **El auto-login es obligatorio** (Paso 8). Docker Desktop necesita una sesión iniciada; si la PC reinicia y queda en la pantalla de login, nada arranca. El script lo detecta pero no lo activa solo (te pide hacerlo con `netplwiz`).

**Monitoreo:** `scripts\windows\vigilante.log` deja registrado qué reparó y cuándo. Una línea `[OK] Todo en orden…` significa que la última corrida encontró todo sano.

**Comprobación final** — reiniciá la PC y, sin tocar nada, esperá 2-3 minutos: el sistema tiene que quedar accesible en `https://<TU-DOMINIO>.ngrok-free.dev`. Ese es el test real de que quedó desatendido.

---

## Paso 10 — Prueba final: reiniciar sin tocar nada

1. Reiniciar la PC.
2. **No abrir nada.** Esperar 5 minutos.
3. Desde otra computadora o el celular, abrir:
   `https://<TU-DOMINIO>.ngrok-free.dev`

Tiene que aparecer la pantalla de login del sistema.

**También verificá** (en la PC, PowerShell):
```powershell
docker compose -f docker-compose.prod.yml --env-file .env.prod ps   # 5 servicios running
Get-Process ngrok                                                    # ngrok corriendo
Get-Content .\scripts\windows\vigilante.log -Tail 10                 # qué hizo el vigilante
```

**Si a los 5 minutos no responde:** mirá el log del vigilante — ahí queda registrado qué encontró y qué intentó reparar, con hora exacta.

---

## Paso 11 — Copia de seguridad externa (Backblaze B2) ⚠️ crítico

El sistema ya hace un backup diario **dentro de la misma PC**. Eso no alcanza: **si el disco muere, se pierden la base y los backups juntos.** Esta capa sube una copia cifrada a la nube. Backblaze B2 regala **10 GB**, de sobra para esta base.

### 11.1 Crear la cuenta y el bucket

1. Crear cuenta en <https://www.backblaze.com/sign-up/cloud-storage> (pide tarjeta para verificar, pero **10 GB son gratis**).
2. Entrar al panel → menú izquierdo **Buckets** → **Create a Bucket**:
   - **Bucket Unique Name**: `calidad-ford-backups` (si está tomado, agregale algo: `calidad-ford-backups-sj`).
   - **Files in Bucket are**: **Private** ← importante.
   - **Default Encryption**: **Enable** (recomendado).
   - **Object Lock**: Disable.
   - Botón **Create a Bucket**.
3. **Anotar el Endpoint**: en la lista de buckets, debajo del nombre dice algo como
   `s3.us-west-004.backblazeb2.com`.
   De ahí salen dos datos:
   - `BACKUP_S3_ENDPOINT` = `https://s3.us-west-004.backblazeb2.com`
   - `BACKUP_S3_REGION` = `us-west-004` ← **tiene que coincidir con el endpoint**

### 11.2 Generar las claves

1. Panel → **Application Keys** → **Add a New Application Key**:
   - **Name of Key**: `calidad-backup`
   - **Allow access to Bucket(s)**: elegir **solo** el bucket recién creado (no "All").
   - **Type of Access**: **Read and Write**.
   - El resto vacío → **Create New Key**.
2. La pantalla muestra **una sola vez**:
   - `keyID` → va en `BACKUP_S3_ACCESS_KEY`
   - `applicationKey` → va en `BACKUP_S3_SECRET_KEY`

   📋 **Copialos ahora**: si cerrás la ventana no se pueden volver a ver (hay que generar otra clave).

### 11.3 Completar el `.env.prod`

Abrir `.env.prod` y completar (con **tus** valores):

```ini
BACKUP_S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com
BACKUP_S3_BUCKET=calidad-ford-backups
BACKUP_S3_ACCESS_KEY=004xxxxxxxxxxxxxxxxxxxxxx
BACKUP_S3_SECRET_KEY=K004xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
BACKUP_S3_REGION=us-west-004
```

Aplicar los cambios (recrea el contenedor de backup con las variables nuevas):
```powershell
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

### 11.4 Probar la subida ahora mismo (no esperar al backup de las 3 AM)

```powershell
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backup /opt/backup/backup.sh
```

**Cómo verificar que salió bien:**
- La salida termina con `[backup] copia offsite OK → s3://...`
- En el panel de B2, entrar al bucket → tiene que estar el archivo `calidad_AAAAMMDD_HHMMSS.sql.gz`.
- En el sistema: Dashboard → tarjeta **"Estado de los backups"**.

**Si falla:**

| Error en la salida | Qué significa y cómo se arregla |
|---|---|
| `InvalidAccessKeyId` / `SignatureDoesNotMatch` | keyID o applicationKey mal copiados. Generá una clave nueva. |
| `The bucket ... does not exist` | El nombre del bucket no coincide, o la región/endpoint son de otra zona. |
| `Could not connect to the endpoint URL` | Falta `https://` en el endpoint, o hay un error de tipeo. |
| `AuthorizationError` / `403` | La clave no tiene permiso sobre ese bucket, o se creó como solo-lectura. |
| Sube pero con `Unsupported header` | Ya está contemplado en el script (desactiva los checksums de aws-cli, incompatibles con B2). Si aparece, avisá. |

### 11.5 Qué queda funcionando

- **Todos los días a las 03:00**: dump de la base → copia local (se conservan 14 días) → subida a B2.
- **Domingos a las 04:00**: verificación automática (restaura el último dump en una base descartable y comprueba que tenga datos).
- El **Dashboard** muestra la fecha del último backup y si la verificación pasó.
- **Para restaurar** ante un desastre: ver el procedimiento en `PRODUCCION.md`.

> 💡 Revisá el bucket una vez por mes: si dejaran de aparecer archivos nuevos, el backup externo se rompió y nadie se entera hasta que hace falta.

---

## Resumen: qué queda andando solo

| Cuándo | Qué pasa |
|---|---|
| Al prender la PC | Auto-login → arranca Docker → levanta el sistema → levanta ngrok |
| Cada 5 minutos | El vigilante revisa y repara (Docker, contenedores, API, ngrok) |
| Todos los días 03:00 | Backup de la base (local + Backblaze B2) |
| Domingos 04:00 | Verificación automática del backup |

**Los tres archivos que NUNCA van a GitHub y hay que guardar aparte:**
`.env.prod` · los Excel con datos de clientes · los backups.

Si algo anda mal, el primer lugar para mirar es siempre:
```powershell
Get-Content .\scripts\windows\vigilante.log -Tail 30
```
