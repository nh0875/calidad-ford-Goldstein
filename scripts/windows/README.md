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
| Dirección pública (webhook de Meta) | https://dealer-occupant-brigade.ngrok-free.dev |
| Token de ngrok | `TU-TOKEN-NUEVO-DE-NGROK` |
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
   ngrok config add-authtoken TU-TOKEN-NUEVO-DE-NGROK
   ```
   Tiene que responder algo como *"Authtoken saved to configuration file"*.

> ⚠️ Si este token no es el de la cuenta dueña del dominio
> `dealer-occupant-brigade.ngrok-free.dev`, **no van a llegar los WhatsApp**. Usá
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

## Paso 7 — Respaldo diario a OneDrive (ya viene andando: no hay nada que instalar)

> **Para qué:** el sistema ya hace una copia de la base todas las noches, pero esa
> copia vive en **el mismo disco** que el sistema. Si el disco de esta PC se rompe,
> se pierden los datos y las copias juntos. Este respaldo saca una copia **fuera de
> la PC**: la deja en la carpeta de **OneDrive de la empresa** del usuario que está
> usando la máquina, y OneDrive la sube sola a la nube. Si la PC muere, la copia ya
> está arriba.

**No hay que instalar ninguna tarea ni ser administrador.** Lo dispara el
**vigilante**, que ya corre cada 5 minutos en las dos PCs, dentro de la sesión de la
persona. Antes había que registrar a mano una tarea programada, y eso es justo lo que
nunca se hizo: Ford estuvo **19 días sin respaldo** con el estado en verde.

- Corre **a las 12:00** (mediodía: la PC está prendida y no hay nadie trabajando).
- Si a esa hora la PC estaba apagada, **reintenta en cada pasada hasta las 19:00**.
- Si el del día **ya salió bien, no lo repite**.
- El destino lo **encuentra solo**: la carpeta de OneDrive **de la empresa** de la
  sesión abierta (la que se llama `OneDrive - <empresa>`), subcarpeta
  **`Respaldos Calidad`**, que el script crea si no está.
- Conserva las **últimas 7 copias en OneDrive** y las **últimas 14 en la PC**.
- Si **una** base falla (por ejemplo la de Volkswagen), igual copia las que sí
  salieron y deja anotado cuál faltó (campo `basesFallidas`).

> **Lo único que tiene que pasar en esta PC:** que **OneDrive esté con la sesión
> iniciada** con la cuenta de M365 de la empresa (el ícono de la nube, abajo a la
> derecha, en azul/blanco). Sin eso no hay carpeta a dónde copiar y el respaldo queda
> en el mismo disco que la base, que es lo mismo que no tener respaldo.

### A) Cómo verificar que anduvo

1. **El Dashboard** (es la forma de siempre y la que conviene mirar). En la tarjeta
   **"Estado de los backups"**, arriba de todo está la casilla **"Copia diaria a
   OneDrive"**:
   - **verde / "OK"**: salió, y muestra cuándo, a qué destino, cuántas bases y cuánto pesó;
   - **rojo / "Falló" o "Atrasado"**: ver el punto **B**;
   - **"Sin datos"**: todavía no corrió ninguno en esta PC (recién instalada, o nunca
     llegó el mediodía con la PC prendida).
2. **La carpeta de OneDrive**, desde el Explorador o desde el navegador: tiene que
   haber **un archivo por base**, con la fecha en el nombre —
   `calidad_ford_AAAA-MM-DD_hhmm.dump` y, si Volkswagen está en uso,
   `calidad_vw_AAAA-MM-DD_hhmm.dump`.
3. **El detalle de cada corrida** queda en `Respaldos\respaldo.log` de la carpeta del
   proyecto, y el resultado de la última en `Respaldos\ultimo-respaldo.json` (ese
   archivo es el que lee el Dashboard; `"ok": true` significa que la copia **salió de
   esta PC**, no solo que el dump se generó).

> El respaldo también se puede correr **en el momento**, sin esperar al mediodía:
> doble clic en **`Respaldo-AHORA.bat`**. Usa la misma configuración, no hay que
> escribir nada.

### B) Si el Dashboard muestra la casilla en rojo

Rojo quiere decir una de dos cosas: el último respaldo **falló**, o el último bueno
quedó **más viejo que 72 horas** (tres días, para que un fin de semana con las PCs
apagadas no dispare la alarma). Qué mirar, en orden:

1. **¿OneDrive tiene la sesión iniciada?** Es la causa más común. Abrí "OneDrive"
   del menú Inicio y entrá con la cuenta de la empresa.
2. **¿La PC estuvo prendida entre las 12:00 y las 19:00?** Si estuvo apagada todo ese
   rato, el respaldo del día no llegó a correr. Alcanza con dejarla prendida al
   mediodía; si querés uno ya, doble clic en `Respaldo-AHORA.bat`.
3. **Leé el motivo**: la propia casilla lo muestra en rojo, y el detalle largo está en
   `Respaldos\respaldo.log`.
4. Si dice que **no encontró ninguna carpeta de OneDrive**, forzala a mano (punto **C**).

> **Además avisa por correo.** Si pasan más de **72 horas** sin un respaldo bueno, el
> vigilante manda **un** mail después de las 19:00. Por decisión del dueño va a la
> usuaria de la PC, que es quien puede fijarse si OneDrive está con la sesión
> iniciada: Ford → `yandino@mariogoldsteinsa.com.ar`, Volkswagen →
> `ldip@mariogoldsteinsa.com.ar`. Se cambia con `RESPALDO_ALERTA_EMAIL`. Para que ese
> mail pueda salir, el `.env.prod` de esa PC tiene que tener cargados `MAIL_USUARIO`
> y `MAIL_PASSWORD`.

### C) Forzar la carpeta de destino (y el resto de las variables)

Todas estas variables son **opcionales**: sin tocar nada el respaldo funciona. Van en
el **`.env.prod` de esa PC**, que es el lugar natural para algo que cambia por
máquina: está fuera del repo, la actualización de las 13:00 no lo pisa y se edita sin
ser administrador. No hay que reiniciar nada: la próxima corrida las lee.

| Variable | Para qué |
|---|---|
| `RESPALDO_DESTINO_NUBE` | Carpeta a dónde copiar, cuando la detección automática no acierta (por ejemplo, una biblioteca de SharePoint sincronizada aparte). Se pega la ruta tal cual la muestra el Explorador, **sin comillas**. |
| `RESPALDO_RETENCION_NUBE` | Cuántas copias quedan en OneDrive (por defecto **7**). En la PC siguen 14. |
| `RESPALDO_SIN_CLAVE` | `true` = **no** subir la copia del `.env.prod` a la nube (ver el recuadro de abajo). |
| `RESPALDO_ALERTA_EMAIL` | A quién avisarle si falta el respaldo, en vez de la usuaria de la PC. |

Ejemplo de la primera (una sola línea, al final del `.env.prod`):

```ini
RESPALDO_DESTINO_NUBE=C:\Users\vanina\OneDrive - Goldstein Automotores\Respaldos Calidad
```

> Si en esta PC alguna vez se corrió el instalador viejo, quedó el archivo
> `scripts\windows\Respaldo-Config.json` y **eso manda** sobre lo detectado y sobre el
> `.env.prod`. Es la única razón para acordarse de que ese archivo existe: si el
> respaldo se empeña en ir a una carpeta rara, fijate ahí.

> ### 🔒 Importante — quién puede ver esa carpeta
> El respaldo tiene **datos reales de clientes** (nombres, teléfonos, patentes). En
> OneDrive / SharePoint, esa carpeta tiene que estar compartida **solo con quien lo
> necesite** (Sistemas + gerencia). Además, junto a los dumps se guarda una subcarpeta
> **`_RESTAURAR-NO-BORRAR`** con una copia del `.env.prod` (la clave que descifra el
> token de WhatsApp): esa subcarpeta es la más sensible, restringila especialmente.
> *(Si preferís no subir la clave a la nube y guardarla aparte, poné
> `RESPALDO_SIN_CLAVE=true` en el `.env.prod`: los datos igual se respaldan, pero al
> restaurar vas a tener que reponer el token de Meta a mano.)*

### D) Si esta PC se rompe: restaurar en una PC nueva

1. Instalá el sistema en la PC nueva (Pasos 0 a 6). La base arranca **vacía**.
2. Descargá de OneDrive el **último dump de CADA marca** y el archivo
   `_RESTAURAR-NO-BORRAR\env.prod.copia`. Hay un archivo por base, con la fecha
   en el nombre:
   - `calidad_ford_AAAA-MM-DD_hhmm.dump`
   - `calidad_vw_AAAA-MM-DD_hhmm.dump` *(solo si Volkswagen está en uso)*
3. Poné ese `env.prod.copia` como **`.env.prod`** en la carpeta del proyecto (así la
   clave de cifrado coincide y el token de WhatsApp sigue sirviendo).
4. Restaurá **cada base por separado** (PowerShell en la carpeta del proyecto).
   Ojo: la base destino se indica a mano y tiene que ser la MISMA de la que salió
   el dump — restaurar el de VW sobre la de Ford pisa los datos de Ford.
   ```powershell
   $c = (docker ps --filter "name=postgres" --format "{{.Names}}" | Select-Object -First 1)

   # --- Ford ---
   docker cp .\calidad_ford_XXXX.dump "${c}:/tmp/cal.dump"
   docker exec -e BASE=calidad_ford $c sh -c 'pg_restore -U "$POSTGRES_USER" -d "$BASE" --clean --if-exists /tmp/cal.dump'

   # --- Volkswagen (solo si corresponde) ---
   docker cp .\calidad_vw_XXXX.dump "${c}:/tmp/cal.dump"
   docker exec -e BASE=calidad_vw $c sh -c 'pg_restore -U "$POSTGRES_USER" -d "$BASE" --clean --if-exists /tmp/cal.dump'
   ```
5. Entrá a `http://localhost` (y a `http://localhost:8080` si usás Volkswagen) y
   verificá que estén los casos. Listo.

> **Cómo saber si el respaldo cubre TODAS las marcas:** la casilla del Dashboard dice
> cuántas bases entraron en la última copia. Con más detalle, en
> `Respaldos\ultimo-respaldo.json` la lista `"bases"` tiene que tener una entrada por
> cada marca en uso, y `"basesFallidas"` tiene que estar vacía. Si un día aparece una
> sola base, algo pasó con la otra.

> **`Instalar-Respaldo-Diario.ps1` sigue existiendo, pero ya NO es el camino
> normal.** Lo que hacía era registrar la tarea programada, que es justo el paso que
> nadie corrió nunca. Queda para casos especiales (por ejemplo fijar otra hora o un
> destino de red UNC). Si se corre desde un PowerShell **elevado**, hay que pasarle
> `-Usuario <cuenta de la persona>`: si no, la tarea queda a nombre del administrador
> y ese proceso no llega a Docker.

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

## Que el sistema se actualice solo (recomendado)

Sin esto, alguien tiene que acordarse de correr `Actualizar-AHORA.bat` cada vez
que hay una versión nueva. No funciona: la PC de Ford estuvo **21 versiones
atrasada durante una semana**, y nos enteramos porque un arreglo que ya estaba
hecho no aparecía.

Se instala **una sola vez por PC**: entrá a la carpeta `scripts\windows` y hacé
**doble clic** en **`Instalar-Actualizacion-Automatica.bat`**. Windows va a pedir
permiso de administrador (es para registrar la tarea): dale que sí.

*(Si preferís por consola: `powershell -ExecutionPolicy Bypass -File Instalar-Actualizacion-Automatica.ps1`, con PowerShell abierto como administrador.)*

Desde ahí, todos los días a las **13:00** (hora del almuerzo) la PC mira si hay
algo nuevo en GitHub. Si no hay (que es casi siempre), **no toca nada**. Si hay,
actualiza: son un par de minutos sin sistema mientras se reinician los
contenedores y se aplican las migraciones.

> **¿Por qué al mediodía y no de madrugada?** Porque **la PC se apaga a la noche**.
> Una tarea de las 4 AM no correría nunca, o correría recién al prender la
> máquina a las 8 y media, justo con la agencia abriendo. Al mediodía la PC
> seguro está prendida y los usuarios seguro no están.

**Si la PC estuvo apagada al mediodía**, la tarea corre cuando se prende — pero
**solo si no pasó mucho**. Si ya son más de las 16:00, no actualiza: espera al día
siguiente. Así nunca reinicia el sistema en pleno horario de trabajo. No se
pierde nada, la versión nueva sigue esperándolo en GitHub.

> **A esa hora se están mandando WhatsApp** (la ventana va de 9 a 19), así que el
> backend hace un **apagado ordenado**: termina el mensaje que tenga entre manos
> antes de cerrar, en vez de morir a la mitad y reintentarlo (lo que le mandaría
> el WhatsApp dos veces al cliente). Y lo que quede en la cola sobrevive al
> reinicio, porque Redis guarda en disco.

**Si la versión nueva arranca rota, vuelve sola a la anterior.** Antes de
construir se anota qué imágenes estaban andando; si después de 5 minutos el
sistema no responde, las vuelve a poner y levanta la versión de antes.

Todo queda escrito con fecha y hora en:

```
scripts\windows\actualizacion-automatica.log
```

Para cambiar la hora, o para desactivarla:

```powershell
powershell -ExecutionPolicy Bypass -File Instalar-Actualizacion-Automatica.ps1 -Hora 05:30
powershell -ExecutionPolicy Bypass -File Instalar-Actualizacion-Automatica.ps1 -Quitar
```

> **Un límite que conviene saber:** la vuelta atrás devuelve el **código**, no la
> **base de datos**. Si la versión nueva alcanzó a aplicar una migración antes de
> romperse, esa migración queda aplicada. En la práctica no molesta (las
> migraciones agregan columnas y el código viejo las ignora), pero si alguna vez
> el log dice que volvió atrás, **avisale a Ignacio** antes de seguir trabajando.

**`Actualizar-AHORA.bat` sigue existiendo** y se puede usar cuando haga falta una
actualización en el momento, sin esperar a la madrugada.

---

## Si el arranque automático no se puede instalar

En algunas PCs de empresa **no se puede usar ninguno de los mecanismos de arranque
de Windows**. En la de Volkswagen se probó uno por uno:

| Mecanismo | Resultado |
|---|---|
| Tareas programadas por PowerShell | WMI roto: `CimJob_BrokenCimSession` |
| `schtasks /create /XML` | Acceso denegado |
| `schtasks` con `/SC ONLOGON` | Acceso denegado |
| El usuario común creando tareas | Acceso denegado (no es administrador) |
| Acceso directo en la carpeta de Inicio | El antivirus lo borra |

Lo que **sí** funciona ahí es el bucle: un proceso que corre en la sesión de la
persona y llama al vigilante cada 5 minutos.

```
scripts\windows\Instalar-Arranque-Sin-Tareas.bat
```

Deja el arranque por **dos caminos a la vez** (acceso directo y clave `Run` del
registro) y avisa cuál sobrevivió al antivirus.

**Para arrancarlo sin reiniciar:**

```powershell
Start-Process powershell -ArgumentList "-NoProfile","-NonInteractive","-WindowStyle","Hidden","-ExecutionPolicy","Bypass","-File","C:\Calidad\Volkswagen\scripts\windows\vigilante-bucle.ps1" -WindowStyle Hidden
```

**Para cerrar el que esté corriendo** (hace falta antes de arrancar uno nuevo: el
bucle no deja que haya dos):

```powershell
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like "*vigilante-bucle*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

**Para ver qué está haciendo:** `scripts\windows\vigilante-bucle.log`

Ahí va enganchada también la actualización automática (13:00), que en esas PCs
tampoco se puede instalar como tarea. El **respaldo diario (12:00)** ya no cuelga
del bucle: lo dispara el vigilante (ver el Paso 7), así que corre igual en las dos
PCs, con bucle o con tarea.

**Si nada de esto sobrevive**, queda el botón manual:
`scripts\windows\Crear-Boton-Escritorio.ps1` deja en el escritorio un acceso
directo "Iniciar Sistema de Calidad". Doble clic y arranca todo.

---

## Cómo entra el resto del equipo

La PC de Vanina es el "servidor": mientras esté **prendida y andando**, los demás
entran desde **su propio dispositivo** (PC, notebook o celular), cada uno con **su
propio usuario**.

- **Desde cualquier lado (por internet):**
  `https://dealer-occupant-brigade.ngrok-free.dev`
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
| **PC de Ford: localhost anda pero el link de afuera no** | Doble clic en `scripts\windows\Arreglar-Arranque-Ford.bat` (con la sesión de Yesica, **sin** administrador). Si queda en rojo, `Diagnosticar-Ngrok-Ford.bat`: frena ngrok, lo corre con registro y anota el error exacto (token, versión, cuenta). Los dos dejan un informe en el Escritorio para mandar; el token de ngrok sale tapado. En la PC de Volkswagen no corren. |
| **El sistema no arranca solo al prender la PC** | Doble clic en `scripts\windows\Diagnostico-Arranque.bat` (con la sesión de siempre, **sin** administrador). No toca nada: deja en el Escritorio `diagnostico-arranque-<PC>.txt` con el estado de las tareas programadas, el vigilante, Docker, los contenedores, la actualización y el túnel, y termina con un resumen de qué está bien y qué no. Ese archivo es el que hay que mandar. |
| **El Dashboard muestra en rojo "Copia diaria a OneDrive"** | Ver el Paso 7 (B). Casi siempre es OneDrive sin la sesión iniciada, o la PC apagada del mediodía a las 19:00. |
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
| `vigilante.ps1` | Cada 5 minutos (lo registra el instalador) | Detecta y repara: Docker caído, contenedores caídos, API sin responder, ngrok caído. Y dispara el **respaldo diario** del mediodía (Paso 7). |
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
5. **Respaldo diario**: entre las **12:00 y las 19:00**, si el del día todavía no
   salió bien, corre `Respaldo-Calidad.ps1` (Paso 7). Y después de las 19:00, si
   hace más de 72 h que no hay un respaldo bueno, manda **un** correo de aviso.
   Todo eso va en su propio try/catch: un problema del respaldo no puede dejar de
   vigilar el sistema.
6. **Log**: `scripts/windows/vigilante.log`. Es silencioso: si todo está bien
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

- URL: `https://dealer-occupant-brigade.ngrok-free.dev/api/webhooks/whatsapp`
- Verify token: `calidad-ford-2026-xK9m`
- Suscrito a: `messages`, `message_template_status_update`, `phone_number_quality_update`

No hay que reconfigurarlo al mover la PC: mientras ngrok levante el **mismo
dominio** con el **mismo token**, Meta sigue llegando igual.
