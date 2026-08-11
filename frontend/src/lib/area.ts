// Área de negocio (VENTAS / POSVENTA). El filtro y el badge se muestran según
// el rol/área del usuario; el backend igual valida todo.

export const AREAS = ["VENTAS", "POSVENTA"] as const;
export type Area = (typeof AREAS)[number];

export const AREA_LABEL: Record<string, string> = {
  VENTAS: "Ventas",
  POSVENTA: "Posventa",
  AMBAS: "Ambas",
  // Fidelización no es un área del Caso, pero en Seguimiento aparece como una
  // categoría más (recordatorio de service), así que necesita su etiqueta/tono.
  FIDELIZACION: "Fidelización",
  // Valor SOLO de filtro en Seguimiento: agrupa Ventas + Posventa, es decir
  // todo el Contacto Posterior, para separarlo de Fidelización de un clic.
  CONTACTO: "Contacto Posterior",
};

export function etiquetaArea(area: string | null | undefined): string {
  if (!area) return "—";
  return AREA_LABEL[area] ?? area;
}

// Tono del badge por área (para distinguirlas de un vistazo).
export function tonoArea(area: string | null | undefined): "azul" | "morado" | "gris" | "verde" {
  if (area === "VENTAS") return "azul";
  if (area === "POSVENTA") return "morado";
  if (area === "FIDELIZACION") return "verde";
  return "gris";
}
