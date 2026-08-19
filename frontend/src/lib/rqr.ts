/**
 * El nombre del cliente de un RQR, igual que lo calcula el backend
 * (nombreClienteRqr en rqr.service.ts). "Anónimo" es un DATO —el cliente no
 * quiso identificarse— y no lo mismo que "(sin datos)", que es un dato que falta.
 */
export function nombreClienteRqr(rqr: {
  clienteAnonimo?: boolean | null;
  nombreClienteManual?: string | null;
  caso?: { nombrePropietario?: string | null } | null;
}): string {
  const delCaso = rqr.caso?.nombrePropietario?.trim();
  if (delCaso) return delCaso;
  if (rqr.clienteAnonimo) return "Anónimo";
  return rqr.nombreClienteManual?.trim() || "(sin datos)";
}
