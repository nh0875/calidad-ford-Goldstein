// Espejo de CATEGORIAS_CAUSA_RAIZ del backend (sentiment.service.ts)
export const CATEGORIAS_CAUSA_RAIZ = [
  "DEMORA_SERVICIO",
  "MAL_TRATO_PERSONAL",
  "PRECIO_FACTURACION",
  "CALIDAD_TRABAJO",
  "FALTA_COMUNICACION",
  "REPUESTOS",
  "OTRO",
] as const;

export const ETIQUETA_CATEGORIA: Record<string, string> = {
  DEMORA_SERVICIO: "Demora en el servicio",
  MAL_TRATO_PERSONAL: "Mal trato del personal",
  PRECIO_FACTURACION: "Precio / facturación",
  CALIDAD_TRABAJO: "Calidad del trabajo",
  FALTA_COMUNICACION: "Falta de comunicación",
  REPUESTOS: "Repuestos",
  OTRO: "Otro",
};

export function etiquetaCategoria(categoria: string | null): string {
  if (!categoria) return "(sin categoría)";
  return ETIQUETA_CATEGORIA[categoria] ?? categoria;
}

export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "-";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
