import { AreaTrabajo, AreaUsuario, RolUsuario } from "@prisma/client";
import { prisma } from "../config/prisma";
import { claveNormalizada } from "./normalizacion.service";

// Helper CENTRAL de la separación por área. Una sola fuente de verdad para
// decidir qué área ve/gestiona un usuario, usada en TODOS los endpoints.

export interface UsuarioArea {
  rol: RolUsuario;
  area: AreaUsuario;
  /** Provincia asignada. null o vacío = atiende TODAS. */
  sucursal?: string | null;
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

// ---------------------------------------------------------------------------
// Separación por PROVINCIA
// ---------------------------------------------------------------------------
//
// El área dice QUÉ mira un usuario (Ventas o Posventa); la provincia dice DE
// DÓNDE. Las dos restricciones son independientes y se aplican juntas: alguien
// de Posventa en Mendoza ve los casos de Posventa de Mendoza, y nada más.
//
// Regla, igual que en Refuerzos y Fidelización: `sucursal` vacía = ve todas las
// provincias. Vale también para el ADMIN — si se le asigna una provincia, queda
// restringido a ella, que es justamente lo que se pidió: "cuando cambio la
// provincia de un usuario, solo debería ver la suya".
//
// POR QUÉ SE RESUELVE CONTRA LOS VALORES DE LA BASE Y NO CON UN `equals`:
// Postgres no pliega los acentos, y las sucursales llegan escritas como venga en
// el Excel ("San Juan", "SAN JUAN", "San Júan"). Comparar en SQL dejaría casos
// afuera en silencio. Acá se traen las sucursales distintas —son un puñado—, se
// comparan con la MISMA función que usa el resto del sistema (claveNormalizada,
// la de mismaProvincia) y se filtra con un `in` sobre las que coinciden. Así el
// filtro es exacto y la paginación sigue resolviéndose en SQL.

export function provinciaPermitida(usuario: UsuarioArea): string | null {
  const s = (usuario.sucursal ?? "").trim();
  return s === "" ? null : s;
}

// Las sucursales distintas cambian solo cuando se importa un Excel nuevo, así
// que se cachean un rato: si no, sería una consulta extra por cada listado.
let cacheSucursales: { valores: string[]; hasta: number } | null = null;
const CACHE_MS = 60_000;

async function sucursalesConocidas(): Promise<string[]> {
  const ahora = Date.now();
  if (cacheSucursales && cacheSucursales.hasta > ahora) return cacheSucursales.valores;
  const filas = await prisma.caso.findMany({
    distinct: ["sucursal"],
    select: { sucursal: true },
  });
  const valores = filas.map((f) => f.sucursal).filter((s): s is string => !!s);
  cacheSucursales = { valores, hasta: ahora + CACHE_MS };
  return valores;
}

/** Se vacía el caché al importar, para que una sucursal nueva se vea enseguida. */
export function olvidarSucursalesConocidas(): void {
  cacheSucursales = null;
}

/**
 * Fragmento Prisma con las DOS restricciones (área + provincia), para los
 * listados de casos. Reemplaza a `whereArea` en todo lo que consulte Caso.
 */
export async function whereVisible(
  usuario: UsuarioArea,
  areaSolicitada?: AreaTrabajo | null
): Promise<{ area?: AreaTrabajo; sucursal?: { in: string[] } }> {
  const base = whereArea(usuario, areaSolicitada);
  const provincia = provinciaPermitida(usuario);
  if (!provincia) return base;

  const clave = claveNormalizada(provincia);
  const coinciden = (await sucursalesConocidas()).filter((s) => claveNormalizada(s) === clave);
  // Si no coincide ninguna, el usuario no ve NADA de casos: un `in: []` vacío es
  // exactamente eso, y es lo correcto. Lo peligroso sería lo contrario (que al no
  // encontrar la provincia se le mostrara todo).
  return { ...base, sucursal: { in: coinciden } };
}

/** ¿Puede acceder a un registro suelto? Área Y provincia. */
export function puedeVer(
  usuario: UsuarioArea,
  recurso: { area: AreaTrabajo; sucursal: string | null | undefined }
): boolean {
  if (!puedeAcceder(usuario, recurso.area)) return false;
  const provincia = provinciaPermitida(usuario);
  if (!provincia) return true;
  return claveNormalizada(provincia) === claveNormalizada(recurso.sucursal ?? "");
}
