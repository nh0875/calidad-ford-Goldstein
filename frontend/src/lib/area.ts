// Área de negocio (VENTAS / POSVENTA). El filtro y el badge se muestran según
// el rol/área del usuario; el backend igual valida todo.

export const AREAS = ["VENTAS", "POSVENTA"] as const;
export type Area = (typeof AREAS)[number];

export const AREA_LABEL: Record<string, string> = {
  VENTAS: "Ventas",
  POSVENTA: "Posventa",
  AMBAS: "Ambas",
};

export function etiquetaArea(area: string | null | undefined): string {
  if (!area) return "—";
  return AREA_LABEL[area] ?? area;
}

// Tono del badge por área (para distinguirlas de un vistazo).
export function tonoArea(area: string | null | undefined): "azul" | "morado" | "gris" {
  if (area === "VENTAS") return "azul";
  if (area === "POSVENTA") return "morado";
  return "gris";
}
