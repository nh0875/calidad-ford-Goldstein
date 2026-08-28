import { AreaTrabajo, AreaUsuario, EstadoTareaRefuerzo, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { claveNormalizada } from "./normalizacion.service";

/** ¿Coincide la provincia del usuario con la del caso? Insensible a mayúsculas
 * y ACENTOS ("Córdoba" == "Cordoba"). Un usuario sin sucursal (null) atiende todas. */
export function mismaProvincia(sucursalUsuario: string | null, sucursalCaso: string | null | undefined): boolean {
  if (!sucursalUsuario) return true; // atiende todas
  return claveNormalizada(sucursalUsuario) === claveNormalizada(sucursalCaso ?? "");
}

// Estados "abiertos": la tarea todavía está para trabajar (pendiente o en gestión).
export const ESTADOS_ABIERTOS: EstadoTareaRefuerzo[] = [
  EstadoTareaRefuerzo.PENDIENTE,
  EstadoTareaRefuerzo.EN_GESTION,
];

// Áreas de caso que VE un usuario según su AreaUsuario. null = ve todas (AMBAS).
export function areasVisiblesPara(areaUsuario: AreaUsuario): AreaTrabajo[] | null {
  if (areaUsuario === AreaUsuario.AMBAS) return null;
  return areaUsuario === AreaUsuario.VENTAS ? [AreaTrabajo.VENTAS] : [AreaTrabajo.POSVENTA];
}

/**
 * MODELO DE POOL COMPARTIDO: las tareas de refuerzo NO tienen dueño. Cada
 * empleado ve TODAS las tareas de su ÁREA + PROVINCIA. Este where filtra por
 * ÁREA (en la base). La PROVINCIA NO se filtra acá porque Postgres no pliega
 * acentos ("San Juan"/"San Juán"): se filtra en JS con mismaProvincia sobre
 * caso.sucursal DESPUÉS de traer las filas. asignadoAId ya no es "dueño": es
 * "gestor" (quién la está trabajando / la completó), y null = en el pool, sin tomar.
 */
export function wherePoolArea(
  areaUsuario: AreaUsuario,
  estados?: EstadoTareaRefuerzo[]
): Prisma.TareaRefuerzoWhereInput {
  const areas = areasVisiblesPara(areaUsuario);
  return {
    ...(estados ? { estado: { in: estados } } : {}),
    caso: { eliminadoEn: null, ...(areas ? { area: { in: areas } } : {}) },
  };
}

// ¿Tiene el caso una tarea abierta (para idempotencia ante re-cargas)?
export async function tareaAbiertaDelCaso(casoId: string) {
  return prisma.tareaRefuerzo.findFirst({
    where: { casoId, estado: { in: ESTADOS_ABIERTOS } },
  });
}

// Integrantes del pool de un área+provincia: usuarios activos que participan de
// los refuerzos y le corresponde esa área+provincia. Sirve para DETECTAR pools
// sin nadie (tareas que nadie vería) al importar. El control es
// `participaEnRefuerzos`, no el rol.
export async function usuariosDelPool(
  area?: AreaTrabajo,
  sucursal?: string | null
): Promise<{ id: string; nombre: string }[]> {
  const candidatos = await prisma.usuario.findMany({
    where: {
      activo: true,
      participaEnRefuerzos: true,
      // El rol FIDELIZACION nunca reparte tareas de refuerzo: no trabaja
      // Contacto Posterior. Sin esto entraria solo al pool (participaEnRefuerzos
      // viene en true por defecto y el alta de usuarios ni siquiera lo pide), y
      // el sistema creeria que el area esta cubierta: dejaria de avisar que esas
      // tareas no las esta mirando nadie.
      rol: { not: "FIDELIZACION" },
      ...(area
        ? { area: { in: [area === AreaTrabajo.VENTAS ? AreaUsuario.VENTAS : AreaUsuario.POSVENTA, AreaUsuario.AMBAS] } }
        : {}),
    },
    select: { id: true, nombre: true, sucursal: true },
    orderBy: { createdAt: "asc" },
  });
  const suc = sucursal?.trim();
  const usuarios = suc ? candidatos.filter((u) => mismaProvincia(u.sucursal, suc)) : candidatos;
  return usuarios.map((u) => ({ id: u.id, nombre: u.nombre }));
}

// Cantidad de tareas PENDIENTES del POOL del usuario (para el badge del sidebar).
// Trae las pendientes de su área y filtra la provincia en JS (acentos).
export async function contarPendientesDelPool(usuario: {
  area: AreaUsuario;
  sucursal: string | null;
}): Promise<number> {
  const tareas = await prisma.tareaRefuerzo.findMany({
    where: wherePoolArea(usuario.area, [EstadoTareaRefuerzo.PENDIENTE]),
    select: { id: true, caso: { select: { sucursal: true } } },
  });
  return tareas.filter((t) => mismaProvincia(usuario.sucursal, t.caso.sucursal)).length;
}
