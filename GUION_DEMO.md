# Guion de la demo en vivo

Hay **dos variantes**. Elegí la que corresponda:

- **[Variante A — WhatsApp real, sin plantilla](#variante-a)** ← *la de hoy*. Tu jefe le escribe desde su celular al número del negocio y el sistema le responde de verdad. No necesita que Meta apruebe la plantilla.
- **[Variante B — todo simulado (modo demostración)](#variante-b)**: no se manda nada a ningún teléfono; los mensajes se simulan desde el sistema.

---

<a id="variante-a"></a>

# VARIANTE A — Demo en vivo con WhatsApp real (sin plantilla)

**La idea en una frase**: la plantilla de Meta solo hace falta para el mensaje que **inicia** la empresa. Si el **cliente escribe primero**, se abre una ventana de 24 horas en la que el sistema puede responder libremente. Por eso tu jefe escribe desde su celular y ahí arranca todo.

## 🔒 Antes que nada: no se puede escapar ningún mensaje

Vas a tener casos reales cargados (ver más abajo). **Ninguno puede recibir un WhatsApp durante la demo**, por dos candados independientes:

1. **Solo un botón envía**: los mensajes a clientes salen únicamente si alguien aprieta *"Enviar WhatsApp…"* en la pantalla de Casos **y** confirma el cartel. Ni la carga del Excel ni ningún proceso automático mandan nada. **En este guion no hay ningún paso que toque esos botones.**
2. **Candado de seguridad activo**: el tope diario de envíos está puesto en **0**. Aunque alguien apretara el botón por error, **no sale ni un mensaje**. El sistema los deja esperando y listo.

> El mensaje de respuesta a tu jefe **no se ve afectado** por ese candado: es una respuesta conversacional, no una campaña.

---

## ANTES DE LA REUNIÓN (30-60 minutos antes, nunca en vivo)

### 1. Cargar el Excel real para que se vea con volumen

**Cuándo**: antes de la reunión, con tiempo. **Nunca en vivo**: la carga tiene una pantalla intermedia donde hay que confirmar qué columna es cada cosa, y tarda unos minutos. No es algo para hacer con tu jefe mirando.

**Cuántos meses**: **cargá todos los meses que tengas** (el Excel real tiene una hoja por mes). Motivos:
- El tablero muestra los casos **por fecha de carga**, así que aunque sean de meses distintos, **todos aparecen** en la vista por defecto.
- Los rankings por asesor y por sucursal **necesitan al menos 5 casos** por persona para mostrarse. Con un solo mes puede que queden vacíos.
- El semáforo (verde/amarillo/rojo) sale de los casos históricos ya resueltos: con más meses, los números se ven sólidos en vez de anecdóticos.

**Cómo**: `Cargar Excel` → *Contacto Posventa* → elegir el archivo → indicar sucursal y año → tildar **todas las hojas (meses)** → revisar el mapeo de columnas → Confirmar.

**Verificá que salió bien**: en `Casos` tiene que aparecer el total cargado; en `Tablero` los números deben dejar de estar en cero.

### 2. Chequeo rápido del sistema (2 minutos)

- Abrí **http://localhost** y confirmá que entrás con tu usuario.
- El caso de tu jefe ya está creado (orden **DEMO-JEFE-001**). Buscalo en `Casos` para tenerlo ubicado.
- Tené el navegador con **dos pestañas abiertas**: una en `Casos` y otra en `Tablero`. Vas a ir saltando entre ellas.

### 3. Acortar la espera de la clasificación (importante para la demo en vivo)

El sistema **espera a que el cliente termine de escribir** antes de clasificar: cada mensaje nuevo reinicia una cuenta de 90 segundos, y recién ahí analiza toda la respuesta junta. Eso es lo correcto en la operación real (un cliente que manda tres mensajes cuenta como una sola respuesta, no como tres), pero en vivo son 90 segundos de silencio incómodo.

Para la demo, bajalo a 15 segundos: en `.env.prod` poné `DELAY_ANALISIS_MS=15000` y aplicá el cambio con

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d backend
```

**Terminada la demo, volvé a dejarlo en `90000`** y aplicá el cambio de nuevo. Si lo dejás en 15 segundos, un cliente que escribe despacio se clasifica en pedazos.

> Este es el mismo tipo de ajuste que `DELAY_AGRADECIMIENTO_MS`: los dos vuelven a su valor normal en el checklist de cierre.

---

## DURANTE LA DEMO

### Paso 1 — Arrancá mostrando el volumen (1 min)

Abrí **`Tablero`**.

> *"Esto es lo que el área maneja hoy: cada caso es un cliente que pasó por el taller y al que hay que hacerle seguimiento. Hasta ahora esto se llevaba en planillas."*

Mostrá los números de arriba: casos del período, tasa de respuesta, y el semáforo verde/amarillo/rojo.

> *"El semáforo lo pone la inteligencia artificial leyendo lo que responde el cliente. Ahora lo vas a ver funcionando en vivo."*

### Paso 2 — Que tu jefe escriba desde su celular (30 seg)

Pedile que le mande un WhatsApp al número del negocio. Algo positivo, por ejemplo:

> *"Hola, muy conforme con la atención. El auto quedó impecable y me lo entregaron antes de lo prometido. Gracias!"*

> *"Fijate que le estás escribiendo vos al número de la concesionaria, como lo haría cualquier cliente. A partir de acá no toco nada: mirá lo que hace el sistema solo."*

### Paso 3 — Mostrá que el mensaje llegó (30 seg)

Andá a **`Casos`** y **recargá la página** (F5). Buscá el caso **DEMO-JEFE-001**.

**Qué mostrar**: la columna **Estado** pasó de "Enviado" a **"Respondido"**.

> *"El mensaje entró solo. Nadie lo copió ni lo cargó a mano."*

### Paso 4 — La clasificación de la IA (1 min)

En esa misma fila, mirá la columna **Semáforo**: apareció un **punto verde**.

Pasá el mouse por encima para ver el resumen que escribió la IA.

> *"La inteligencia artificial leyó el mensaje, entendió que es un cliente satisfecho y lo marcó en verde. También le puso una categoría y un nivel de gravedad. Esto antes lo hacía una persona leyendo mensaje por mensaje."*

### Paso 5 — La respuesta automática (esperá ~20 segundos)

Pedile a tu jefe que mire el celular.

> *"El sistema le está por responder solo. No lo hace al instante a propósito: espera un momento para que no se sienta un robot."*

A los ~20 segundos le llega un mensaje agradeciéndole **por su nombre** y recordándole que va a recibir la **encuesta oficial de Ford** en su casilla de mail.

> *"Le contestó por su nombre y le recordó la encuesta de Ford, que es justamente lo que la marca nos mide. Ese recordatorio es el que sube la tasa de respuesta de la encuesta."*

### Paso 6 — El momento fuerte: un cliente enojado (2 min)

Pedile que mande **un segundo mensaje**, ahora quejándose:

> *"La verdad muy mal, me prometieron el auto para el martes y lo entregaron el viernes. Nadie me avisó nada, tuve que llamar yo tres veces."*

Esperá unos segundos y **recargá `Casos`**: el semáforo del caso pasó a **rojo**.

Ahora andá a **`RQR`**:

**Qué mostrar**: apareció un reclamo formal **nuevo**, con número (por ejemplo `RQR-2026-0001`), generado **solo**.

Entrá al RQR y mostrá que ya viene **pre-completado**: la descripción del reclamo, la causa raíz que detectó la IA (demora en el servicio), y el texto original del cliente.

> *"Esto es lo que más tiempo les come hoy: detectar al cliente molesto y armarle el formulario de reclamo. El sistema lo hizo solo, en segundos, y lo dejó listo para que Calidad solo lo gestione. Y fijate que además puede exportarse a Word con el formato que ya usan."*

Y mostrale el celular de tu jefe: le llegó una **respuesta distinta**, empática, avisándole que un responsable se va a comunicar. **Sin** recordarle la encuesta.

> *"A un cliente enojado no le vas a pedir que conteste una encuesta. El sistema distingue el tono y le responde distinto."*

### Paso 7 — Cerrá con el tablero (1 min)

Volvé a **`Tablero`** y recargá.

**Qué mostrar**: el rojo nuevo ya se refleja en el semáforo, y el reclamo abierto aparece en la lista de RQR pendientes con su antigüedad.

> *"Todo lo que viste queda medido acá: cuántos clientes contestan, qué proporción está conforme, cuáles son los motivos de queja más frecuentes y cuánto tardamos en cerrar cada reclamo. Eso hoy no existe."*

---

## ⛔ Lo que NO hay que tocar durante la demo

- Los botones **"Enviar WhatsApp a seleccionados"** y **"Enviar a todos los pendientes del filtro actual"** en la pantalla de Casos.
- La pantalla **Cargar Excel** (eso ya se hizo antes).

> Si igual se apretara por accidente: el candado del tope en 0 impide que salga cualquier mensaje. Después de la demo hay que vaciar esa cola (está en las instrucciones de limpieza).

## Si algo no pasa en el momento

| Qué pasa | Qué hacer (sin que se note) |
|---|---|
| El estado no cambia a "Respondido" | Recargá con F5. Puede tardar unos segundos. |
| El semáforo tarda | La IA tarda unos segundos en leer. Seguí hablando del tablero y volvé. |
| No llega la respuesta al celular | Seguí con el RQR en pantalla; el mensaje suele llegar mientras hablás. |
| Nada se mueve | *"Se está sincronizando"*, seguí con el tablero y los reportes, que no dependen del mensaje. |

## Frase de cierre sugerida

> *"Hoy esto son planillas y trabajo manual: alguien manda los mensajes uno por uno, los lee, decide si hay que abrir un reclamo y lo escribe. Lo que viste lo hace el sistema solo, deja todo registrado y medido, y avisa cuando hay un cliente que hay que atender ya."*

---
---

<a id="variante-b"></a>

# VARIANTE B — Demo simulada (modo demostración)

Un guion para seguir **mirando la pantalla mientras hablás**. Cada paso dice qué clickear y qué mostrar. El foco: enviar un WhatsApp → simular la respuesta del cliente → mostrar cómo la IA (Gemini) la clasifica sola → mostrar el reclamo (RQR) que se genera solo → mostrar el tablero actualizado.

> Arriba a la derecha vas a ver una etiqueta **"Modo demostración"**. Significa que los WhatsApp están **simulados** (no se manda nada a ningún teléfono real), pero **el análisis de la IA es real**. Si tu jefe pregunta: "los mensajes están simulados para la demo, pero la inteligencia artificial que los clasifica es la de verdad".

---

## Antes de empezar (una sola vez, 5 minutos)

Que quede listo **antes** de que entre tu jefe:

1. Tener el sistema abierto en el navegador en **http://localhost** y con la sesión iniciada.
2. Ver que en **Casos** ya aparezcan los casos de ejemplo (los que tienen orden `DEMO-1001`, `DEMO-1002`, …).
3. Tener pensados dos mensajes para escribir en vivo (los de abajo ya sirven).

> Si no ves los casos de ejemplo, avisá a quien preparó el sistema para correr el "seed de demo". No es algo que se haga durante la reunión.

---

## Paso 1 — Mostrar los casos

1. En el menú de la izquierda, clic en **Casos**.
2. Comentá: *"Acá está cada cliente que pasó por el taller. La idea es contactarlos por WhatsApp después del servicio para saber cómo les fue."*
3. Señalá la columna **Estado**: hay casos **Pendiente** (todavía sin contactar), **Enviado**, **Respondido**, etc.

---

## Paso 2 — Enviar el WhatsApp (simulado)

1. Buscá un caso en estado **Pendiente** (por ejemplo **Javier Torres — DEMO-1004**).
2. Marcá el casillero a la izquierda de ese caso.
3. Clic en el botón azul **"Enviar WhatsApp a seleccionados"**.
4. Se abre una ventana de confirmación → clic en **"Enviar"**.
5. Comentá: *"El sistema le manda el mensaje de contacto. En la demo está simulado, pero el flujo es idéntico al real."*
6. En unos segundos el caso pasa a estado **Enviado**. (Si no cambia solo, apretá F5.)

---

## Paso 3 — Simular una respuesta POSITIVA del cliente

1. Buscá un caso en estado **Enviado** (por ejemplo **Lucía Fernández — DEMO-1001**).
2. En la columna **Acciones**, clic en **"Simular respuesta"**.
3. En el cuadro de texto, escribí algo positivo, por ejemplo:
   > **todo excelente, el auto quedó perfecto y me atendieron muy bien**
4. Clic en **"Enviar"**.
5. Comentá: *"Esto simula que el cliente respondió por WhatsApp. Ahora la inteligencia artificial lee la respuesta y la clasifica sola."*
6. Esperá unos segundos y apretá **F5**. El caso pasa a **Respondido** y le aparece un **semáforo VERDE** 🟢.
7. Rematá: *"La IA entendió que es un cliente conforme. No hay nada que reclamar, así que no genera ningún trámite."*

---

## Paso 4 — Simular una respuesta NEGATIVA (¡el momento fuerte!)

1. Buscá otro caso en estado **Enviado** (por ejemplo **Martín Gómez — DEMO-1002**).
2. Clic en **"Simular respuesta"**.
3. Escribí un mensaje claramente negativo, por ejemplo:
   > **pésima atención, tardaron el triple de lo prometido y nadie me avisó nada**
4. Clic en **"Enviar"**, esperá unos segundos y apretá **F5**.
5. El caso pasa a **Respondido** con **semáforo ROJO** 🔴.
6. Comentá: *"Acá la IA detectó un cliente muy disconforme. Y esto es lo importante: cuando algo es grave, el sistema **abre solo un reclamo formal (RQR)**, sin que nadie tenga que cargarlo a mano."*

---

## Paso 4.bis — El mensaje de agradecimiento automático (esperá ~3 minutos)

Después de que el cliente responde y el sistema lo clasifica, unos minutos más tarde (a propósito, para que no parezca un robot) le llega **solo** un mensaje de seguimiento por WhatsApp:

- Si el cliente quedó **conforme** (verde/amarillo): un agradecimiento + recordatorio de que le va a llegar la **encuesta oficial de Ford** a su email.
- Si el cliente quedó **disconforme** (rojo): un mensaje empático distinto ("lamentamos que no haya sido la esperada, un responsable te va a contactar") — **sin** recordarle la encuesta, porque a un cliente enojado no se le insiste con eso.

Para mostrarlo en la demo sin esperar 3 minutos, quien prepara el sistema puede bajar la demora a unos segundos (variable `DELAY_AGRADECIMIENTO_MS`). El mensaje enviado queda visible en el historial del caso.

> Los textos son editables desde **Configuración → Mensajes automáticos** (con vista previa). Si tu jefe pregunta "¿y esto lo puedo cambiar?", entrá a esa pantalla y mostrale que sí, con los comodines {nombre}, {email}, {modelo}.

## Paso 5 — Mostrar el RQR generado solo

1. En el menú de la izquierda, clic en **RQR**.
2. Arriba de todo va a estar el reclamo recién creado, con un número tipo **RQR-2026-0001**.
3. Clic en ese número para abrirlo.
4. Mostrá que ya viene **pre-cargado por la IA**: la descripción del reclamo, la **causa raíz** sugerida (por ejemplo *"Demora en el servicio"* o *"Falta de comunicación"*) y el texto original del cliente.
5. Rematá: *"El área de Calidad recibe el reclamo ya armado. Solo tiene que darle tratamiento y cerrarlo. Esto le ahorra cargar todo a mano y asegura que ningún cliente enojado se pierda."*

---

## Paso 6 — (Opcional) Mostrar un caso intermedio

Si querés mostrar que la IA distingue matices:

1. Volvé a **Casos**, otro caso **Enviado** (por ejemplo **Sofía Ramírez — DEMO-1003**).
2. **"Simular respuesta"** con algo tibio:
   > **más o menos, tardaron un poco pero bueno**
3. F5 → suele dar **semáforo AMARILLO** 🟡 (una objeción menor). Según cuán marcada sea la queja, el sistema decide si amerita o no un reclamo formal.

---

## Paso 7 — Mostrar los reportes y el tablero

1. Menú → **Reporte de Sentimiento**: mostrá la **distribución del semáforo** (verdes / amarillos / rojos) actualizada con lo que acabás de simular.
2. Menú → **Causas Raíz**: mostrá que el caso rojo aparece agrupado por su causa (ej. *Demora en el servicio*).
3. Menú → **Dashboard**: mostrá los **indicadores** (casos, tasa de respuesta, % por color, RQR abiertos) ya reflejando la actividad de la demo.
4. Cierre: *"Todo esto se arma solo, en tiempo real, a partir de las respuestas de los clientes. El equipo de Calidad deja de vivir en planillas y trabaja sobre lo que de verdad importa: los clientes disconformes."*

---

## Si algo no se actualiza en el momento

- Apretá **F5** (la clasificación de la IA tarda unos segundos en volver).
- Si un semáforo queda en gris o "pendiente de revisión", simplemente pasá al siguiente ejemplo: es una respuesta que la IA marcó como ambigua, no un error.

## (Opcional) Módulo de refuerzo de la encuesta de Ford

Si querés mostrar el segundo módulo (el reparto de casos a empleados):

1. Menú → **Carga de Excel** → elegí arriba **"Encuesta Ford"** → subí el export de invitaciones de Ford → confirmá el mapeo de columnas.
2. Mostrá el **resumen**: cuántos casos cruzaron, cuántos respondieron, cuántas **tareas nuevas** se crearon y cómo se **repartieron solas y en partes iguales** entre los empleados.
3. Menú → **Refuerzo Ford**: cada empleado ve **solo sus casos** para llamar (el sistema no llama al cliente: lo hace la persona). La administradora ve **todo** el reparto y puede reasignar.
4. Aclaración importante para tu jefe: *"Acá el sistema no manda nada automático. Solo organiza y reparte de forma pareja el trabajo entre el equipo, y registra todo. El contacto lo hace la persona."*

## Frase de cierre sugerida

> *"En resumen: el cliente responde, la inteligencia artificial lo clasifica al instante, y si hay un problema se abre el reclamo solo y queda registrado. Nada se pierde y nada depende de que alguien lo cargue a mano."*

---
---

# DESPUÉS DE LA DEMO — Limpieza (importante)

Durante la demo el sistema quedó con **dos ajustes temporales** y con **datos de prueba**. Hay que revertir todo antes de entregarlo.

> Todos los comandos se corren en PowerShell, parado en la carpeta del proyecto.

## 1. Devolver los valores de producción

Durante la demo se cambiaron dos variables en `.env.prod`:

| Variable | Valor demo | **Valor a restaurar** |
|---|---|---|
| `DELAY_AGRADECIMIENTO_MS` | 20000 (20 s) | **180000** (3 min) |
| `MAX_ENVIOS_DIARIOS` | 0 (candado) | **200** |

El archivo original quedó respaldado como **`.env.prod.bak-demo`**. La forma más segura de volver atrás:

```powershell
Copy-Item .env.prod.bak-demo .env.prod -Force
Remove-Item .env.prod.bak-demo
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d backend
```

**Verificar** que quedaron bien:
```powershell
docker exec vanina-backend-1 sh -c 'echo "delay=$DELAY_AGRADECIMIENTO_MS  tope=$MAX_ENVIOS_DIARIOS"'
```
Tiene que decir `delay=180000  tope=200`.

## 2. Vaciar la cola de envíos

Si durante la demo se apretó por error un botón de envío, pueden haber quedado mensajes esperando (no salieron, pero conviene sacarlos antes de restaurar el tope a 200):

```powershell
docker exec vanina-redis-1 redis-cli --scan --pattern "bull:whatsapp-envio:*" | ForEach-Object { docker exec vanina-redis-1 redis-cli del $_ }
```

**Verificar** (tiene que dar todo en 0):
```powershell
$t = (Invoke-RestMethod -Uri http://localhost/api/auth/login -Method Post -ContentType 'application/json' -Body '{"email":"admin@goldstein.com.ar","password":"<TU-PASSWORD>"}').token
Invoke-RestMethod -Uri http://localhost/api/campanas/progreso -Headers @{Authorization="Bearer $t"}
```

## 3. Borrar los datos de la demo

### Opción A — borrar solo el caso de la demo (conservando lo importado)

```powershell
docker exec -i vanina-postgres-1 psql -U calidad -d calidad_ford -c "DELETE FROM \"RQR\" WHERE \"casoId\" IN (SELECT id FROM \"Caso\" WHERE \"numeroOrden\" LIKE 'DEMO-%'); DELETE FROM \"Caso\" WHERE \"numeroOrden\" LIKE 'DEMO-%';"
```
Borrar el caso arrastra solos sus mensajes y sus análisis. El RQR se borra primero a propósito, para que no quede huérfano.

### Opción B — dejar la base COMO NUEVA (recomendado antes de entregar)

Borra **todo** (incluido el Excel que cargaste para la demo) y deja solo el usuario administrador:

```powershell
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend npx prisma migrate reset --force --skip-seed
docker compose -f docker-compose.prod.yml --env-file .env.prod restart backend
```
El administrador se vuelve a crear solo al arrancar.

**Verificar** que quedó limpia:
```powershell
docker exec -i vanina-postgres-1 psql -U calidad -d calidad_ford -tA -c "SELECT 'Usuario=' || count(*) FROM \"Usuario\" UNION ALL SELECT 'Caso=' || count(*) FROM \"Caso\" UNION ALL SELECT 'RQR=' || count(*) FROM \"RQR\";"
```
Tiene que dar `Usuario=1`, `Caso=0`, `RQR=0`.

## 4. Chequeo final

```powershell
Invoke-WebRequest http://localhost/api/health -UseBasicParsing | Select-Object -Expand Content
```

Y entrar a http://localhost para confirmar que el sistema abre normal.
