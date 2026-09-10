// ---------------------------------------------------------------------------
// Con cuántos decimales viajan los números de los tableros y reportes
// ---------------------------------------------------------------------------
//
// POR QUÉ EXISTE ESTE ARCHIVO. Los promedios y porcentajes se venían redondeando
// a UN decimal, cada uno con su `Math.round(x * 1000) / 10` escrito a mano en el
// lugar donde hacía falta. Dos problemas con eso:
//
//   1. UN decimal no alcanza. Con 18 casos, 17 de cinco estrellas y uno de
//      cuatro, el promedio real es 4,9444: a un decimal queda 4,9 y a cero queda
//      5, o sea "todos perfectos". La pantalla mostraba 5 con un 94% de cinco
//      estrellas, que es exactamente el número que no hay que mostrar: dice que
//      no hay nada que mejorar cuando sí lo hay.
//   2. Repetida en veinte lugares, la fórmula se corrige en diecinueve.
//
// DOS decimales es la precisión que se eligió. Con los volúmenes de esta
// concesionaria —decenas o centenas de casos por período— alcanza para que
// ningún caso suelto desaparezca del promedio: un caso entre cien mueve la
// segunda decimal, así que se ve.

/** Decimales con los que se publican promedios y porcentajes. */
export const DECIMALES = 2;

const FACTOR = 10 ** DECIMALES;

/**
 * Redondea a la precisión de los tableros.
 *
 * Se redondea acá, en el servidor, y no en la pantalla: así el mismo número da
 * igual en el tablero, en el Excel exportado y en el reporte impreso. Cuando cada
 * pantalla redondeaba por su cuenta, el mismo dato aparecía distinto en dos
 * lados y no había forma de saber cuál estaba bien.
 */
export function redondear(valor: number): number {
  if (!Number.isFinite(valor)) return 0;
  return Math.round(valor * FACTOR) / FACTOR;
}

/**
 * Qué porcentaje es `parte` de `total`, ya redondeado.
 *
 * Con total en cero devuelve 0 y no NaN: un tablero recién estrenado, sin un solo
 * caso cargado, tiene que mostrar ceros y no "NaN%".
 */
export function porcentaje(parte: number, total: number): number {
  if (!total) return 0;
  return redondear((parte / total) * 100);
}

/**
 * El promedio de una lista, o null si no hay nada que promediar.
 *
 * NULL y no cero, a propósito: "todavía nadie puntuó" y "todos pusieron cero" son
 * cosas distintas, y un cero en el tablero se lee como un desastre cuando en
 * realidad no hay dato.
 */
export function promedio(suma: number, cantidad: number): number | null {
  if (!cantidad) return null;
  return redondear(suma / cantidad);
}
