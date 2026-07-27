import { AreaTrabajo, AreaUsuario, EstadoTareaRefuerzo } from "@prisma/client";
import { prisma } from "../config/prisma";
import { claveNormalizada } from "./normalizacion.service";

/** ¿Coincide la provincia del usuario con la del caso? Insensible a mayúsculas
 * y ACENTOS ("Córdoba" == "Cordoba"). Un usuario sin sucursal (null) atiende todas. */
export function mismaProvincia(sucursalUsuario: string | null, sucursalCaso: string | null | undefined): boolean {
  if (!sucursalUsuario) return true; // atiende todas
  return claveNormalizada(sucursalUsuario) === claveNormalizada(sucursalCaso ?? "");
}

// Estados "abiertos" (cuentan como carga de trabajo del empleado)
export const ESTADOS_ABIERTOS: EstadoTareaRefuerzo[] = [
  EstadoTareaRefuerzo.PENDIENTE,
  EstadoTareaRefuerzo.EN_GESTION,
];

// Usuarios elegibles para recibir tareas: activos y que PARTICIPAN de los
// refuerzos, con la cantidad de tareas ABIERTAS que ya tienen. El control es
// `participaEnRefuerzos`, NO el rol: si el admin también gestiona casos (típico
// cuando una sola persona opera el sistema), recibe tareas; para que un admin
// solo supervise, se pone su `participaEnRefuerzos` en false.
//
// Se filtra por ÁREA y por PROVINCIA (sucursal) del caso, para no mezclar:
//  - área:      solo los de esa área o de AMBAS (una tarea de VENTAS nunca va a POSVENTA).
//  - provincia: solo los de esa sucursal o los "sin sucursal" (null = todas)
//               (una tarea de un caso de Mendoza nunca va a alguien de San Juan).
export async function usuariosElegiblesConCarga(
  area?: AreaTrabajo,
  sucursal?: string | null
): Promise<{ id: string; nombre: string; abiertas: number }[]> {
  // El ÁREA se filtra en la base (barato). La PROVINCIA se filtra en JS con
  // claveNormalizada, insensible a mayúsculas Y acentos: el ILIKE de Postgres
  // pliega mayúsculas pero NO tildes, y una provincia como "Córdoba" cargada de
  // dos formas ("Cordoba"/"Córdoba") no matchearía. La tabla de usuarios es
  // chica (el equipo), así que traerla y filtrar en memoria no cuesta nada.
  const candidatos = await prisma.usuario.findMany({
    where: {
      activo: true,
      participaEnRefuerzos: true,
      ...(area ? { area: { in: [area === AreaTrabajo.VENTAS ? AreaUsuario.VENTAS : AreaUsuario.POSVENTA, AreaUsuario.AMBAS] } } : {}),
    },
    select: { id: true, nombre: true, sucursal: true },
    orderBy: { createdAt: "asc" },
  });
  const suc = sucursal?.trim();
  const usuarios = suc ? candidatos.filter((u) => mismaProvincia(u.sucursal, suc)) : candidatos;
  if (usuarios.length === 0) return [];

  const cargas = await prisma.tareaRefuerzo.groupBy({
    by: ["asignadoAId"],
    where: { estado: { in: ESTADOS_ABIERTOS }, asignadoAId: { in: usuarios.map((u) => u.id) } },
    _count: { _all: true },
  });
  const mapa: Record<string, number> = {};
  for (const c of cargas) if (c.asignadoAId) mapa[c.asignadoAId] = c._count._all;

  return usuarios.map((u) => ({ id: u.id, nombre: u.nombre, abiertas: mapa[u.id] ?? 0 }));
}

/**
 * Reparto equitativo: siempre asigna al que menos tareas abiertas tiene; ante
 * empate, rota (round-robin) porque tras cada asignación se re-ordena y el
 * recién elegido queda con una más. Mantiene el conteo en memoria durante la
 * importación para balancear también las tareas nuevas entre sí.
 */
export class Repartidor {
  constructor(private cola: { id: string; nombre: string; abiertas: number }[]) {}

  get hayUsuarios(): boolean {
    return this.cola.length > 0;
  }

  siguiente(): string | null {
    if (this.cola.length === 0) return null;
    this.cola.sort((a, b) => a.abiertas - b.abiertas);
    const elegido = this.cola[0];
    elegido.abiertas += 1;
    return elegido.id;
  }
}

// ¿Tiene el caso una tarea abierta (para idempotencia ante re-cargas)?
export async function tareaAbiertaDelCaso(casoId: string) {
  return prisma.tareaRefuerzo.findFirst({
    where: { casoId, estado: { in: ESTADOS_ABIERTOS } },
  });
}

// Cantidad de tareas PENDIENTES del usuario (para el badge del sidebar)
export async function contarPendientesDe(usuarioId: string): Promise<number> {
  return prisma.tareaRefuerzo.count({
    where: { asignadoAId: usuarioId, estado: EstadoTareaRefuerzo.PENDIENTE },
  });
}
