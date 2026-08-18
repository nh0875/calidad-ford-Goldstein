// Áreas y subáreas del RQR de Volkswagen.
//
// Volkswagen clasifica cada reclamo por ÁREA (Ventas / Posventa / Plan de Ahorro)
// y por SUBÁREA dentro de esa área. Este catálogo sale de la hoja que definió la
// jefa de Calidad de VW (agosto 2026).
//
// Ford NO usa esto: su RQR se clasifica por causa raíz, no por subárea.
//
// OJO: este catálogo REEMPLAZA a una primera versión (más larga) que se había
// cargado de una hoja anterior. La lista buena es la de agosto 2026, confirmada
// con Calidad de VW.
//
// Decisiones de transcripción (revisar si cambian):
//  - Plan de Ahorro incluye TODAS las subáreas de Ventas ("+ Vtas" en la hoja).
//  - "At. Cte." tenía las encuestas anotadas entre paréntesis como un tercer
//    nivel; se despliegan como subáreas propias para que se elijan de un solo
//    desplegable sin perder el detalle.
//
// Sobre las encuestas de At. Cliente: SSI (ventas), OSI (posventa) y CEM las
// manda FÁBRICA, de forma ALEATORIA, a clientes elegidos por ella. La agencia no
// controla a quién le llegan. La "interna" es propia de la agencia.
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

// Ventas. Se define aparte porque Plan de Ahorro la REUSA entera (ver abajo).
const SUBAREAS_VENTAS: SubareaVW[] = [
  { valor: "VTA_PRODUCTO_PRECIO", etiqueta: "Producto / Precio" },
  { valor: "VTA_RECEPCION", etiqueta: "Recepción" },
  { valor: "VTA_ASESORAMIENTO", etiqueta: "Asesoramiento / Vendedor" },
  { valor: "VTA_ADM_GESTORIA", etiqueta: "Administración / Gestoría" },
  { valor: "VTA_PRE_ENTREGA", etiqueta: "Pre entrega" },
  { valor: "VTA_ENTREGA", etiqueta: "Entrega" },
  { valor: "VTA_USO_MANTENIMIENTO", etiqueta: "Uso / Mantenimiento" },
  // Atención al cliente, abierta por el origen de la encuesta: no es lo mismo un
  // reclamo que llega por una encuesta de FÁBRICA (CEM, SSI) —que impacta en los
  // índices que mide VW— que uno de una encuesta propia.
  { valor: "VTA_AT_CTE_INTERNA", etiqueta: "At. Cliente (enc. interna)" },
  { valor: "VTA_AT_CTE_CEM", etiqueta: "At. Cliente (enc. CEM)" },
  { valor: "VTA_AT_CTE_SSI", etiqueta: "At. Cliente (enc. SSI)" },
];

// Plan de Ahorro: las suyas MÁS todas las de Ventas. En la hoja de Calidad esto
// figura como "+ Vtas": un plan de ahorro termina en una venta, así que puede
// haber un reclamo de entrega, de gestoría o de producto igual que en Ventas.
// Se reusan los MISMOS códigos (VTA_*) a propósito: es el mismo concepto, y
// duplicarlos con otro prefijo partiría los reportes en dos.
const SUBAREAS_PLAN_DE_AHORRO: SubareaVW[] = [
  { valor: "PA_AGRUPAMIENTO", etiqueta: "Agrupamiento" },
  { valor: "PA_LICITACION_SORTEO", etiqueta: "Licitación / Sorteo" },
  { valor: "PA_ADJUDICACION", etiqueta: "Adjudicación" },
  { valor: "PA_CANCELACION_LIQUIDACION", etiqueta: "Cancelación / Liquidación" },
  { valor: "PA_SUSCRIPCION", etiqueta: "Suscripción" },
  { valor: "PA_PEDIDO_UNIDAD", etiqueta: "Pedido de unidad" },
  ...SUBAREAS_VENTAS,
];

const SUBAREAS_POSVENTA: SubareaVW[] = [
  { valor: "PV_TURNOS", etiqueta: "Turnos" },
  { valor: "PV_RECEPCION", etiqueta: "Recepción" },
  { valor: "PV_PRECIO", etiqueta: "Precio" },
  { valor: "PV_REPUESTOS", etiqueta: "Repuestos" },
  { valor: "PV_GARANTIA", etiqueta: "Garantía" },
  { valor: "PV_ASESORAMIENTO_SERVICIO", etiqueta: "Asesoramiento de Servicio" },
  { valor: "PV_LAVADO", etiqueta: "Lavado" },
  { valor: "PV_CONTROL_CALIDAD", etiqueta: "Control de Calidad" },
  { valor: "PV_AT_CTE_INTERNA", etiqueta: "At. Cliente (enc. interna)" },
  { valor: "PV_AT_CTE_CEM", etiqueta: "At. Cliente (enc. CEM)" },
  { valor: "PV_AT_CTE_OSI", etiqueta: "At. Cliente (enc. OSI)" },
];

export const SUBAREAS_VW: Record<AreaVW, SubareaVW[]> = {
  VENTAS: SUBAREAS_VENTAS,
  POSVENTA: SUBAREAS_POSVENTA,
  PLAN_DE_AHORRO: SUBAREAS_PLAN_DE_AHORRO,
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
