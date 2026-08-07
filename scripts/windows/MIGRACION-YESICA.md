# Migración del Sistema de Calidad a la PC de Yesica

> **Qué es esto:** mover el sistema (que estaba en la PC de Vanina) a la PC de
> Yesica, **con los datos incluidos**. Es la misma instalación que hicimos con
> Vanina, más el paso de **restaurar la base**.
>
> **Tiempo:** ~45-60 min (la mayoría es esperar descargas y el primer *build*).
> Lo hace **una sola vez** quien prepara la PC, con **permisos de administrador**.

---

## ⚠️ Antes que nada — 2 cosas críticas

1. **El token de ngrok es el MISMO que el de Vanina** (usan el mismo perfil de
   Google). El plan gratuito permite **UN solo túnel a la vez** con ese token:
   asegurate de que **ninguna otra PC** esté corriendo ngrok con ese token
   (la de Vanina murió, así que debería estar libre; si tenés otra PC de prueba
   con ngrok abierto, cerralo). Si dos lo usan a la vez, **se pisan y no llegan
   los WhatsApp**.
2. **El dominio de ngrok no cambia** (`dealer-occupant-brigade.ngrok-free.dev`).
   Por eso **NO hay que tocar el webhook de Meta**: mientras la PC de Yesica
   levante ese mismo dominio con ese mismo token, Meta sigue llegando igual.

## Datos que vas a necesitar (los mismos de siempre)

| Qué | Valor |
|---|---|
| Usuario del sistema | `admin@goldstein.com.ar` |
| Contraseña | *(la de siempre; está en el `.env.prod`)* |
| Dirección en la PC | http://localhost |
| Dirección pública (webhook) | https://dealer-occupant-brigade.ngrok-free.dev |
| Token de ngrok | `TU-TOKEN-NUEVO-DE-NGROK` |
| Verify token del webhook | `calidad-ford-2026-xK9m` |

---

# PARTE A — En tu PC (armar el paquete con los datos)

### A1. Sacá el backup con los datos de HOY (en la PC de Vanina)

⚠️ **NO uses los dumps de `pcvanina\`** — son fotos viejas (fin de julio / 4 de
agosto). Para migrar los datos **actuales**, sacá un dump **ahora, en la PC de
Vanina** (la que está prendida y recibiendo los WhatsApp). El backup es una foto de
la base en el momento que lo corrés.

**Lo más fácil (botón):** en la carpeta del sistema de Vanina, entrá a
`scripts\windows\` y hacé **doble clic en `Respaldo-AHORA.bat`**. Al terminar, el
dump del momento queda en `...\Respaldos\calidad_<fecha>_<hora>.dump`.

**A mano (PowerShell, en la carpeta del proyecto de Vanina):**
```powershell
$c = (docker ps --filter "name=postgres" --format "{{.Names}}" | Select-Object -First 1)
docker exec $c sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" -f /tmp/hoy.dump'
docker cp "${c}:/tmp/hoy.dump" "$env:USERPROFILE\Desktop\calidad-hoy.dump"
docker exec $c rm -f /tmp/hoy.dump
```
Te deja **`calidad-hoy.dump`** en el Escritorio.

> Ese archivo es la foto EXACTA de los datos de hoy: es el que llevás a la PC de
> Yesica. Necesita que la PC de Vanina esté prendida con el sistema andando; si el
> disco no arranca, lo más nuevo que hay es el último respaldo de SharePoint.

### A2. Armá el ZIP para llevar a la PC de Yesica

1. **Copiá el `calidad-hoy.dump`** (el del paso A1) **dentro de la carpeta del
   proyecto** actualizada.
2. Comprimí **toda esa carpeta** (la que tiene `backend`, `frontend`, `scripts`,
   `docker-compose.prod.yml` y `.env.prod`) **con el dump adentro**. Copiala a un
   pendrive o subila a la nube. Nombrala, por ejemplo, **`Yesica-Sistema-Calidad.zip`**.

> ⚠️ **Usá la versión ACTUALIZADA del código** (la de tu PC / la rama `dev`), NO la
> carpeta vieja de Vanina — así Yesica arranca con las últimas mejoras (fidelización
> en Seguimiento, plantillas, envío masivo). Los datos viejos igual entran, porque
> el reinicio del backend (paso B6.5) pone el esquema al día.
>
> ✅ Chequeo: dentro del ZIP tienen que estar sí o sí **`docker-compose.prod.yml`**,
> **`.env.prod`** y **`calidad-hoy.dump`** (los tres van en el paquete, no por git).

---

# PARTE B — En la PC de Yesica (instalar)

> ### 🔑 Con qué cuenta de Windows instalar
> Hacé **toda** la instalación logueado con la **MISMA cuenta de Windows que Yesica
> va a usar todos los días**, y que esa cuenta tenga **permisos de administrador**.
> El sistema se arranca y se repara solo con un "vigilante" atado a esa cuenta; si
> instalás desde otra, cuando Yesica entre a la suya el sistema no levantaría solo.

### B0. Descomprimir
Clic derecho al `Yesica-Sistema-Calidad.zip` → **Extraer todo…** → elegí una ruta
simple, por ejemplo **`C:\Calidad`**. Te queda `C:\Calidad\Vanina` (o el nombre de
la carpeta) con todo adentro, incluido el `calidad-hoy.dump`.

### B1. Instalar Docker Desktop
Igual que con Vanina: **[README.md → Paso 1](README.md)** (descargar Docker
Desktop, instalar con WSL 2, esperar la ballena verde "Engine running").

### B2. Configurar la memoria de WSL (.wslconfig)
Igual que con Vanina: **[README.md → Paso 3](README.md)**. **Ojo:** ajustá los
valores a la **RAM de la PC de Yesica** (tabla en el README: 8 GB → `memory=3GB`,
16 GB → `6GB`, etc.). Después: `wsl --shutdown`.

### B3. Instalar ngrok y pegar el token (el MISMO de Vanina)
En **PowerShell**:
```powershell
winget install Ngrok.Ngrok
ngrok config add-authtoken TU-TOKEN-NUEVO-DE-NGROK
```
> ⚠️ Es el **mismo token** porque es el mismo perfil de Google. Recordá: **una
> sola PC puede usarlo a la vez**. Verificá que la PC de Vanina (u otra de prueba)
> **no** esté corriendo ngrok.

### B4. Revisar el `.env.prod`
El `.env.prod` ya viene en el ZIP con las credenciales. Confirmá que tenga:
```
HTTP_PORT=80
HTTP_BIND=0.0.0.0
```
*(Si venía con `HTTP_PORT=8090` de la PC de prueba, cambialo a `80`.)* El resto de
las claves (Meta, JWT, cifrado) **dejalas tal cual**: son las que hacen que el
token de WhatsApp guardado siga funcionando.

### B5. Primer arranque (build) — un solo comando
En **PowerShell COMO ADMINISTRADOR**, en la carpeta del proyecto:
```powershell
cd C:\Calidad\Vanina
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```
La primera vez tarda **varios minutos** (compila las imágenes). Esperá a que
terminen de arrancar los 5 contenedores (`docker ps` los muestra).

### B6. 🔁 Restaurar los datos (el dump)
Con los contenedores arriba, importá la base:
```powershell
$c = (docker ps --filter "name=postgres" --format "{{.Names}}" | Select-Object -First 1)
docker cp ".\calidad-hoy.dump" "${c}:/tmp/mig.dump"
docker exec $c sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists /tmp/mig.dump'
docker exec $c rm -f /tmp/mig.dump
```
> Va a tirar algún *warning* ("already exists", "errors ignored on restore: 1"):
> es **NORMAL** (`--clean --if-exists` lo maneja) y **no pierde datos**.

### B6.5. 🔁 Reiniciar el backend (pone el esquema al día) — ¡NO te lo saltees!
El dump trae el esquema de esa fecha (anterior a las últimas actualizaciones del
sistema). Al restaurarlo, el esquema "vuelve para atrás"; reiniciar el backend hace
que `prisma migrate deploy` lo ponga al día **automáticamente y sin perder datos**:
```powershell
$b = (docker ps -a --filter "name=backend" --format "{{.Names}}" | Select-Object -First 1)
docker restart $b
```
Esperá ~1-2 min a que el backend vuelva a estar sano (`docker ps` lo muestra como
`healthy`). *(Probado: los casos y mensajes quedan intactos y el esquema queda al día.)*

### B7. Dejar todo automático (anti-suspensión + vigilante + arranque)
En la **misma PowerShell de administrador**:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\configurar-pc.ps1
```
Esto: impide que la PC se suspenda, registra el **vigilante** (repara Docker/ngrok
cada 5 min), deja el sistema arrancando solo cuando Yesica inicia sesión, y crea el
acceso directo "Levantar Sistema de Calidad" en el escritorio. Al final imprime un
checklist: si dice **`TODO CUBIERTO`**, quedó. Si algo sale **rojo**, resolvé eso y
volvé a correrlo.

### B8. Verificar
1. Abrí un navegador en **http://localhost** → tiene que aparecer el login.
2. Entrá con `admin@goldstein.com.ar` y la contraseña. **Tienen que estar los
   datos** (casos, clientes) que restauraste.
3. WhatsApp: entrá a **https://dealer-occupant-brigade.ngrok-free.dev** y probá.
   Como el dominio y el token son los mismos, el webhook de Meta sigue igual —
   **no hay que reconfigurar nada en Meta**.

### B9. Activar el respaldo diario a SharePoint
Para que la base de Yesica también se respalde sola todos los días:
seguí **[README.md → Paso 7](README.md)** (sincronizar la biblioteca de SharePoint
y correr `Instalar-Respaldo-Diario.ps1`).

---

# PARTE C — Uso diario (esto lo hace Yesica)

1. Prende la PC e **inicia sesión en Windows** con su contraseña.
2. Espera **1-2 minutos** (el sistema levanta solo por detrás).
3. Abre el navegador en **http://localhost** e inicia sesión en el sistema.
4. Listo. No abre Docker, ni ngrok, ni ninguna ventana negra.

**Para recibir WhatsApp fuera de hora:** dejar la PC **prendida y con la sesión
iniciada** (se puede bloquear con `Win + L`, eso no frena nada). Solo se corta si
se **apaga** o se **cierra sesión**.

---

## Si algo sale mal

| Síntoma | Qué hacer |
|---|---|
| `http://localhost` no abre | Esperá 1-2 min. Abrí Docker Desktop, esperá la ballena verde, y corré de nuevo `configurar-pc.ps1`. |
| No llegan los WhatsApp | Verificá que **ninguna otra PC** tenga ngrok corriendo con ese token (un solo túnel a la vez). El vigilante reintenta solo cada 5 min. |
| Faltan datos / base vacía | Repetí el **Paso B6** (restore del dump). |
| "docker-compose.prod.yml not found" | El ZIP no incluyó el compose local. Copiá `docker-compose.prod.yml` a la carpeta del proyecto (no va por git, va en el ZIP). |
| Ver qué hace el sistema | `scripts\windows\vigilante.log` |

> Revisión rápida del estado (PowerShell admin, en la carpeta):
> ```powershell
> powershell -ExecutionPolicy Bypass -File .\scripts\windows\configurar-pc.ps1 -SoloVerificar
> ```
