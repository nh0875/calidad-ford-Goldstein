# Planillas de ejemplo

Los archivos reales con los que se escribió cada lector del sistema. **No son
datos de prueba inventados**: son los exports tal cual los bajan y los suben los
usuarios, con datos de clientes de verdad.

Por eso **ninguno va a git** (`.gitignore` excluye `*.xls`, `*.xlsx` y `*.csv`).
Viven solo en esta máquina. Si se pierden, cada lector queda sin su caso de
referencia y no hay con qué probar un cambio antes de tocar producción.

Antes de tocar cualquier parser, corré el cambio contra la planilla de acá que le
corresponde y comparé el resultado con el de antes. Es la única forma de saber si
rompiste algo que hoy funciona.

---

## Ford

| Archivo | Pantalla que lo carga | Qué es |
|---|---|---|
| `Lista_Turnos_de_Servico_13_10_2025.xls` | `/upload` → Contacto Posventa | El export del portal de turnos de Ford, entero (578 filas). El formato para el que se escribió el lector. |
| `DATOS_NO_LIMPIOS.xls` | `/upload` → Contacto Posventa | El mismo export recortado a un día (17 filas, 40 columnas). Cómodo para probar rápido. |
| `DATOS_BIEN_LIMPIOS.xls` | `/upload` → Contacto Posventa | Las mismas 17 filas con 16 columnas en vez de 40. Sirve para probar qué pasa cuando faltan columnas. |
| `JULIO RQR.xlsx` | `/rqr` → "Importar formularios (Excel)" | El formulario de RQR en papel volcado a Excel: **una hoja por RQR**, no una tabla. Es el único ejemplo que existe de ese formato. |
| `Ford Motor Company_invitations_export_20260721_072706.xlsx` | Refuerzos → carga de encuestas | El export de invitaciones de la plataforma de encuestas de Ford (210 filas). |
| `FidelizacionPlanilla.xlsx` | Fidelización → subir planilla | Formato **VENTAS**. Es el que hoy funciona: si un cambio lo rompe, rompiste Fidelización. |
| `BASE DE DATOS PV 2025.xls` | Fidelización → subir planilla | Formato **TURNOS**, base anual de San Juan: 12 hojas mensuales, 2.847 órdenes. |
| `Entregas Agosto - Diciembre 25.xlsx` | *(todavía ninguna)* | Entregas de 0km de San Juan. **No trae teléfono, mail ni DNI**, así que no se puede contactar a nadie: quedó pendiente hasta que se re-exporte con una columna de contacto. |

## Volkswagen

| Archivo | Pantalla que lo carga | Qué es |
|---|---|---|
| `EncuestaVolkswagen.xlsx` | Encuestas de fábrica | Encuestas pendientes de fábrica, con una hoja por provincia (Mendoza y San Juan) más la de vendedores. |
| `Encuesta_ventas.xls` | `/upload` → Contacto Ventas | Export de ventas del DMS de VW (202 filas). |
| `Orden_Taller(POSVENTA).xls` | `/upload` → Contacto Posventa | Órdenes de taller del DMS de VW (466 filas, 268 órdenes: una orden repite fila por cada tipo de visita). |

---

## Los respaldos de la base NO están acá

Quedaron donde estaban a propósito:

- `calidad_ford_2026-08-14_1413.dump`, en la **raíz del proyecto**. No se puede
  mover: `scripts/windows/instalar-todo.ps1` busca `*.dump` por patrón en la raíz
  para restaurar los datos al instalar una PC nueva. Si se mueve, la instalación
  arranca con la base vacía.
- `pcvanina/calidad-hoy.dump`, en su carpeta.
