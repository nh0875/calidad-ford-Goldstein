// ---------------------------------------------------------------------------
// Cómo se escriben los números en pantalla
// ---------------------------------------------------------------------------
//
// POR QUÉ EXISTE ESTO. Los indicadores del tablero se dibujaban con
// `Math.round(v)`: todo a número entero. Con 18 casos —17 de cinco estrellas y
// uno de cuatro— el promedio real es 4,94 y la pantalla mostraba **5**, o sea
// "todos perfectos" con un 94% de cinco estrellas. Ese es exactamente el número
// que no hay que mostrar: dice que no hay nada que mejorar cuando sí lo hay.
//
// Y además se escribían con punto decimal (4.94), que en Argentina se lee como
// separador de miles. Acá se centraliza el formato para que un número se vea
// igual en todo el sistema.

/** Con cuántos decimales se muestran promedios y porcentajes. */
export const DECIMALES = 2;

/**
 * Un número tal como se escribe en castellano rioplatense: coma para los
 * decimales, punto para los miles.
 *
 * `decimales` en 0 para lo que se CUENTA (casos, RQR abiertos, clientes): ahí un
 * decimal no significa nada y solo ensucia. Los promedios y porcentajes van con
 * dos, que es lo que hace falta para que un caso suelto no desaparezca.
 */
export function numero(valor: number, decimales = 0): string {
  if (!Number.isFinite(valor)) return "—";
  return valor.toLocaleString("es-AR", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

/**
 * Un porcentaje ya listo para mostrar, con su signo.
 *
 * Recibe el valor YA calculado por el backend (94.44), no la fracción: el cálculo
 * y el redondeo viven del lado del servidor para que el mismo dato dé igual en el
 * tablero, en el Excel exportado y en el reporte impreso.
 */
export function porcentaje(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return "—";
  return `${numero(valor, DECIMALES)}%`;
}

/**
 * Un promedio, o una raya cuando no hay nada que promediar.
 *
 * La raya y no un cero: "todavía nadie puntuó" y "todos pusieron cero" son cosas
 * distintas, y un cero en el tablero se lee como un desastre cuando en realidad
 * no hay dato.
 */
export function promedio(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return "—";
  return numero(valor, DECIMALES);
}
