import { AreaTrabajo, AreaUsuario, EstadoTareaRefuerzo, RolUsuario } from "@prisma/client";
import { prisma } from "../config/prisma";

// Estados "abiertos" (cuentan como carga de trabajo del empleado)
export const ESTADOS_ABIERTOS: EstadoTareaRefuerzo[] = [
  EstadoTareaRefuerzo.PENDIENTE,
  EstadoTareaRefuerzo.EN_GESTION,
];

// Usuarios elegibles para recibir tareas (activos, rol CALIDAD, que participan),
// con la cantidad de tareas ABIERTAS que ya tienen. Si se pasa `area`, solo los
// de esa área o de AMBAS (una tarea de VENTAS nunca va a un usuario de POSVENTA).
export async function usuariosElegiblesConCarga(
  area?: AreaTrabajo
): Promise<{ id: string; nombre: string; abiertas: number }[]> {
  const usuarios = await prisma.usuario.findMany({
    where: {
      activo: true,
      rol: RolUsuario.CALIDAD,
      participaEnRefuerzos: true,
      ...(area ? { area: { in: [area === AreaTrabajo.VENTAS ? AreaUsuario.VENTAS : AreaUsuario.POSVENTA, AreaUsuario.AMBAS] } } : {}),
    },
    select: { id: true, nombre: true },
    orderBy: { createdAt: "asc" },
  });
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
