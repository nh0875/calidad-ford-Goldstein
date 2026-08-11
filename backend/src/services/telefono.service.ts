// Normalización de teléfonos argentinos a E.164 para WhatsApp: +549 + área + número.
// Los Excel traen de todo: "0264 154 123456", "264-4123456", "+54 9 264 412 3456", etc.

export function normalizarTelefonoAR(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  let digitos = String(valor).replace(/\D/g, "");
  if (!digitos) return null;

  // Prefijo internacional: 0054... o 54...
  digitos = digitos.replace(/^00/, "");
  if (digitos.startsWith("54")) digitos = digitos.slice(2);

  // El "9" de móvil después del 54 (lo re-agregamos al final)
  if (digitos.startsWith("9") && digitos.length > 10) digitos = digitos.slice(1);

  // Prefijo de discado nacional: 0264... -> 264...
  digitos = digitos.replace(/^0+/, "");

  // El "15" local después del código de área (heurística: área de 2 a 4 dígitos).
  // "264154123456" (12 dígitos) -> "2644123456"
  if (digitos.length >= 11 && digitos.length <= 13) {
    for (const largoArea of [2, 3, 4]) {
      const resto = digitos.slice(largoArea);
      if (resto.startsWith("15") && largoArea + (resto.length - 2) === 10) {
        digitos = digitos.slice(0, largoArea) + resto.slice(2);
        break;
      }
    }
  }

  // Un móvil argentino sin prefijos tiene EXACTAMENTE 10 dígitos (área + abonado).
  // Se exige esa longitud: un número más corto (le falta el código de área) es
  // inservible para WhatsApp —no entrega, o peor, matchea a otra persona— así
  // que conviene rechazarlo en la carga y avisar, no crear un caso incontactable.
  if (digitos.length !== 10) return null;

  return `+549${digitos}`;
}

/**
 * Igual que `normalizarTelefonoAR`, pero tolera celdas que traen MÁS de un dato
 * en el mismo campo. La planilla de ventas de la agencia llega así:
 *   "2615600368 - DANIEL"        (número + a nombre de quién)
 *   "262215675300/62320"         (dos números separados por barra)
 *   "262215526707 - 02622-489201" (celular y fijo)
 *
 * Primero prueba la celda ENTERA —que es lo que resuelve la gran mayoría, porque
 * el normalizador ya descarta las letras— y recién si eso no da un móvil válido
 * va probando cada tramo por separado, devolviendo el primero que normalice.
 * Así "0261 153862753" (un solo número con espacio adentro) se sigue resolviendo
 * entero y no se rompe en dos pedazos inservibles.
 */
export function normalizarTelefonoARFlexible(valor: unknown): string | null {
  const directo = normalizarTelefonoAR(valor);
  if (directo) return directo;
  if (valor === null || valor === undefined) return null;

  for (const tramo of String(valor).split(/[/;,]|\s+-\s+|\s+/)) {
    const normalizado = normalizarTelefonoAR(tramo);
    if (normalizado) return normalizado;
  }
  return null;
}
