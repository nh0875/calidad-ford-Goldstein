// Áreas y subáreas del RQR de Volkswagen.
//
// Volkswagen clasifica cada reclamo por ÁREA (Ventas / Posventa / Plan de Ahorro)
// y por SUBÁREA dentro de esa área. Este catálogo sale de la hoja que definió la
// jefa de Calidad de VW (agosto 2026).
//
// Ford NO usa esto: su RQR se clasifica por causa raíz, no por subárea.
//
// Decisiones de transcripción tomadas al cargar la hoja (revisar si cambian):
//  - "Taller" está en Posventa Y en Plan de Ahorro. En la foto de la hoja la
//    línea de Posventa parecía tachada, pero era el DOBLEZ del papel (confirmado
//    con quien la escribió).
//  - "At. Cte." tenía las encuestas anotadas entre paréntesis como un tercer
//    nivel; se despliegan como subáreas propias para que se elijan de un solo
//    desplegable sin perder el detalle.
//  - "Vta Trad." se escribe "Venta Tradicional" (confirmado).
//
// Sobre las encuestas de At. Cliente: SSI (ventas), OSI (posventa) y CEM las
// manda FÁBRICA, de forma ALEATORIA, a clientes elegidos por ella. La agencia no
// controla a quién le llegan. La "interna" y la "espontánea" son propias.
// Por eso el subárea dice de qué encuesta salió el reclamo: no es lo mismo un
// reclamo que llega por una encuesta de fábrica —que impacta en los índices que
// mide VW— que uno que surge de una encuesta propia.

/** Área del RQR en Volkswagen. Es el "tipo de contacto" del formulario. */
export const AREAS_VW = ["VENTAS", "POSVENTA", "PLAN_DE_AHORRO"] as const;
export type AreaVW = (typeof AREAS_VW)[number];

export const NOMBRE_AREA_VW: Record<AreaVW, string> = {
  VENTAS: "Ventas",
  POSVENTA: "Posventa",
  PLAN_DE_AHORRO: "Plan de Ahorro",
};

// Subáreas por área. El `valor` es lo que se guarda en la base (estable, no
// cambia si se corrige la redacción); la `etiqueta` es lo que se ve en pantalla.
export interface SubareaVW {
  valor: string;
  etiqueta: string;
}

export const SUBAREAS_VW: Record<AreaVW, SubareaVW[]> = {
  VENTAS: [
    { valor: "VTA_PRODUCTO", etiqueta: "Producto" },
    { valor: "VTA_RECEPCION", etiqueta: "Recepción" },
    { valor: "VTA_ASESORAMIENTO", etiqueta: "Asesoramiento / Vendedor" },
    { valor: "VTA_ADM_GESTORIA", etiqueta: "Administración / Gestoría" },
    { valor: "VTA_PRE_ENTREGA", etiqueta: "Pre Entrega" },
    { valor: "VTA_ENTREGA", etiqueta: "Entrega" },
    { valor: "VTA_PRECIO", etiqueta: "Precio" },
    // Atención al cliente, abierta por el origen de la encuesta.
    { valor: "VTA_AT_CTE_INTERNA", etiqueta: "At. Cliente (enc. interna)" },
    { valor: "VTA_AT_CTE_ESPONTANEA", etiqueta: "At. Cliente (enc. espontánea)" },
    { valor: "VTA_AT_CTE_CEM", etiqueta: "At. Cliente (enc. CEM)" },
    { valor: "VTA_AT_CTE_SSI", etiqueta: "At. Cliente (enc. SSI)" },
  ],
  POSVENTA: [
    { valor: "PV_TURNOS_PRECIO", etiqueta: "Turnos / Precio" },
    { valor: "PV_RECEPCION", etiqueta: "Recepción" },
    { valor: "PV_TALLER", etiqueta: "Taller" },
    { valor: "PV_REPUESTOS", etiqueta: "Repuestos" },
    { valor: "PV_GARANTIA", etiqueta: "Garantía" },
    { valor: "PV_ASESORAMIENTO_SERVICIO", etiqueta: "Asesoramiento de Servicio" },
    { valor: "PV_LAVADO", etiqueta: "Lavado" },
    { valor: "PV_AT_CTE_INTERNA", etiqueta: "At. Cliente (enc. interna)" },
    { valor: "PV_AT_CTE_CEM", etiqueta: "At. Cliente (enc. CEM)" },
    { valor: "PV_AT_CTE_OSI", etiqueta: "At. Cliente (enc. OSI)" },
  ],
  PLAN_DE_AHORRO: [
    { valor: "PA_ADJUDICACION", etiqueta: "Adjudicación" },
    { valor: "PA_AGRUPAMIENTO", etiqueta: "Agrupamiento" },
    { valor: "PA_LICITACION_SORTEO", etiqueta: "Licitación / Sorteo" },
    { valor: "PA_CANCELACION_LIQUIDACION", etiqueta: "Cancelación / Liquidación" },
    { valor: "PA_CONTROL_CALIDAD", etiqueta: "Control de Calidad" },
    { valor: "PA_ENTREGA", etiqueta: "Entrega" },
    { valor: "PA_FACTURACION", etiqueta: "Facturación" },
    { valor: "PA_FIDELIZACION", etiqueta: "Fidelización" },
    { valor: "PA_INGRESO", etiqueta: "Ingreso" },
    { valor: "PA_LAVADERO", etiqueta: "Lavadero" },
    { valor: "PA_PEDIDO_UNIDAD", etiqueta: "Pedido (unidad)" },
    { valor: "PA_PROSPECCION", etiqueta: "Prospección" },
    { valor: "PA_SUSCRIPCION", etiqueta: "Suscripción" },
    { valor: "PA_TALLER", etiqueta: "Taller" },
    { valor: "PA_TURNOS", etiqueta: "Turnos" },
    { valor: "PA_USO_MANTENIMIENTO", etiqueta: "Uso / Mantenimiento" },
    { valor: "PA_VENTA_TRADICIONAL", etiqueta: "Venta Tradicional" },
  ],
};

/** Todas las subáreas válidas, para validar lo que llega del formulario. */
export const SUBAREAS_VW_VALIDAS: Set<string> = new Set(
  Object.values(SUBAREAS_VW).flatMap((lista) => lista.map((s) => s.valor))
);

/** Etiqueta para mostrar de una subárea guardada (o el valor crudo si no está). */
export function etiquetaSubareaVW(valor: string | null | undefined): string {
  if (!valor) return "—";
  for (const lista of Object.values(SUBAREAS_VW)) {
    const encontrada = lista.find((s) => s.valor === valor);
    if (encontrada) return encontrada.etiqueta;
  }
  return valor;
}

/** ¿Esa subárea pertenece a esa área? Evita guardar combinaciones imposibles. */
export function subareaPerteneceAlArea(area: AreaVW, subarea: string): boolean {
  return SUBAREAS_VW[area]?.some((s) => s.valor === subarea) ?? false;
}

// ---------------------------------------------------------------------------
// Origen del RQR: por dónde llegó el reclamo
// ---------------------------------------------------------------------------
// Es distinto del canal de contacto del sistema: un cliente al que el sistema
// escribió por WhatsApp puede reclamar por mail o acercarse al mostrador.
export const ORIGENES_RQR_VW = [
  { valor: "EMAIL", etiqueta: "Email" },
  { valor: "TELEFONO", etiqueta: "Teléfono" },
  { valor: "WHATSAPP", etiqueta: "WhatsApp" },
  { valor: "PERSONALMENTE", etiqueta: "Comentario en persona" },
] as const;

export const ORIGENES_RQR_VALIDOS: Set<string> = new Set(ORIGENES_RQR_VW.map((o) => o.valor));

export function etiquetaOrigenRqr(valor: string | null | undefined): string {
  if (!valor) return "—";
  return ORIGENES_RQR_VW.find((o) => o.valor === valor)?.etiqueta ?? valor;
}

/** El código de sucursal de VW son 4 caracteres (lo define la carga de casos). */
export const LARGO_CODIGO_SUCURSAL = 4;
