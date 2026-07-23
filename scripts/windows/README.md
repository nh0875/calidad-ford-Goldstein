# Arranque automático y resiliencia en Windows

Dos piezas, pensadas para que el sistema corra **desatendido** en la PC de la usuaria:

| Script | Cuándo corre | Para qué |
|---|---|---|
| `iniciar-sistema.bat` | Al **iniciar Windows** | Levanta el stack de producción + ngrok |
| `vigilante.ps1` | **Cada 5 minutos** | Detecta y repara: Docker caído, contenedores caídos, API sin responder, ngrok caído |

> Con el vigilante registrado, el `.bat` de arranque pasa a ser opcional: el vigilante levanta todo igual en su primera corrida. Conviene tener los dos (arranque rápido al prender + reparación continua).

---

## 1. Antes de usarlo

- **Docker Desktop**: que **inicie con Windows** (Settings → General → "Start Docker Desktop when you sign in").
- **ngrok**: instalado, autenticado (`ngrok config add-authtoken <token>`) y con el **dominio estático** reservado (el mismo del webhook de Meta).
  Para saber la ruta real del ejecutable: en PowerShell, `(Get-Command ngrok).Source`.
- **Editar la configuración de los scripts** (bloque del principio de cada archivo): carpeta del proyecto, ruta de ngrok, dominio y puerto.
- **Límites de WSL2**: ver la sección 4. **Es lo que evita que Docker se caiga.**

---

## 2. Registrar el vigilante (cada 5 minutos)

### Opción rápida (PowerShell como administrador)

```powershell
$ruta = "C:\Users\hilli\Downloads\Goldstein\Vanina\scripts\windows\vigilante.ps1"
$accion  = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ruta`""
$disparo = New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Minutes 5)
$opts    = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName "Sistema de Calidad - Vigilante" `
  -Action $accion -Trigger $disparo -Settings $opts -RunLevel Highest -Force
```

### Opción por interfaz (Programador de tareas)

1. **Programador de tareas** → **Crear tarea…** (no "tarea básica").
2. **General**: nombre `Sistema de Calidad - Vigilante`; marcar **"Ejecutar con los privilegios más altos"**; dejar **"Ejecutar sólo cuando el usuario haya iniciado sesión"** (ver la nota de abajo).
3. **Desencadenadores** → Nuevo → "Al iniciar sesión" (o "Al iniciar el sistema"), y tildar **"Repetir la tarea cada: 5 minutos"** con duración **"Indefinidamente"**.
4. **Acciones** → Nueva → "Iniciar un programa":
   - Programa/script: `powershell.exe`
   - Argumentos: `-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\...\scripts\windows\vigilante.ps1"`
5. **Condiciones**: destildar "Iniciar la tarea solo si el equipo está conectado a la corriente".
6. **Configuración**: "Si la tarea ya se está ejecutando: **No iniciar una nueva instancia**".

### ⚠️ Nota importante: sesión de usuario

Docker Desktop es una aplicación **de escritorio**: necesita una sesión de usuario iniciada. Por eso la tarea debe correr **como la usuaria** y con **"sólo cuando el usuario haya iniciado sesión"**. Si la PC se reinicia sola (corte de luz, actualización de Windows) y queda en la pantalla de login, **nada arranca**.

**Solución recomendada**: configurar el **inicio de sesión automático** de Windows en esa PC (`netplwiz` → destildar "Los usuarios deben escribir su nombre y contraseña"), y bloquear la pantalla si hace falta privacidad. Así, tras cualquier reinicio, la sesión existe y el vigilante hace el resto.

---

## 3. Qué hace el vigilante (y qué deja en el log)

En cada corrida, en orden:

1. **Docker Desktop**: si el engine no responde, lo inicia y espera. Si la app está abierta pero el engine quedó colgado, la cierra y la vuelve a abrir.
2. **Contenedores**: si falta alguno de los 5 (`postgres`, `redis`, `backend`, `web`, `backup`), levanta el stack de producción.
3. **API**: llama de verdad a `http://localhost/api/health`. Si no responde, **distingue la causa**:
   - el backend responde *dentro* de Docker pero no desde afuera → la publicación del puerto quedó rota (pasa tras reiniciar WSL) → reinicia `web`;
   - el backend no responde ni por dentro → reinicia `backend`;
   - si aun así falla → reinicia el stack completo.
   Nunca reinicia un backend que todavía está arrancando (mira el healthcheck del contenedor).
4. **ngrok**: si el proceso no está, o está pero sin el túnel del dominio, lo relanza.
5. **Log**: `scripts/windows/vigilante.log`, con fecha y hora. Rota solo al superar 2 MB (guarda una generación en `.log.1`).

**Es silencioso e idempotente**: si todo está bien no abre ninguna ventana, no pide nada y escribe **una sola línea `[OK]` por día**. Sólo escribe cuando hace algo o cuando falla.

Ejemplo de log real de una recuperación:

```
2026-07-23 11:28:59  [ACCION]  El backend responde dentro de Docker pero no desde afuera
                               (publicacion del puerto rota): reiniciando 'web'.
2026-07-23 11:29:15  [ACCION]  El sistema volvio a responder OK.
2026-07-23 11:29:15  [ACCION]  ngrok no estaba corriendo: relanzandolo.
2026-07-23 11:29:30  [ACCION]  Tunel de ngrok activo en https://antitrust-trace-unloader.ngrok-free.dev
```

---

## 4. Límites de memoria de WSL2 (la causa de los cuelgues)

Docker en Windows corre adentro de **WSL2**, que **por defecto toma hasta el 50 % de la RAM y no la devuelve**. En una PC con poca memoria eso deja a Windows sin aire y **Docker Desktop se cae**.

La solución es el archivo **`C:\Users\<usuaria>\.wslconfig`** (ya creado en esta máquina):

```ini
[wsl2]
memory=2GB
processors=4
swap=4GB

[experimental]
autoMemoryReclaim=gradual
sparseVhd=true
```

**Valores recomendados según la RAM de la PC** (el stack completo usa ~100 MB en reposo y ~1 GB con carga real):

| RAM de la PC | `memory` | `processors` | `swap` | Comentario |
|---|---|---|---|---|
| 6 GB | `2GB` | 4 | `4GB` | Mínimo viable (es el caso de esta PC) |
| 8 GB | `3GB` | 4 | `4GB` | Cómodo |
| 16 GB | `6GB` | 6 | `4GB` | Holgado |
| 32 GB o más | `8GB` | 8 | `8GB` | De sobra; no hace falta dar más |

Regla práctica: **dejarle a Windows al menos 3 GB libres**. Poner un número *mayor* al 50 % no sirve de nada (ya era el default); lo que resuelve es **bajarlo**.

Para aplicar los cambios: `wsl --shutdown` (o reiniciar la PC). Para verificar cuánto quedó:

```powershell
wsl -d docker-desktop -- free -m
```

Además, cada contenedor tiene su propio tope en `docker-compose.prod.yml` (`mem_limit`), de modo que un proceso desbocado no puede tumbar la VM entera:
`postgres 448m + redis 128m + backend 640m + web 128m + backup 160m = 1504m`, que entra en los 2 GB con aire para el daemon.

---

## 5. Arranque al prender la PC (`iniciar-sistema.bat`)

1. **Programador de tareas** → **Crear tarea…**
2. **General**: nombre `Sistema de Calidad - Arranque`; **privilegios más altos**.
3. **Desencadenadores**: "Al iniciar sesión".
4. **Acciones**: iniciar `...\scripts\windows\iniciar-sistema.bat`.
5. **Condiciones**: destildar lo de la corriente.

---

## 6. Probarlo

```powershell
# Correr el vigilante a mano una vez (no debería hacer nada si todo está bien)
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\vigilante.ps1
Get-Content .\scripts\windows\vigilante.log -Tail 10

# Simular una caída y ver cómo se recupera solo
docker stop vanina-web-1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\vigilante.ps1
```

Después reiniciar la máquina y confirmar que todo vuelve solo.

## Notas

- El vigilante **no frena nada**: sólo levanta y repara. Para frenar todo a mano:
  `docker compose -f docker-compose.prod.yml --env-file .env.prod down` y cerrar ngrok.
- Si el log muestra repetidamente `[ERROR] ... Requiere revision manual`, hay un problema de fondo (disco lleno, credenciales, imagen rota): revisar `docker compose -f docker-compose.prod.yml --env-file .env.prod logs`.
