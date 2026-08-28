# Sistema de Calidad — Agencia Ford

Sistema web para el área de Calidad que reemplaza dos procesos manuales en Excel:

1. **Contacto Posterior**: seguimiento mensual post-servicio (contacto por WhatsApp a clientes que pasaron por el taller), con análisis automático de respuestas por IA que clasifica en semáforo (🟢 verde / 🟡 amarillo / 🔴 rojo) y sugiere causa raíz.
2. **RQR (Reclamo / Queja / Reporte)**: generación automática del formulario formal cuando un caso da amarillo/rojo, con gestión de tratamiento y cierre por parte de Calidad.

## Stack

| Pieza | Tecnología |
|---|---|
| Backend | Node.js + Express + TypeScript |
| Frontend | React + Vite + TypeScript + Tailwind CSS |
| Base de datos | PostgreSQL + Prisma ORM |
| Cola de trabajos | BullMQ + Redis |
| Infra | Docker Compose (postgres, redis, backend, frontend, nginx) |

## Estructura

```
/backend            API Express + workers de BullMQ
  /prisma           schema.prisma (modelos y enums)
  /src
    /config         env, cliente Prisma, conexión Redis
    /routes         definición de rutas (montadas bajo /api)
    /controllers    handlers HTTP
    /services       lógica de negocio (pendiente)
    /jobs           colas y workers de BullMQ
/frontend           SPA React con React Router + Tailwind
  /src
    /layouts        MainLayout (sidebar + header)
    /pages          pantallas placeholder por ruta
/nginx              proxy reverso (/ -> frontend, /api -> backend)
docker-compose.yml
.env.example
```

## Cómo levantar todo

Requisitos: Docker Desktop (o Docker Engine + Compose v2).

```bash
# 1. Crear el archivo de entorno
cp .env.example .env        # en Windows: copy .env.example .env

# 2. Construir y levantar los 5 servicios
docker compose up -d --build

# 3. Crear las tablas (primera vez, con los contenedores corriendo)
docker compose exec backend npx prisma migrate dev --name init
```

Listo:

- **App**: http://localhost (nginx → frontend con hot-reload)
- **API**: http://localhost/api/health (healthcheck: API + Postgres + Redis)
- **Postgres**: localhost:5432 (usuario/password/db según `.env`)
- **Redis**: localhost:6379

Los directorios `src/` de backend y frontend están montados como volúmenes, así que los cambios de código se recargan sin reconstruir imágenes. Si cambiás dependencias (`package.json`) o el `schema.prisma`, reconstruí: `docker compose up -d --build`.

### Desarrollo sin Docker (opcional)

Con Postgres y Redis corriendo (podés usar solo esos dos servicios: `docker compose up -d postgres redis`):

```bash
cd backend && npm install && npx prisma migrate dev && npm run dev
cd frontend && npm install && npm run dev   # proxy /api -> localhost:3000 ya configurado
```

## Rutas del frontend

| Ruta | Pantalla |
|---|---|
| `/login` | Inicio de sesión (sin sidebar) |
| `/dashboard` | Resumen general |
| `/upload` | Carga del Excel mensual de Contacto Posterior |
| `/casos` | Listado de casos post-servicio |
| `/reportes/sentimiento` | Distribución del semáforo |
| `/reportes/causas-raiz` | Ranking de causas raíz |
| `/rqr` | Gestión de formularios RQR |
| `/usuarios` | Alta y gestión de cuentas (solo ADMIN) |
| `/auditoria` | Bitácora de acciones del sistema (solo ADMIN) |
| `/cambiar-password` | Autoservicio para cambiar la propia contraseña |

## Modelo de datos (resumen)

- `ExcelUpload` 1—N `Caso`: cada upload mensual genera un caso por fila.
- `Caso` 1—N `WhatsappMessage`: conversación entrante/saliente por caso.
- `Caso` 1—N `SentimentAnalysis`: cada respuesta analizada por IA (semáforo, confianza, causa raíz sugerida).
- `Caso` 1—N `RQR` y `SentimentAnalysis` 1—1 `RQR` (opcional): el RQR nace de un análisis amarillo/rojo o se crea manualmente.

## Módulo de carga de Excel (Contacto Posterior)

La pantalla `/upload` implementa la migración desde el Excel real en 3 pasos:

1. **Archivo y sucursal**: sucursal (no viene en el Excel) + año + el archivo Excel. Acepta **`.xlsx` y `.xls`** (el reporte real se descarga como `.xls` clásico OLE2): se sube tal cual, sin borrarle columnas ni convertirlo.
2. **Hojas y columnas**: el backend detecta cada hoja, ubica la fila de encabezados buscándola en las primeras 10 filas, separa las filas de resumen/KPIs previas (ORDENES, SATISFECHOS, RQR, NC, INTERNOS, TASA RESPUESTA) y las muestra para validar la lectura. El mapeo columna→campo se sugiere automáticamente, es editable por hoja, se puede aplicar a todas y se recuerda en el navegador (localStorage) para la próxima carga.
3. **Resultado**: casos insertados, duplicados omitidos, **órdenes repetidas rechazadas y listadas**, filas con error, e históricos clasificados con desglose por semáforo.

El formato real del reporte de Contacto Posventa (descarga directa, hoja única "Normal") trae ~40 columnas; el sistema mapea las que necesita e **ignora el resto** (DN, ID Cita, Motorización, Otro Teléfono, Conductor, Status, usuarios/fechas de auditoría, etc.). Detalles a tener en cuenta:

- **`.xls` clásico**: se valida por firma de contenido (OLE2 `D0CF11E0…`, además del ZIP `PK` del `.xlsx`), no solo por extensión.
- **Número de orden**: la columna real es `Orden de servicio` → `numeroOrden`. Las filas "Concluido sin OR" vienen sin orden y quedan como `S/N`. Ver [Órdenes únicas](#órdenes-únicas).
- **Período**: si el nombre de la hoja no dice el mes (la hoja se llama "Normal"), se deriva del **mes más frecuente** de las fechas de programación (ej. `2026-07`). La usuaria no tiene que tipearlo.
- **Estado**: la columna `Status` del reporte (`Concluido` / `Concluido sin OR`) NO es el estado del sistema y se ignora; todos los casos entran **PENDIENTE**, listos para contactar.
- **Columnas sin destino**: `Servicio` (tipo de servicio) y `Fecha Creación de Agenda` no tienen campo en el modelo y hoy se ignoran; `Comentario del Asesor` sí se guarda (da contexto a la IA). La columna de consentimiento `Acepto el envío de la encuesta` tampoco se usa todavía (ver nota al pie del módulo).

Reglas de importación:

- Teléfonos normalizados a E.164 argentino (`+549...`), usando la columna Whatsapp y con Celular como respaldo (maneja `0` inicial, `15` local y prefijo `54`).
- Columna Estado del Excel → `estadoContacto`: `S`/`RQR` → RESPONDIDO, `NC` → NO_RESPONDIO, `INT` → INTERNO (excluido de campañas de WhatsApp), vacío → PENDIENTE.
- Filas con Estado `S`/`RQR` que traen encuestas de satisfacción o comentario generan un `SentimentAnalysis` histórico (`esHistoricoImportado: true`): RQR o promedio < 3 → ROJO, promedio 3–4 → AMARILLO, > 4 → VERDE. Así los reportes tienen datos desde el día 1 sin pasar por la IA.
- Filas sin nombre ni teléfono válido se reportan como error con su número de fila real del Excel.

Endpoints: `POST /api/uploads` (preview, no persiste), `POST /api/uploads/confirm`, `GET /api/uploads` (historial con KPIs del archivo original), `GET /api/casos` (paginado; filtros: sucursal, asesor, estadoContacto, origenAgendamiento, periodo, fechaDesde/fechaHasta).

### Alta manual de un caso

Botón **"Agregar caso"** en `/casos` (`POST /api/casos`, disponible para ADMIN y CALIDAD), para el cliente que no vino en el Excel: llamó por teléfono, se traspapeló, entró fuera de plazo.

- **Misma normalización que la importación**: el asesor se parte en nombre + código (`"CARLA CAMPORA - 140445"` → `Carla Campora` / `140445`), la sucursal se lleva a Title Case, y se guardan los valores originales en `asesorRaw`/`sucursalRaw`. Los desplegables ofrecen los asesores y sucursales que ya existen (con la opción de escribir uno nuevo), así el ranking no se parte en dos por una tilde.
- **Teléfono obligatorio y validado**: tiene que normalizar a E.164 (`telefonosNorm`), si no se rechaza — un caso sin número que se pueda marcar no sirve para nada.
- **Antiduplicados**: rechaza (409) si ya existe un caso activo con **el mismo número de orden** (mensaje que nombra el caso existente), o la misma patente en la misma fecha. Ver [Órdenes únicas](#órdenes-únicas).
- **Área**: un usuario restringido a VENTAS o POSVENTA solo crea en la suya (el backend la fuerza, ignorando lo que mande el navegador); ADMIN y área AMBAS eligen.
- **Carga sintética**: como todo caso pertenece a una carga (`uploadId` es NOT NULL), se reusa o crea un `ExcelUpload` llamado `Carga manual` por sucursal + período, así los reportes por período siguen funcionando sin migrar el esquema.
- El caso nace **PENDIENTE**: no se le manda nada hasta que se lo seleccione y se confirme el envío. Queda registrado en auditoría como `CASO_CREADO_MANUAL`.

### Órdenes únicas

Un número de orden identifica un servicio: **no puede repetirse**. La regla vale para las dos vías de carga y para toda la base (no por sucursal ni por mes).

- **Carga manual**: si el número de orden ya existe en un caso activo, la creación se rechaza con 409 y un mensaje que nombra el caso que ya lo tiene ("Ya hay un caso con el número de orden 123456 (Vanina, Mendoza)…").
- **Carga masiva (Excel)**: las filas cuyo número de orden ya existe —en la base o repetido dentro del mismo archivo— **no se cargan**, y la pantalla de importación las lista aparte ("Órdenes repetidas (no cargadas): …") además de contarlas. El resto del archivo se importa normalmente.
- **Excepción `S/N`**: los casos sin número de orden (manual sin orden, o meses del Excel viejo sin columna ORDEN) usan `numeroOrden = "S/N"`; puede haber varios. A esas filas se les aplica el criterio patente+fecha / nombre+fecha, acotado a sucursal+período.
- **Garantía dura**: la migración `20260724210000` crea un índice único **parcial** `Caso_numeroOrden_activo_key` sobre `numeroOrden` `WHERE eliminadoEn IS NULL AND numeroOrden <> 'S/N' AND <> ''`. Aunque dos altas simultáneas esquiven el chequeo de la aplicación, la base rechaza la segunda (el controller lo traduce a un 409 claro). Un caso **dado de baja** libera su orden: se puede volver a cargar.

## Envío y recepción de WhatsApp (Meta Cloud API)

La pantalla `/casos` lista los casos con filtros y permite disparar campañas:

- **Segmentación**: las campañas SOLO alcanzan casos con `estadoContacto = PENDIENTE`. Internos, históricos ya clasificados, enviados y fallidos quedan siempre afuera.
- **Flujo**: preview (`GET /api/campanas/preview`, solo cuenta) → confirmación → envío (`POST /api/campanas/enviar`, encola en `whatsapp-envio` con delay entre mensajes por rate limit) → progreso (`GET /api/campanas/progreso`, polling).
- **Worker**: envía el template (variables: nombre, modelo, fecha de salida) al `whatsapp` del caso (o `celular` como respaldo), guarda el `WhatsappMessage` saliente y pasa el caso a ENVIADO. Reintenta hasta 3 veces con backoff exponencial ante rate limit/timeout/5xx; ante número inválido (ej. código 131026) marca ERROR directo con el motivo en `Caso.ultimoErrorEnvio`.
- **Webhook** `GET|POST /api/webhooks/whatsapp`: verificación inicial de Meta (`hub.challenge` + `META_WEBHOOK_VERIFY_TOKEN`), respuestas entrantes (asocia por teléfono contra `whatsapp` y `celular`, pasa el caso a RESPONDIDO y encola el análisis de sentimiento), acuses de entrega/lectura, y mensajes de números desconocidos guardados en `MensajeHuerfano` para revisión manual.
### Respuestas partidas en varios mensajes

Un cliente rara vez contesta con un solo mensaje. Lo habitual es `"Hola"` / `"la atención fue muy buena"` / `"pero tardaron 3 días de más"`. Analizando mensaje por mensaje eso daba **tres** clasificaciones: un saludo sin sentido, un VERDE y un AMARILLO. Consecuencias: tres llamadas a la IA, el mismo cliente contando como tres respuestas en el reporte y en el ranking del asesor, y el último fragmento decidiendo el semáforo del caso.

- **Ventana de consolidación** (`DELAY_ANALISIS_MS`, 90 s por defecto): el análisis no se dispara por mensaje. Cada mensaje nuevo **reprograma** el mismo job (`analisis-<casoId>`), así que corre recién cuando el cliente estuvo ese tiempo sin escribir, y analiza **toda la tanda junta en una sola llamada**. `WhatsappMessage.analizadoEn` marca los mensajes ya cubiertos; `SentimentAnalysis.mensajesAnalizados` deja registro de cuántos se consolidaron.
- **Un caso, una clasificación**: `SentimentAnalysis.esSeguimiento` distingue la clasificación que cuenta (`false`) de lo que el cliente escribió después (`true`). Reportes, dashboard, rankings, listados y revisión manual filtran por `esSeguimiento: false`, así que un cliente conversador vale por uno.
- **Solo se puede empeorar**: si una respuesta posterior es peor que la vigente (VERDE → AMARILLO → ROJO), **escala**: pasa a ser la clasificación del caso, la anterior queda como seguimiento y se genera un aviso. Al revés no: un `"gracias igual"` o un `"al final lo solucionaron"` después de una queja **no** borra la queja. Invariante: como máximo un análisis principal por caso.
- **Cortesía posterior**: `"ok"`, `"muchas gracias"`, `"👍"` que llegan *después* de que el caso ya tiene su clasificación se registran pero no se analizan — no gastan cuota de IA ni ensucian los números. La lista es deliberadamente corta y sin palabras con carga (`bien`, `muy`, `excelente`, `perfecto` **no** están): `"todo bien"` o `"ok pero cuándo me devuelven el auto"` sí se analizan. La **primera** respuesta del cliente siempre se analiza, aunque sea corta.
- La migración `20260724180000` hace el backfill: los casos que ya tenían varios análisis conservan como principal **el más grave** (a igual gravedad, el más reciente) y el resto pasa a seguimiento, así los números históricos dejan de contar dos veces al mismo cliente.

### Reacciones y respuestas de solo emoji

Un cliente que reacciona con 👍 (reacción de WhatsApp) o contesta solo con emojis no manda texto que la IA pueda leer bien: `type: "reaction"` llegaba como `[mensaje de tipo reaction]` y terminaba en revisión manual, sin semáforo.

- El webhook ahora reconoce `type: "reaction"` y toma el emoji como contenido (`webhook.controller.ts`). Quitar una reacción (emoji vacío) se ignora: no crea mensaje ni pasa el caso a RESPONDIDO.
- Las respuestas de **solo emojis** se clasifican **sin IA**, de forma determinista (`sentimientoSoloEmoji`): al menos un emoji positivo y ninguno negativo → **VERDE** directo (sin RQR, confianza 1). Un pulgar arriba es verde, siempre.
- Un emoji **negativo o ambiguo** suelto (👎, 😮, 😢) es demasiado poco para clasificar o abrir un reclamo: va a **revisión manual** para que lo mire una persona. Nunca abre un ROJO automático.
- Si la respuesta mezcla emoji y texto (`"gracias 👍"`, `"todo bien 🙂"`), no es "solo emoji" y la lee la IA normalmente.

### Casos para revisar a mano (`/revision-manual`)

Cuando la IA no puede clasificar sola una respuesta (audio/imagen, reacción ambigua, o una primera respuesta demasiado corta), el caso queda marcado `requiereRevisionManual`. La pantalla **Revisión manual** (en el menú, con badge de cantidad; también se llega desde la tarjeta "Revisión manual" del reporte y desde el dashboard) lista esos casos con lo que efectivamente dijo el cliente, y permite fijar el semáforo a mano con un clic. Al clasificar, el caso sale de la bandeja y su semáforo cuenta en los reportes.

- **Por área**: un usuario restringido solo ve y corrige los de su área (el badge, la bandeja y el PATCH la respetan; corregir uno ajeno da 403). ADMIN y área AMBAS ven todo.
- Endpoints: `GET /api/sentiment-analysis/revision-manual` (bandeja), `GET /api/sentiment-analysis/revision-manual/pendientes` (contador del badge), `PATCH /api/sentiment-analysis/:id` (fijar semáforo / marcar resuelto).

### Reparto de refuerzos Ford por área y provincia

Las tareas de refuerzo (seguimiento de la encuesta Ford) se reparten **solas** al importar el export de Ford, de forma equilibrada (al que menos carga tiene) y **sin mezclar**:

- **Área**: una tarea de un caso de VENTAS solo se asigna a usuarios de VENTAS o AMBAS; una de POSVENTA, a POSVENTA o AMBAS. El área del caso se toma del contacto importado; el export de Ford trae una columna `Tipo de encuesta` donde POSVENTA aparece como **"Servicio"** — el sistema la mapea (`clasificarAreaFord`: `Servicio`→POSVENTA, `ventas`/`venta`/`sales`→VENTAS) y la usa para detectar cruces incorrectos.
- **Provincia (sucursal)**: cada usuario tiene una **provincia** (`Usuario.sucursal`: "San Juan", "Mendoza", … o *vacío = todas*). Una tarea de un caso de Mendoza solo se asigna a alguien que atienda Mendoza (o todas). Se elige al crear/editar el usuario en **Usuarios**; el ADMIN no está limitado.
- **Reasignación**: el reparto automático se puede corregir. Botón **"Redistribuir sus tareas"** (empleado no disponible → sus tareas abiertas van al resto, respetando área+provincia) y **"Mover a…"** por tarea. El backend rechaza mover una tarea a alguien de otra área o provincia.
- La elegibilidad la controla `participaEnRefuerzos` (no el rol): un ADMIN que también gestiona casos recibe tareas si participa; para que solo supervise, se pone en false.

### Avisos en pantalla (cartel rojo)

Un RQR que se abre solo, de madrugada, antes lo veía únicamente quien se acordara de entrar a la pantalla de RQR. Ahora se crea un **aviso** y la app lo muestra como cartel rojo **arriba de todo, en todas las pantallas** (`CartelAvisos` en el layout, refresco cada 60 s). No se manda ningún mail: el aviso vive adentro del sistema, que es donde se trabaja.

- **Cuándo se crea**: se abrió (o se reabrió) un RQR automático, un cliente **escaló** tras haber respondido bien, o quedó un **amarillo sin RQR** que conviene mirar.
- **Cuándo se apaga**: cuando alguien lo marca visto (individual o "marcar todos"), o **solo** cuando el RQR asociado se cierra. Un caso borrado se lleva sus avisos.
- **Por área**: un usuario restringido a VENTAS o POSVENTA solo ve los de la suya, y no puede apagar uno ajeno ni mandando el id a mano (404). ADMIN y área AMBAS ven todo.
- **Sin repetidos**: si el mismo caso vuelve a disparar el mismo tipo de aviso, se refresca el existente en vez de apilar carteles.
- Endpoints: `GET /api/avisos`, `POST /api/avisos/:id/visto`, `POST /api/avisos/vistos`.

- **Cron diario** (BullMQ repeatable, 08:00 AR): los casos ENVIADO sin respuesta hace más de `DIAS_SIN_RESPUESTA_PARA_NC` días pasan a NO_RESPONDIO. Corrida manual: `docker compose exec backend npx tsx src/scripts/marcar-no-respondio.ts`.
- **Reintento de un envío fallido** (`POST /api/campanas/reintentar/:casoId` + botón **"Reintentar"** en la fila del caso): un envío que falla deja el caso en ERROR, y las campañas solo alcanzan casos PENDIENTE — sin esto el caso quedaba varado y la única salida era tocar la base a mano. El reintento vuelve a ponerlo PENDIENTE y encola solo ese caso, respetando las mismas reglas (área, baja del cliente, lista de supresión, ventana horaria y tope diario). Además, `encolarCampana` borra de Redis el job **ya terminado** del caso antes de reencolar: el `jobId` es fijo por caso y BullMQ conserva los fallidos 24 hs, así que sin esa limpieza el reintento se descartaba en silencio (la API decía "encolado" y no salía nada). Los jobs que siguen esperando o enviándose no se tocan, para que el dedupe siga evitando dobles envíos por doble click.

Para probar sin credenciales reales hay un mock de la Graph API: `docker compose exec -d backend npx tsx src/scripts/mock-meta.ts` con `META_GRAPH_BASE_URL=http://127.0.0.1:4999/v20.0` (los números terminados en 4001 simulan "número inválido"). Con credenciales reales, configurar en Meta la URL del webhook `https://<dominio>/api/webhooks/whatsapp` con el mismo `META_WEBHOOK_VERIFY_TOKEN` del `.env`.

## Análisis de sentimiento con IA + RQR automático

Cada respuesta entrante de WhatsApp dispara un job en `analisis-sentimiento` que:

1. **Clasifica con Claude** (API de Anthropic, modelo `ANTHROPIC_MODEL`, default `claude-sonnet-4-6`): semáforo VERDE/AMARILLO/ROJO, confianza 0-1, causa raíz de una lista cerrada (`DEMORA_SERVICIO`, `MAL_TRATO_PERSONAL`, `PRECIO_FACTURACION`, `CALIDAD_TRABAJO`, `FALTA_COMUNICACION`, `REPUESTOS`, `OTRO` — editable en `src/services/sentiment.service.ts`), resumen en español y marca de revisión manual. Si la IA no devuelve JSON válido se reintenta una vez con prompt estricto; si vuelve a fallar, el registro queda con `semaforo=null` y `requiereRevisionManual=true`.
2. **Respuestas no textuales** (audio, imagen, sticker): no se llama a la IA, quedan directo en revisión manual.
3. **Abre RQR automáticamente** cuando corresponde — regla de negocio aplicada en código (no se le delega al modelo): ROJO siempre; AMARILLO solo con confianza ≥ 0.7. El RQR se crea con correlativo por año (`RQR-2026-0001`), asesor del caso, descripción pre-completada (resumen IA + causa sugerida + texto original del cliente, marcada como "generado automáticamente") y `causaRaiz` sugerida editable. `Caso.tieneRqrAbierto` se prende al abrir y se recalcula al cerrar.
4. **Modo mock** (`ANALISIS_MODO_MOCK=true`): clasificación simulada por palabras clave, sin gastar API — cubre los tres semáforos, categorías y revisión manual.

Endpoints: `GET /api/sentiment-analysis` (filtros: semaforo, sucursal, asesor, categoriaCausaRaiz, requiereRevisionManual, fechaDesde/fechaHasta; paginado), `GET /api/sentiment-analysis/revision-manual`, `PATCH /api/sentiment-analysis/:id` (corrección manual de semáforo/causa), `GET /api/rqr`, `PATCH /api/rqr/:id` (tratamiento y cierre).

Cambios de schema respecto de la Fase 1 (documentados): `SentimentAnalysis.semaforo` pasó a nullable (los análisis fallidos quedan sin clasificar), y se agregaron `SentimentAnalysis.requiereRevisionManual` y `Caso.tieneRqrAbierto`.

## Reportes y gestión de RQR

Las tres pantallas comparten los mismos filtros (fechas, sucursal, asesor, período) para poder cruzar información con consistencia:

- **`/reportes/sentimiento`** (`GET /api/reportes/sentimiento` + `/exportar`): tarjetas por semáforo con %, tasa de respuesta sobre casos contactados (INTERNO excluido del cálculo y reportado aparte), pendientes de revisión manual, evolución temporal (agrupa por semana automáticamente cuando el rango supera 60 días), y desglose por sucursal y asesor ordenable por % de rojos. Exporta a Excel (exceljs) con hojas Resumen / Evolución / Por Sucursal / Por Asesor.
- **`/reportes/causas-raiz`** (`GET /api/reportes/causa-raiz` + `/exportar`): barras por categoría combinando RQR del período + análisis AMARILLO sin RQR (toggle `incluirAmarilloSinRqr`, default true), tiempo promedio de cierre de RQR (general y por categoría), y tabla detallada expandible por fila (texto completo de la respuesta + resumen IA) con link directo al RQR asociado.
- **`/rqr`** y **`/rqr/:id`**: listado con filtros (estado, categoría, sucursal, asesor, fechas) y formulario de detalle que replica el papel: datos del caso (solo lectura), descripción del reclamo pre-completada por IA (editable), tratamiento/bitácora, solución propuesta, causa raíz (select con la lista cerrada), estado, responsable y fecha de cierre (automática al cerrar, editable). Guarda con `PATCH /api/rqr/:id` y exporta el formulario individual a **Word** (`GET /api/rqr/:id/word`, paquete docx) con las cinco secciones del formato papel.

## Dashboard y creación manual de RQR

- **`/dashboard`** (`GET /api/dashboard/resumen`, default últimos 30 días, filtro opcional de sucursal): KPIs (casos cargados en el período por `createdAt`, WhatsApp enviados, tasa de respuesta, % por semáforo, RQR abiertos con antigüedad promedio), top 3 causas raíz, evolución temporal, rankings de sucursales y asesores por % de rojos (**mínimo 5 casos clasificados** para entrar, así una sola respuesta mala no distorsiona), lista de RQR abiertos ordenada por antigüedad con link al detalle, y distribución de origen del agendamiento (Dealer/FordPass/Onlinebooking) con su tasa de respuesta. Reusa los componentes de gráficos de los reportes.
- **RQR manual** (`POST /api/rqr` + botón "Nuevo RQR" en `/rqr`): para reclamos por teléfono/presencial/otro canal. Se vincula un Caso existente con el buscador (`GET /api/casos/buscar?q=` por nombre, teléfono, patente u orden) o se tilda "Cliente sin caso en el sistema" y se cargan `nombreClienteManual`/`telefonoManual`/`modeloManual`. El correlativo se genera igual que en el flujo automático de la IA (que no se tocó). Al guardar redirige al detalle.
- **Cambio de schema**: `RQR.casoId` pasó a nullable (+ campos manuales); Word, reportes y listados toleran RQR sin caso vinculado.

## Importación de los Excel reales del área

El sistema quedó cargado con los archivos reales como base de datos inicial:

- **`CONTACTO POSTERIOR PV SJ 2026.xlsx`** (7 hojas ENERO→JULIO): se importa por la pantalla `/upload` normal. Compatibilidad verificada con las particularidades del archivo real: columna "Origen del **Agendamento**" (sin la i), meses sin columna ORDEN (enero-marzo), respuestas de encuesta "Si"/"No" (se interpretan como 5/1), hojas que declaran miles de columnas vacías (se acota a 60). **Regla de duplicados**: por número de orden cuando la fila lo tiene; si no, por patente+fecha; si tampoco, por nombre+fecha — verificado contra el archivo real (las repeticiones detectadas coinciden 1:1 con las filas repetidas del Excel) y estable ante re-cargas. El KPI de resumen de cada hoja queda guardado para contrastar (ojo: el KPI de JUNIO dice 204 órdenes pero la hoja tiene 103 filas con orden repetida — el sistema carga las 130 únicas).
- **`ejemplos-de-carga/ford/JULIO RQR.xlsx`** (formato formulario: **una hoja por RQR**, con el layout del papel): botón "Importar formularios (Excel)" en `/rqr` → `POST /api/rqr/importar`. Parsea las secciones del formulario (fecha de apertura, canal/áreas, datos del cliente, descripción, bitácora, solución, verificación de eficacia, causa raíz), **vincula el Caso automáticamente por patente/VIN o teléfono** si el cliente está en el sistema, crea el RQR con el correlativo normal, y es idempotente (re-importar no duplica).

## Despliegue a producción

El repo incluye un stack de producción separado del de desarrollo: imágenes compiladas (backend TypeScript → JS, frontend Vite → estáticos servidos por nginx), sin volúmenes de código, sin puertos de base de datos expuestos, migraciones automáticas al arrancar (`prisma migrate deploy`) y Redis con persistencia.

**Requisitos del servidor**: cualquier Linux con Docker + Compose v2 (un VPS chico alcanza: 2 GB de RAM sobra para este volumen). Para recibir los webhooks de WhatsApp, Meta exige **HTTPS público**: lo más simple es poner un Cloudflare Tunnel o un certificado con certbot delante del puerto del sistema.

**Pasos** (en el servidor, dentro de la carpeta del proyecto):

```bash
# 1. Configurar credenciales
cp .env.prod.example .env.prod
#    → editar: contraseña fuerte de Postgres, JWT_SECRET (openssl rand -hex 32,
#      distinto al de desarrollo), ADMIN_EMAIL/ADMIN_PASSWORD_INICIAL del primer
#      admin, token aleatorio para el webhook, credenciales de Meta cuando estén,
#      ANTHROPIC_API_KEY y ANALISIS_MODO_MOCK=false

# 2. Levantar todo (compila las imágenes la primera vez)
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

# 3. Verificar
curl http://localhost/api/health
```

Quedan 4 servicios: `postgres`, `redis`, `backend` (aplica migraciones y arranca API + workers + cron) y `web` (nginx con la SPA + proxy a la API). Actualizar versión = `git pull` (o copiar el código) y repetir el paso 2.

**Seguridad**: el sistema ya pide login (ver sección [Autenticación](#autenticación)) — igual, sumar una capa de red (VPN, red interna, o al menos restringir por IP en el proxy) es buena práctica para un sistema con datos de clientes. Lo único que **debe** quedar público sin restricciones adicionales es `/api/webhooks/whatsapp`, para que Meta pueda entregarle mensajes (se protege sola con `META_WEBHOOK_VERIFY_TOKEN`).

**Migrar los datos ya cargados** de la máquina de desarrollo al servidor:

```bash
# en la máquina actual
docker compose exec -T postgres pg_dump -U calidad calidad_ford > backup.sql
# en el servidor, con el stack de producción arriba
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres psql -U calidad calidad_ford < backup.sql
```

(O simplemente volver a subir los Excel por `/upload` e `/rqr`, que es idempotente.)

## Autenticación

Todas las rutas de `/api` requieren sesión (JWT), salvo `GET /api/health`, `POST /api/auth/login` y `/api/webhooks/whatsapp` (que Meta no puede llamar con un JWT nuestro; se protege sola con `META_WEBHOOK_VERIFY_TOKEN`). El middleware `requireAuth` no solo valida la firma del token: en cada request vuelve a consultar el usuario en la base, así que desactivar una cuenta le corta el acceso al instante, sin esperar a que expire el JWT (8hs por defecto).

- **Roles**: `ADMIN` (gestiona usuarios) y `CALIDAD` (todo lo demás). El primer admin lo crea el seed automático al arrancar el backend, a partir de `ADMIN_EMAIL` / `ADMIN_PASSWORD_INICIAL` — es idempotente (si ese email ya existe no toca la contraseña), así que sirve tanto para el primer arranque como para correr de nuevo sin efecto. Manual: `docker compose exec backend npm run seed:admin`.
- **Login**: `POST /api/auth/login` (email + password) → JWT. `GET /api/auth/yo` rehidrata la sesión guardada. `POST /api/auth/cambiar-password` para que cualquier usuario cambie su propia contraseña (pantalla `/cambiar-password`, enlazada desde el header).
- **Gestión de cuentas** (`/usuarios`, solo ADMIN): alta de cuentas para el equipo (`POST /api/usuarios`, contraseña inicial definida por el admin — no hay envío de mail configurado), reseteo de contraseña ajena (`PATCH /api/usuarios/:id/resetear-password`) y activar/desactivar (`PATCH /api/usuarios/:id`; un admin no puede desactivarse a sí mismo).
- **Contraseñas**: hasheadas con bcrypt (vía `bcryptjs`, sin dependencias nativas para no complicar el build de la imagen Alpine); mínimo 8 caracteres.
- **Frontend**: el JWT se guarda en `localStorage` y viaja en cada request (`lib/api.ts`); un 401 limpia la sesión y redirige a `/login` desde un único punto. Las descargas de Excel/Word (que antes navegaban directo a la URL) ahora se piden con `fetch` + el header de auth y se guardan como blob, porque una navegación de browser no puede llevar el `Authorization` header.

## Modo demostración (`MODO_DEMO`)

Para mostrar el sistema funcionando de **punta a punta sin credenciales reales** de Meta ni de ningún proveedor de IA, se puede activar `MODO_DEMO=true`. Con eso:

- **El envío de WhatsApp se simula**: el caso pasa a `ENVIADO` igual que en producción (se guarda el `WhatsappMessage` saliente), pero no se toca la red ni hacen falta credenciales de Meta ni apuntar `META_GRAPH_BASE_URL` a ningún mock a mano.
- **El análisis de sentimiento** usa el mock por palabras clave **solo si no hay ninguna API key real** (`ANTHROPIC_API_KEY` ni `GEMINI_API_KEY`). Si tenés alguna de las dos configurada, el análisis es **real** aunque WhatsApp esté simulado (útil para demostrar la IA de verdad con la key de Gemini, por ejemplo). Se prefiere Anthropic; si solo está la de Gemini, se usa Gemini (vía REST, sin dependencias extra).
- **En el frontend** (solo con `MODO_DEMO=true`): un indicador discreto **"Modo demostración"** en el header, y un botón **"Simular respuesta del cliente"** en cada caso `ENVIADO` de `/casos`. Ese botón abre un modal para escribir un mensaje y llama a `POST /api/demo/simular-respuesta`, que recorre **exactamente el mismo camino** que una respuesta real entrante por el webhook: crea el mensaje ENTRANTE, pasa el caso a `RESPONDIDO` y encola el análisis (que puede abrir un RQR). Así se ve en vivo cómo un mensaje se clasifica y genera el RQR, sin un teléfono real.

Nada de esto aparece ni cambia el comportamiento si `MODO_DEMO` no está en `true`.

**Datos de ejemplo para la demo**: `npm run seed:demo` (o `docker compose exec backend npx tsx src/scripts/seed-demo.ts`) crea 6-8 casos ficticios (nombres/modelos/sucursales inventados, sin datos de clientes reales), variados en estado, para no depender de haber cargado el Excel real antes de la reunión. Es idempotente: reemplaza el set de demo anterior sin tocar los datos reales.

> El mock HTTP de la Graph API (`src/scripts/mock-meta.ts`) sigue disponible para probar el camino de red completo; `MODO_DEMO` es la vía más simple y presentable para una demostración, porque no requiere levantar ningún proceso aparte.

## Seguridad, auditoría y recuperación ante desastres

El sistema tiene un refuerzo de seguridad documentado aparte en **[SECURITY.md](SECURITY.md)** (en lenguaje simple, pensado para una auditoría externa). En resumen:

- **Auditoría inmutable** (`/auditoria`, solo ADMIN): bitácora de solo inserción de cada acción relevante (logins ok/fallidos, alta/edición/cierre/borrado de casos y RQR, campañas, usuarios, importaciones), con usuario, IP, navegador y estado antes/después. Nunca registra contraseñas ni tokens, y **no se puede editar ni borrar** (ni siquiera ADMIN).
- **Borrado lógico**: eliminar Caso/RQR/carga de Excel no borra datos, los oculta y quedan recuperables (`POST /api/admin/restaurar/:tipo/:id`). Solo ADMIN puede eliminar, y el frontend pide **escribir el número exacto** para confirmar.
- **Anti fuerza bruta** (5 intentos fallidos por email / 15 min → bloqueo 15 min) y **rate limit** general (100 req/min por IP).
- **Endurecimiento**: Helmet (cabeceras HTTP), CORS restrictivo por `FRONTEND_URL`, validación real del contenido `.xlsx` (máx 20 MB), y **logout efectivo del lado del servidor** (revocación del token en Redis).
- **Backups automáticos**: contenedor `backup` con dump diario (rotación 14 días), **copia offsite** a un bucket S3-compatible (AWS S3 / Backblaze B2 / DigitalOcean Spaces) y **verificación semanal** restaurando en una base descartable. Estado visible en el Dashboard (`GET /api/sistema/estado-backup`). El procedimiento exacto para **restaurar todo desde cero** está en **[RECOVERY.md](RECOVERY.md)**.

Variables nuevas relevantes (ver `.env.prod.example`): `FRONTEND_URL`, `RATE_LIMIT_POR_MINUTO`, y el bloque `BACKUP_*` / `BACKUP_S3_*`.

## Instalación en una máquina nueva desde GitHub

El código viaja por GitHub (repo privado); los **datos** viajan por un backup de la base y los **secretos** (`.env`) se copian a mano. **Nunca** van a git ni el `.env` ni los Excel de clientes ni los backups (ver `.gitignore`). Procedimiento resumido (el detallado, con comandos copiables y verificación, está en **[PRODUCCION.md](PRODUCCION.md)**):

```bash
# 1. Traer el código
git clone <URL-del-repo-privado> calidad && cd calidad

# 2. Copiar el .env a mano (NO está en git) y completar los secretos
#    (contraseña de Postgres, JWT_SECRET, CONFIG_ENCRYPTION_KEY, GEMINI_API_KEY, etc.)
copy .env.example .env        # y editar    (Windows)

# 3. Levantar el stack (Docker Desktop tiene que estar corriendo)
docker compose up -d --build

# 4. Crear las tablas
docker compose exec backend npx prisma migrate deploy

# 5. Restaurar el backup de la base (trae los casos reales)
#    ver PRODUCCION.md para el comando exacto y la verificación del conteo
```

Las credenciales de WhatsApp (Meta) NO van en el `.env`: se cargan cifradas desde la pantalla **Configuración** una vez que el sistema está arriba.

## Notas de desarrollo en Windows

Los eventos de archivos no atraviesan los bind mounts de Docker en Windows, así que `tsx watch` / Vite HMR **no recargan solos** al editar código del host: después de cambiar `src/`, correr `docker compose restart backend` (o `frontend`).

## Pendiente

- Recuperación de contraseña por mail (no hay servicio de mail configurado; por ahora el admin resetea desde `/usuarios`)
