// Encuesta de Posventa de Volkswagen: los 5 ítems que se miden por separado.
//
// POR QUÉ POR ÍTEM Y NO UNA NOTA SOLA: Posventa es un circuito con varias manos
// distintas —quien atiende, quien organiza el turno, quien repara, quien lava—.
// Con una sola nota, un taller que repara impecable pero entrega el auto sucio
// queda igual que uno que repara mal, y no hay forma de saber a quién ayudar.
// Midiendo cada ítem aparte, el área ve exactamente dónde está perdiendo.
//
// El cliente contesta las 5 en UN mensaje (ver textoPreguntasPorDefecto): pedir
// una por vez daba mejor detalle en teoría, pero en la práctica el cliente
// abandona a la mitad y WhatsApp cierra la ventana a las 24 hs.

export const ITEMS_POSVENTA = [
  "TRATO",
  "ORGANIZACION",
  "CALIDAD_REPARACION",
  "LAVADO",
  "GENERAL",
] as const;

export type ItemPosventa = (typeof ITEMS_POSVENTA)[number];

export interface DefinicionItem {
  item: ItemPosventa;
  /** Cómo se llama en pantallas y reportes. */
  etiqueta: string;
  /** La pregunta que se le manda al cliente. Corta y concreta. */
  pregunta: string;
  /** De qué se ocupa este ítem, para que el reporte se entienda solo. */
  descripcion: string;
}

export const DEFINICION_ITEMS: DefinicionItem[] = [
  {
    item: "TRATO",
    etiqueta: "Trato recibido",
    pregunta: "¿Cómo te trataron?",
    descripcion: "La atención de las personas: recepción, asesor, cajas.",
  },
  {
    item: "ORGANIZACION",
    etiqueta: "Organización",
    pregunta: "¿Qué tan organizada te resultó la atención?",
    descripcion: "Turnos, tiempos de espera, avisos y cumplimiento de lo prometido.",
  },
  {
    item: "CALIDAD_REPARACION",
    etiqueta: "Calidad de reparación",
    pregunta: "¿Cómo quedó el trabajo en tu vehículo?",
    descripcion: "El trabajo del taller: si quedó bien hecho y si el problema se resolvió.",
  },
  {
    item: "LAVADO",
    etiqueta: "Lavado de unidad",
    pregunta: "¿Cómo te entregaron el auto de limpieza?",
    descripcion: "Cómo se entrega la unidad: lavada, aspirada, sin manchas de grasa.",
  },
  {
    item: "GENERAL",
    etiqueta: "Satisfacción general",
    pregunta: "En general, ¿cómo estuvo tu visita al taller?",
    descripcion:
      "La visita como un todo. Es el ítem que define el semáforo del caso y el que puede abrir un RQR.",
  },
];

/**
 * El ítem que MANDA sobre el caso.
 *
 * De los 5, la satisfacción general es la que define el semáforo del caso y la
 * única que abre RQR. Los otros 4 se miden y salen en el reporte de desempeño,
 * pero no abren un reclamo formal por sí solos: con 5 ítems es casi seguro que
 * alguno no sea 5, y abrir RQR por cada uno inundaría a Calidad de reclamos que
 * en realidad son "el lavado estuvo flojo" en una visita por lo demás buena.
 */
export const ITEM_QUE_DEFINE_EL_CASO: ItemPosventa = "GENERAL";

export function etiquetaItem(item: string): string {
  return DEFINICION_ITEMS.find((d) => d.item === item)?.etiqueta ?? item;
}

export function esItemPosventa(valor: unknown): valor is ItemPosventa {
  return typeof valor === "string" && (ITEMS_POSVENTA as readonly string[]).includes(valor);
}

/**
 * El mensaje que se le manda al cliente cuando aprieta "Quiero participar por
 * WhatsApp". Es el valor por defecto: Calidad lo puede editar desde
 * Configuración sin tocar el código.
 *
 * Se numera y se pide "del 1 al 5" a propósito: así el cliente puede contestar
 * "5 4 5 3 4" y se entiende sin ambigüedad. Igual la IA lee la respuesta en
 * prosa, porque muchos contestan "todo bien menos el lavado".
 */
export function textoPreguntasPorDefecto(): string {
  const lista = DEFINICION_ITEMS.map((d, i) => `${i + 1}. ${d.pregunta}`).join("\n");
  return (
    "¡Gracias por participar! Son 5 preguntas cortas. " +
    "Puntuá cada una del 1 al 5, donde 5 es lo mejor:\n\n" +
    lista +
    "\n\nPodés responder así: 5 4 5 3 4\n" +
    "Y si querés contarnos algo, escribilo: nos sirve muchísimo."
  );
}
