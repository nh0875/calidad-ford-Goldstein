# Instalación del Sistema de Calidad — paso a paso

> **Quién hace esto:** la instalación (pasos 0 a 6) la hace **una sola vez** quien
> prepara la PC, con **permisos de administrador**. Lleva unos **30 a 45 minutos**
> la primera vez (la mayor parte es esperar descargas).
>
> **Vanina no instala nada.** Ella solo prende la PC, inicia sesión y abre el
> navegador — ver **"Uso diario"** al final.

---

## Datos que vas a necesitar (copialos de acá)

| Qué | Valor |
|---|---|
| Usuario del sistema | `admin@goldstein.com.ar` |
| Contraseña | `UqWuQnF5Zwf92bDT#4` |
| Dirección del sistema (en la PC) | http://localhost |
| Dirección pública (webhook de Meta) | https://antitrust-trace-unloader.ngrok-free.dev |
| Token de ngrok | `3GrusSzHu6fedxjLuO6pjn5wzmk_5qcrdEYnULg5GN7VKwodd` |
| Verify token del webhook | `calidad-ford-2026-xK9m` |

## Antes de empezar — requisitos

- Una PC con **Windows 10 u 11**.
- **Conexión a internet** (se descargan Docker y ngrok).
- El archivo **`Vanina-Sistema-Calidad.zip`**.
- Que la PC tenga la **virtualización activada** (casi siempre viene así; si no,
  Docker te lo avisa y lo resolvés en el Paso 2.5).

> ### 🔑 Importante: con qué cuenta de Windows instalar
> **Hacé toda la instalación logueado con la MISMA cuenta de Windows que Vanina va
> a usar todos los días**, y esa cuenta tiene que tener **permisos de
> administrador**.
>
> ¿Por qué? El sistema se arranca y se repara solo mediante un "vigilante" que
> queda **atado a la cuenta que corre el instalador** y se dispara cuando **esa**
> cuenta inicia sesión en Windows. Si instalás desde otra cuenta (ej. un
> "Administrador" distinto), cuando Vanina entre a la suya el sistema no
> arrancaría solo.
>
> **NO hace falta** crear ni iniciar sesión en ninguna **cuenta de Docker** (se
> saltea con "Skip") **ni de ngrok** (se usa solo el token). La única sesión que
> importa es la **de Windows** de Vanina: como no hay auto-login (modo seguro),
> ella inicia sesión cada día y ahí el sistema levanta solo.

---

## Paso 0 — Descomprimir la carpeta

1. Copiá el archivo **`Vanina-Sistema-Calidad.zip`** a la PC de Vanina (por USB o
   descargándolo).
2. Hacé **clic derecho** sobre el zip → **"Extraer todo…"**.
3. En la ventana que aparece, escribí o elegí una carpeta simple, por ejemplo
   **`C:\Calidad`**, y tocá **"Extraer"**.
4. Te va a quedar la carpeta **`C:\Calidad\Vanina`** con todo adentro. Esa es la
   carpeta del proyecto. *(Podés usar otra ruta; los scripts se ubican solos.)*

> ✅ Para confirmar que está bien: dentro de `C:\Calidad\Vanina` tenés que ver
> carpetas como `backend`, `frontend`, `scripts`, y archivos como
> `docker-compose.prod.yml`.

---

## Paso 1 — Instalar Docker Desktop

Docker es el motor que hace correr el sistema.

1. Entrá a **https://www.docker.com/products/docker-desktop/** y descargá
   **"Docker Desktop for Windows"**.
2. Ejecutá el instalador descargado (`Docker Desktop Installer.exe`).
3. Dejá **todas las opciones por defecto** (que quede tildado "Use WSL 2"). Tocá
   **"Ok"** / "Install" y esperá.
4. Cuando termine, **puede pedir reiniciar la PC**. Reiniciá si lo pide.
5. Después del reinicio, **abrí Docker Desktop** (buscalo en el menú Inicio).
   - La primera vez muestra unos términos: aceptalos ("Accept").
   - Puede pedir iniciar sesión / crear cuenta: **se puede saltear** ("Skip" / "Continue without signing in").
   - Esperá a que abajo a la izquierda el **ícono de la ballena quede verde** y
     diga **"Engine running"**. Eso puede tardar 1-2 minutos.

### Paso 2.5 — Si Docker se queja de la virtualización (solo si pasa)
Si Docker muestra un error de "virtualization" o "WSL 2":
1. Abrí PowerShell **como administrador** (ver cómo en el Paso 4) y ejecutá:
   ```powershell
   wsl --install
   ```
2. Reiniciá la PC.
3. Si sigue fallando, hay que **activar la virtualización en la BIOS** (buscá
   "Intel VT-x" / "AMD-V" / "SVM"): se entra a la BIOS al prender la PC (tecla
   Supr / F2 / F10 según la marca), se activa y se guarda. Ante la duda, esto lo
   hace alguien con experiencia; es un paso poco frecuente.

---

## Paso 2 — Instalar ngrok y pegar su token

ngrok es lo que permite que los WhatsApp de los clientes lleguen a la PC.

1. Abrí **PowerShell** (todavía NO hace falta que sea como administrador):
   menú Inicio → escribí **`powershell`** → Enter.
2. Instalá ngrok copiando y pegando esto (Enter al final):
   ```powershell
   winget install Ngrok.Ngrok
   ```
   Si pregunta por términos/origen, aceptá (tecla `Y` + Enter).
3. Pegá el **token** (una sola vez). Es lo que conecta con la cuenta dueña del
   dominio; **tiene que ser exactamente este**:
   ```powershell
   ngrok config add-authtoken 3GrusSzHu6fedxjLuO6pjn5wzmk_5qcrdEYnULg5GN7VKwodd
   ```
   Tiene que responder algo como *"Authtoken saved to configuration file"*.

> ⚠️ Si este token no es el de la cuenta dueña del dominio
> `antitrust-trace-unloader.ngrok-free.dev`, **no van a llegar los WhatsApp**. Usá
> el de la tabla de arriba tal cual.

---

## Paso 3 — Configurar la memoria (evita que Docker se cuelgue)

En una PC con poca RAM, Docker puede tumbarse. Este archivo lo evita.

1. Abrí el **Bloc de notas**.
2. Pegá **exactamente** esto:
   ```ini
   [wsl2]
   memory=2GB
   processors=4
   swap=4GB

   [experimental]
   autoMemoryReclaim=gradual
   sparseVhd=true
   ```
   *(Hay una copia lista para copiar en `C:\Calidad\Vanina\scripts\windows\wslconfig-8gb.txt`.)*
3. Guardalo así: **Archivo → Guardar como…**
   - Andá a la carpeta de tu usuario: en la barra de arriba escribí **`%USERPROFILE%`** y Enter.
   - En **"Nombre"** poné, **con comillas**: **`".wslconfig"`** (las comillas son importantes para que no le agregue `.txt`).
   - En **"Tipo"** elegí **"Todos los archivos"**.
   - **Guardar**.
4. Volvé a PowerShell y ejecutá para aplicarlo:
   ```powershell
   wsl --shutdown
   ```

> Si la PC tiene más de 6 GB de RAM, se pueden subir esos números (ver la tabla en
> "Referencia técnica"). Con 2GB anda bien en una PC de 6 GB.

---

## Paso 4 — Correr el instalador (un solo comando)

Este comando deja **todo listo de una vez**: no permite que la PC se suspenda,
levanta el sistema, y lo pone a arrancar solo y a repararse cada 5 minutos.

1. Abrí **PowerShell COMO ADMINISTRADOR**:
   - Menú Inicio → escribí **`powershell`**.
   - Sobre **"Windows PowerShell"**, hacé **clic derecho → "Ejecutar como administrador"**.
   - Si Windows pregunta "¿Permitir que esta app haga cambios?", decí **"Sí"**.
   - La ventana tiene que decir **"Administrador: Windows PowerShell"** en el título.
2. Entrá a la carpeta del proyecto (ajustá la ruta si la extrajiste en otro lado):
   ```powershell
   cd C:\Calidad\Vanina
   ```
3. Ejecutá el instalador:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\windows\configurar-pc.ps1
   ```
4. **Qué va a pasar** (la primera vez tarda **varios minutos** porque arma el
   sistema):
   - Va mostrando pasos: Energía, Docker, Vigilante, Arranque…
   - Cuando "arma las imágenes" por primera vez, se queda un rato sin mostrar
     nada nuevo: **es normal, esperá** (puede ser 3-8 minutos).
   - Al final imprime un **checklist**. Si dice **`TODO CUBIERTO`** en verde,
     quedó listo. Si algo aparece en **rojo (`FALTA`)**, resolvé eso (suele ser el
     token de ngrok o Docker que todavía no arrancó) y volvé a correr el comando.

> Podés volver a correrlo cuando quieras **solo para verificar**, sin cambiar
> nada:
> ```powershell
> powershell -ExecutionPolicy Bypass -File .\scripts\windows\configurar-pc.ps1 -SoloVerificar
> ```

---

## Paso 5 — Verificar que quedó andando

1. Abrí un navegador (Chrome / Edge) y entrá a **http://localhost**.
   - Si no abre al toque, esperá **1-2 minutos** (Docker puede seguir arrancando)
     y recargá.
2. Tiene que aparecer la **pantalla de inicio de sesión** del sistema.
3. Iniciá sesión con el usuario y la contraseña de la **tabla del principio**.
4. Si entrás y ves el panel, **está funcionando** 🎉.

---

## Paso 6 — Dejarla lista para el día a día

- **No hace falta activar inicio de sesión automático** (por seguridad, la PC pide
  la contraseña de Windows como siempre).
- Dejá la PC **prendida** durante el horario de trabajo.
- El sistema ya está configurado para **no suspenderse** y para **levantarse solo
  cuando Vanina inicia sesión**.

---

## Uso diario (esto lo hace Vanina — no instala nada)

1. Prende la PC e **inicia sesión en Windows** con su contraseña, como siempre.
2. **Espera 1 o 2 minutos** (el sistema levanta solo por detrás).
3. Abre el navegador en **http://localhost** e inicia sesión en el sistema.
4. Listo. No tiene que abrir Docker, ni ngrok, ni ninguna ventana negra.

**Si la PC se reinició sola de noche** (corte de luz, actualización): queda en la
pantalla de contraseña de Windows. En cuanto Vanina inicia sesión a la mañana, el
sistema vuelve solo.

**Para que siga recibiendo WhatsApp fuera de hora:** dejá la PC **prendida y con la
sesión iniciada** (podés **bloquear la pantalla** con `Win + L`, eso NO frena
nada). Solo se corta si se **apaga** o se **cierra sesión**.

---

## Si el sistema no anda — levantarlo a mano (Vanina)

El sistema se **repara solo** cada 5 minutos. Pero si en algún momento no anda y no
querés esperar, en el **escritorio** hay un acceso directo
**"Levantar Sistema de Calidad"**: hacé **doble clic** y esperá 1-2 minutos hasta
que la ventana diga **LISTO**. Después abrí `http://localhost`.

*(El acceso directo apunta a `Levantar-sistema.bat`, que está en la carpeta del
sistema. Si no aparece en el escritorio, entrá a la carpeta y hacé doble clic ahí.)*

---

## Cómo entra el resto del equipo

La PC de Vanina es el "servidor": mientras esté **prendida y andando**, los demás
entran desde **su propio dispositivo** (PC, notebook o celular), cada uno con **su
propio usuario**.

- **Desde cualquier lado (por internet):**
  `https://antitrust-trace-unloader.ngrok-free.dev`
  - ⚠️ La primera vez puede aparecer una **pantalla de aviso de ngrok** ("You are
    about to visit…"): hay que tocar **"Visit Site"** para entrar. Es una
    limitación del plan **gratuito** de ngrok (no es una falla del sistema).
- **En la misma oficina (más rápido y sin ese aviso):** por la **IP local** de la
  PC de Vanina, por ejemplo `http://192.168.1.50`. Para saber la IP, en esa PC
  abrí PowerShell y corré `ipconfig`; mirá el número de **"Dirección IPv4"**.

Los usuarios los crea un **administrador** desde la pestaña **Usuarios** (email,
contraseña, rol, área y provincia).

> **⚠️ Importante (ngrok):** el plan gratuito permite **UN solo túnel a la vez** con
> ese token. Cuando el sistema esté corriendo en la PC de Vanina, **ninguna otra PC
> debe tener ngrok corriendo con el mismo token** (por ejemplo, la PC donde se
> desarrolló): si dos lo usan a la vez, se pisan y deja de andar.

---

## Si algo sale mal (problemas comunes)

| Síntoma | Qué hacer |
|---|---|
| **http://localhost no abre** | Esperá 1-2 min y recargá. Si sigue, abrí Docker Desktop y esperá la ballena verde; después volvé a correr el instalador (Paso 4). |
| **El checklist dice FALTA ngrok / token** | Repetí el Paso 2 (el comando `add-authtoken` con el token de la tabla). |
| **El checklist dice FALTA Docker** | Abrí Docker Desktop a mano y esperá "Engine running"; después corré el instalador de nuevo. |
| **No llegan los WhatsApp** | Verificá que ngrok tenga el token correcto (Paso 2) y que la PC no esté suspendida. El vigilante reintenta solo cada 5 min. |
| **Docker se queja de virtualización** | Ver Paso 2.5. |
| **Quiero ver qué está haciendo el sistema** | Abrí `C:\Calidad\Vanina\scripts\windows\vigilante.log` (dice qué reparó y cuándo). |

Para una revisión rápida del estado, corré (PowerShell como administrador, en la
carpeta del proyecto):
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\configurar-pc.ps1 -SoloVerificar
```

---
---

# Referencia técnica (avanzado — no hace falta para instalar)

Tres piezas hacen que el sistema corra **desatendido**. Las tres **detectan solas**
dónde está la carpeta, así que se puede copiar a cualquier ruta sin editar nada.

| Script | Cuándo corre | Para qué |
|---|---|---|
| `configurar-pc.ps1` | Una vez, al instalar (como admin) | Deja todo listo y verificado en un paso. Imprime un checklist. |
| `vigilante.ps1` | Cada 5 minutos (lo registra el instalador) | Detecta y repara: Docker caído, contenedores caídos, API sin responder, ngrok caído. |
| `iniciar-sistema.bat` | Al iniciar Windows (opcional) | Levanta el stack + ngrok. Con el vigilante registrado es opcional. |

## Qué hace el vigilante en cada corrida

1. **Docker Desktop**: si el engine no responde, lo inicia y espera. Si está
   colgado, lo cierra y lo reabre.
2. **Contenedores**: si falta alguno de los 5 (`postgres`, `redis`, `backend`,
   `web`, `backup`), levanta el stack de producción.
3. **API**: llama a `http://localhost/api/health`. Si no responde, distingue la
   causa (puerto roto tras reiniciar WSL → reinicia `web`; backend caído →
   reinicia `backend`; si aun así falla → reinicia todo). Nunca reinicia un
   backend que todavía está arrancando.
4. **ngrok**: si el proceso no está, o está pero sin el túnel del dominio, lo
   relanza.
5. **Log**: `scripts/windows/vigilante.log`. Es silencioso: si todo está bien
   escribe **una línea `[OK]` por día**; solo escribe cuando repara algo o falla.

## Memoria de WSL2 según la RAM de la PC

Docker corre dentro de WSL2, que por defecto toma hasta el 50 % de la RAM y no la
devuelve. El `.wslconfig` (Paso 3) lo limita. Valores según la RAM:

| RAM de la PC | `memory` | `processors` | `swap` |
|---|---|---|---|
| 6 GB | `2GB` | 4 | `4GB` |
| 8 GB | `3GB` | 4 | `4GB` |
| 16 GB | `6GB` | 6 | `4GB` |
| 32 GB o más | `8GB` | 8 | `8GB` |

Regla: dejarle a Windows al menos 3 GB libres. Verificar cuánto quedó:
`wsl -d docker-desktop -- free -m`.

## Energía: la PC no debe dormir

Si la PC entra en suspensión/hibernación, se congela todo (Docker, ngrok, backend)
y no responde a los WhatsApp mientras duerme. El instalador ya lo pone en "Nunca".
Para verificar/forzar a mano (PowerShell como administrador):

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change standby-timeout-dc 0
powercfg /change hibernate-timeout-ac 0
powercfg /change hibernate-timeout-dc 0
```
Es normal que la **pantalla** se apague sola; eso no frena el sistema.

## Comandos útiles

```powershell
# Correr el vigilante a mano una vez (no hace nada si todo está bien)
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\vigilante.ps1
Get-Content .\scripts\windows\vigilante.log -Tail 10

# Ver el estado de los contenedores
docker ps

# Frenar todo a mano (y cerrar ngrok)
docker compose -f docker-compose.prod.yml --env-file .env.prod down

# Ver los logs del sistema si algo anda mal
docker compose -f docker-compose.prod.yml --env-file .env.prod logs --tail 100
```

## El webhook de Meta (ya configurado, solo como referencia)

- URL: `https://antitrust-trace-unloader.ngrok-free.dev/api/webhooks/whatsapp`
- Verify token: `calidad-ford-2026-xK9m`
- Suscrito a: `messages`, `message_template_status_update`, `phone_number_quality_update`

No hay que reconfigurarlo al mover la PC: mientras ngrok levante el **mismo
dominio** con el **mismo token**, Meta sigue llegando igual.
