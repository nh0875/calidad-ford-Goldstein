# Guion de la demo en vivo

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
