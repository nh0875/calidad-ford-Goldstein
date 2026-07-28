# Instalación en la PC de Vanina — paso a paso

> Seguí estos pasos **una sola vez**. Después, cada vez que Vanina **inicie sesión en
> Windows** el sistema levanta solo (en 1-2 minutos) y se mantiene y repara solo
> mientras la PC está prendida. **Vanina no tiene que abrir ni configurar nada del
> sistema.**

## Datos que vas a necesitar (ya están, no hay que buscarlos)

| Qué | Valor |
|---|---|
| Usuario del sistema | `admin@goldstein.com.ar` |
| Contraseña | `UqWuQnF5Zwf92bDT#4` |
| Dirección del sistema (en la PC) | http://localhost |
| Dirección pública (webhook de Meta) | https://antitrust-trace-unloader.ngrok-free.dev |
| Token de ngrok | `3GrusSzHu6fedxjLuO6pjn5wzmk_5qcrdEYnULg5GN7VKwodd` |
| Verify token del webhook | `calidad-ford-2026-xK9m` |

---

## Paso 1 — Copiar la carpeta

Copiá **toda** la carpeta `Vanina` a la PC de Vanina, a donde quieras (por ejemplo
`C:\Calidad\Vanina`). Los scripts detectan solos dónde quedó, no hay que editar rutas.

- ✅ Tiene que ir el archivo **`.env.prod`** (viene adentro de la carpeta; ahí están
  las claves de Meta, Gemini y el sistema).
- Si están, podés **borrar antes** de copiar `node_modules` y `.git`: no hacen falta
  y pesan mucho.

## Paso 2 — Instalar Docker y ngrok

1. Instalá **Docker Desktop** (https://www.docker.com/products/docker-desktop/) y
   abrilo una vez para que termine de instalarse.
2. Instalá **ngrok**. En PowerShell:
   ```powershell
   winget install Ngrok.Ngrok
   ```
3. Pegá el token de ngrok (una sola vez):
   ```powershell
   ngrok config add-authtoken 3GrusSzHu6fedxjLuO6pjn5wzmk_5qcrdEYnULg5GN7VKwodd
   ```
   > Importante: este token es de la cuenta dueña del dominio
   > `antitrust-trace-unloader.ngrok-free.dev`. **Tiene que ser ese token**, si no,
   > no llegan los WhatsApp.

## Paso 3 — Evitar que Docker se cuelgue (PC con poca memoria)

Creá el archivo **`C:\Users\<usuario-de-la-PC>\.wslconfig`** con este contenido
(hay una copia lista para copiar en `scripts\windows\wslconfig-8gb.txt`):

```ini
[wsl2]
memory=2GB
processors=4
swap=4GB

[experimental]
autoMemoryReclaim=gradual
sparseVhd=true
```

Después, en PowerShell: `wsl --shutdown` (o reiniciá la PC). Esto es lo que evita que
Docker se caiga en una PC con poca RAM. *(Si la PC tiene más memoria, ver la tabla en
la sección de referencia más abajo.)*

## Paso 4 — Correr el instalador (un solo comando)

Abrí **PowerShell como administrador** (clic derecho → "Ejecutar como administrador"),
entrá a la carpeta y corré:

```powershell
cd C:\Calidad\Vanina
powershell -ExecutionPolicy Bypass -File .\scripts\windows\configurar-pc.ps1
```

Esto deja **todo listo en un paso**: levanta el sistema (la **primera vez tarda unos
minutos** armando todo), lo configura para arrancar solo al prender la PC, y registra
el "vigilante" que lo revisa y repara cada 5 minutos. Al final muestra un checklist con
lo que quedó **OK** o lo que **falta**.

## Paso 5 — Cómo arranca (no hay que hacer nada más)

Por seguridad, esta PC **no** usa inicio de sesión automático: pide la contraseña de
Windows como siempre. El sistema levanta solo **cuando Vanina inicia sesión** en
Windows (el vigilante corre "al iniciar sesión" y cada 5 minutos). En 1-2 minutos
queda todo arriba, sin abrir nada.

**Qué pasa si la PC se reinicia sola** (corte de luz, actualización de Windows de
noche): queda esperando en la pantalla de contraseña de Windows. En cuanto **Vanina
inicie sesión** (a la mañana, como siempre), el sistema vuelve solo. Mientras la PC
está en uso, el vigilante lo mantiene arriba.

> Si en el futuro preferís que arranque **incluso sin que nadie inicie sesión**, se
> puede activar el inicio automático de Windows (`netplwiz`), idealmente con bloqueo de
> pantalla. Es más cómodo pero menos seguro (cualquiera que prenda la PC entra a la
> sesión de Vanina). Con la opción actual no hace falta.

---

## ¿Quedó bien?

- El checklist del instalador dice **`TODO CUBIERTO`**.
- Abrí el navegador en **http://localhost** e iniciá sesión con el usuario y la
  contraseña de la tabla de arriba.

Si algo falta, el instalador lo marca en rojo. Podés volver a correrlo cuando quieras
para verificar (sin cambiar nada):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\configurar-pc.ps1 -SoloVerificar
```

**Listo.** Cada mañana, cuando Vanina inicie sesión en Windows, el sistema levanta solo
en 1-2 minutos y se mantiene arriba durante el día. No tiene que abrir ni configurar
nada.

---
---

# Referencia técnica (no hace falta para instalar)

Tres piezas hacen que el sistema corra **desatendido**:

| Script | Cuándo corre | Para qué |
|---|---|---|
| `configurar-pc.ps1` | **Una vez, al instalar** (como admin) | Deja todo listo y verificado en un paso. Imprime un checklist. |
| `vigilante.ps1` | **Cada 5 minutos** (lo registra el instalador) | Detecta y repara: Docker caído, contenedores caídos, API sin responder, ngrok caído. |
| `iniciar-sistema.bat` | Al iniciar Windows (opcional) | Levanta el stack + ngrok. Con el vigilante registrado es opcional. |

Los tres **detectan solos** dónde está la carpeta del proyecto, así que la carpeta se
puede copiar a cualquier ruta sin editar nada.

## Qué hace el vigilante en cada corrida

1. **Docker Desktop**: si el engine no responde, lo inicia y espera. Si la app está
   abierta pero colgada, la cierra y la vuelve a abrir.
2. **Contenedores**: si falta alguno de los 5 (`postgres`, `redis`, `backend`, `web`,
   `backup`), levanta el stack de producción.
3. **API**: llama de verdad a `http://localhost/api/health`. Si no responde, distingue
   la causa (puerto roto tras reiniciar WSL → reinicia `web`; backend caído → reinicia
   `backend`; si aun así falla → reinicia todo). Nunca reinicia un backend que todavía
   está arrancando.
4. **ngrok**: si el proceso no está, o está pero sin el túnel del dominio, lo relanza.
5. **Log**: `scripts/windows/vigilante.log`. Es silencioso: si todo está bien escribe
   **una sola línea `[OK]` por día**; sólo escribe cuando repara algo o cuando falla.

Ejemplo de log de una recuperación real:

```
2026-07-23 11:28:59  [ACCION]  El backend responde dentro de Docker pero no desde afuera
                               (publicacion del puerto rota): reiniciando 'web'.
2026-07-23 11:29:15  [ACCION]  El sistema volvio a responder OK.
2026-07-23 11:29:30  [ACCION]  Tunel de ngrok activo en https://antitrust-trace-unloader.ngrok-free.dev
```

## Memoria de WSL2 según la RAM de la PC

Docker en Windows corre dentro de **WSL2**, que por defecto toma hasta el 50 % de la RAM
y no la devuelve. En una PC con poca memoria eso tumba Docker. El `.wslconfig` (Paso 3)
lo limita. Valores según la RAM (el sistema usa ~100 MB en reposo y ~1 GB con carga):

| RAM de la PC | `memory` | `processors` | `swap` |
|---|---|---|---|
| 6 GB | `2GB` | 4 | `4GB` |
| 8 GB | `3GB` | 4 | `4GB` |
| 16 GB | `6GB` | 6 | `4GB` |
| 32 GB o más | `8GB` | 8 | `8GB` |

Regla: **dejarle a Windows al menos 3 GB libres**. Verificar cuánto quedó:
`wsl -d docker-desktop -- free -m`.

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

## El webhook de Meta (ya configurado, sólo como referencia)

- URL: `https://antitrust-trace-unloader.ngrok-free.dev/api/webhooks/whatsapp`
- Verify token: `calidad-ford-2026-xK9m`
- Suscrito a: `messages`, `message_template_status_update`, `phone_number_quality_update`

No hay que reconfigurarlo al mover la PC: mientras ngrok levante el **mismo dominio** con
el **mismo token**, Meta sigue llegando igual.
