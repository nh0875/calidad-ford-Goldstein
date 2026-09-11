// Las causas raíz con las que se clasifica un RQR.
//
// NO son una lista fija acá: salen del perfil de la marca (/api/marca). Calidad
// de Ford y Calidad de Volkswagen nombran distinto por qué falló algo, y antes
// esta lista era una copia escrita a mano de la del backend — dos listas que hay
// que acordarse de cambiar juntas terminan diciendo cosas distintas, y la
// pantalla ofrece una categoría que el servidor rechaza.
import { getMarca } from "./marca";

/** Los códigos de causa raíz de esta marca, en el orden en que se ofrecen. */
export function causasRaiz(): Array<{ codigo: string; etiqueta: string }> {
  return getMarca().causasRaiz;
}

/**
 * Cómo se llama en pantalla.
 *
 * Si el código no está en la lista de la marca se muestra tal cual. Pasa con lo
 * que quedó de una lista anterior: es feo a propósito, porque significa "esto
 * hay que reclasificarlo" y esconderlo detrás de un nombre lindo haría que nadie
 * lo note.
 */
export function etiquetaCategoria(categoria: string | null): string {
  if (!categoria) return "(sin categoría)";
  return causasRaiz().find((c) => c.codigo === categoria)?.etiqueta ?? categoria;
}

export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "-";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
