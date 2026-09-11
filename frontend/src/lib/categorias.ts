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
/**
 * Cómo se nombra un RQR al que todavía le falta la causa. Tiene que decir lo
 * mismo que FALTA_CLASIFICAR en el backend (causa-raiz.service.ts), que es con
 * lo que se rotula ese grupo en los reportes.
 */
export const FALTA_CLASIFICAR = "Falta clasificar";

/**
 * Cómo se llama en pantalla.
 *
 * Sin causa NO se dice "(sin categoría)": eso se leía como una clasificación
 * más, un lugar válido donde dejar el RQR. Es una tarea pendiente, y el nombre
 * lo tiene que decir.
 *
 * Si el código no está en la lista de la marca se muestra tal cual. Pasa con lo
 * que quedó de una lista anterior: es feo a propósito, porque significa "esto
 * hay que reclasificarlo" y esconderlo detrás de un nombre lindo haría que nadie
 * lo note.
 */
export function etiquetaCategoria(categoria: string | null): string {
  if (!categoria) return FALTA_CLASIFICAR;
  return causasRaiz().find((c) => c.codigo === categoria)?.etiqueta ?? categoria;
}

export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "-";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
