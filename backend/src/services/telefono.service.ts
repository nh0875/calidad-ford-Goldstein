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

  // Un número argentino sin prefijos tiene 10 dígitos (área + abonado).
  // Aceptamos 8-10 por si falta el código de área en cargas viejas.
  if (digitos.length < 8 || digitos.length > 11) return null;

  return `+549${digitos}`;
}
