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

/**
 * ¿Este usuario ve la pestaña "Encuestas de fábrica PV"?
 *
 * Es la lista de promotores de Posventa de UNA provincia (hoy Mendoza): la
 * trabajan Calidad de Posventa de esa provincia y los administradores. Desde el
 * 23-09-2026 el resto no la ve ni con los gráficos (antes sí, y a Calidad de
 * Ventas le aparecía una pestaña que no es de su trabajo).
 *
 * Esconderla es comodidad: el backend responde 403 igual (encuesta-pv.controller).
 */
export function puedeVerEncuestasPV(
  usuario: { rol: string; area: string; sucursal?: string | null } | null,
  marca: { modulos: { encuestaFabricaPV: boolean }; sucursalEncuestaPV?: string | null }
): boolean {
  if (!marca.modulos.encuestaFabricaPV || !usuario) return false;
  if (usuario.rol === "ADMIN") return true;
  if (usuario.rol === "FIDELIZACION") return false;
  if (usuario.area === "VENTAS") return false;
  const suya = claveSucursal(usuario.sucursal);
  const deLaLista = claveSucursal(marca.sucursalEncuestaPV);
  // Sin provincia asignada ve todas; si la lista no declara provincia, no se filtra.
  if (!suya || !deLaLista) return true;
  return suya === deLaLista;
}

/** Para comparar provincias escritas distinto ("San Juan", "SAN JUAN"). */
function claveSucursal(valor: string | null | undefined): string {
  return (valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

// Tono del badge por área (para distinguirlas de un vistazo).
export function tonoArea(area: string | null | undefined): "azul" | "morado" | "gris" | "verde" {
  if (area === "VENTAS") return "azul";
  if (area === "POSVENTA") return "morado";
  if (area === "FIDELIZACION") return "verde";
  return "gris";
}
