import { AreaTrabajo, AreaUsuario, RolUsuario } from "@prisma/client";

// Helper CENTRAL de la separación por área. Una sola fuente de verdad para
// decidir qué área ve/gestiona un usuario, usada en TODOS los endpoints.

export interface UsuarioArea {
  rol: RolUsuario;
  area: AreaUsuario;
}

/**
 * Área a la que está RESTRINGIDO el usuario:
 *  - null  = sin restricción (ADMIN, o CALIDAD con área AMBAS): ve todo
 *  - VENTAS/POSVENTA = solo esa área
 */
export function areaPermitida(usuario: UsuarioArea): AreaTrabajo | null {
  if (usuario.rol === RolUsuario.ADMIN) return null;
  if (usuario.area === AreaUsuario.AMBAS) return null;
  return usuario.area === AreaUsuario.VENTAS ? AreaTrabajo.VENTAS : AreaTrabajo.POSVENTA;
}

/**
 * Área efectiva de un listado: combina la restricción del usuario con un filtro
 * OPCIONAL pedido por query (?area=). Un usuario restringido SIEMPRE ve su área
 * (ignora lo pedido); un no restringido ve lo que pida, o todo si no pide nada.
 */
export function areaEfectiva(usuario: UsuarioArea, areaSolicitada?: AreaTrabajo | null): AreaTrabajo | null {
  const permitida = areaPermitida(usuario);
  if (permitida) return permitida;
  return areaSolicitada ?? null;
}

/** Fragmento Prisma `{ area }` para filtrar; vacío = sin restricción. */
export function whereArea(usuario: UsuarioArea, areaSolicitada?: AreaTrabajo | null): { area?: AreaTrabajo } {
  const a = areaEfectiva(usuario, areaSolicitada);
  return a ? { area: a } : {};
}

/** ¿El usuario puede acceder a un recurso de esta área? (para 403 cruzado) */
export function puedeAcceder(usuario: UsuarioArea, areaRecurso: AreaTrabajo): boolean {
  const permitida = areaPermitida(usuario);
  return permitida === null || permitida === areaRecurso;
}

/** Parseo del query param ?area= (solo VENTAS/POSVENTA; cualquier otra cosa = null). */
export function parsearAreaQuery(valor: unknown): AreaTrabajo | null {
  const v = String(valor ?? "").toUpperCase();
  if (v === "VENTAS") return AreaTrabajo.VENTAS;
  if (v === "POSVENTA") return AreaTrabajo.POSVENTA;
  return null;
}
