import { Request, Response } from "express";
import {
  AreaTrabajo,
  EstadoTareaRefuerzo,
  Prisma,
  ResultadoTareaRefuerzo,
  TipoTareaRefuerzo,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { ACCIONES, auditar } from "../services/audit.service";
import {
  ESTADOS_ABIERTOS,
  contarPendientesDelPool,
  mismaProvincia,
  usuariosDelPool,
  wherePoolArea,
} from "../services/refuerzo.service";
import { claveNormalizada } from "../services/normalizacion.service";
import { estaSuprimido, telefonosSuprimidos } from "../services/supresion.service";
import { parsearAreaQuery, puedeAcceder, whereArea } from "../services/area.service";

// MODELO DE POOL: las tareas NO tienen dueño. asignadoA = "gestor" (quién la está
// trabajando / la completó), null = en el pool sin tomar. Cada empleado ve TODAS
// las tareas de su área + provincia.

const INCLUDE_TAREA = {
  caso: {
    select: {
      id: true,
      numeroOrden: true,
      nombrePropietario: true,
      whatsapp: true,
      celular: true,
      emailPropietario: true,
      modelo: true,
      area: true,
      sucursal: true,
      telefonosNorm: true,
      fechaSalida: true,
      fechaProgramacion: true,
      tieneRqrAbierto: true,
      encuestaFordEstado: true,
      analisis: {
        where: { esSeguimiento: false }, // la clasificación que cuenta del caso
        orderBy: { analyzedAt: "desc" as const },
        take: 1,
        select: { semaforo: true },
      },
    },
  },
  asignadoA: { select: { id: true, nombre: true, activo: true } }, // gestor (quién la trabaja)
} satisfies Prisma.TareaRefuerzoInclude;

type TareaConCaso = { caso: { telefonosNorm: string[]; sucursal: string | null } | null };
function marcarSupresion<T extends TareaConCaso>(tareas: T[], suprimidos: Set<string>) {
  return tareas.map((t) => ({
    ...t,
    suprimido: t.caso ? estaSuprimido(t.caso.telefonosNorm, suprimidos) : false,
  }));
}

// ---------- GET /api/refuerzos/mias (POOL del usuario: área + provincia) ----------

export async function misTareas(req: Request, res: Response) {
  const estado = req.query.estado as EstadoTareaRefuerzo | undefined;
  const soloAbiertas = !estado;
  const [tareasRaw, suprimidos] = await Promise.all([
    prisma.tareaRefuerzo.findMany({
      where: wherePoolArea(req.usuario!.area, estado ? [estado] : ESTADOS_ABIERTOS),
      orderBy: { creadaEn: "asc" },
      include: INCLUDE_TAREA,
    }),
    telefonosSuprimidos(),
  ]);
  // Provincia en JS (Postgres no pliega acentos): el usuario ve su provincia, o
  // todas si su sucursal es null.
  const tareas = tareasRaw.filter((t) => mismaProvincia(req.usuario!.sucursal, t.caso?.sucursal));
  res.json({ data: marcarSupresion(tareas, suprimidos), soloAbiertas });
}

export async function misPendientes(req: Request, res: Response) {
  res.json({
    pendientes: await contarPendientesDelPool({ area: req.usuario!.area, sucursal: req.usuario!.sucursal }),
  });
}

// ---------- GET /api/refuerzos (vista admin: todas, con filtros) ----------

const listSchema = z.object({
  asignadoAId: z.string().trim().min(1).optional(), // ahora = gestor
  estado: z.nativeEnum(EstadoTareaRefuerzo).optional(),
  tipo: z.nativeEnum(TipoTareaRefuerzo).optional(),
  resultado: z.nativeEnum(ResultadoTareaRefuerzo).optional(),
  origenUploadId: z.string().trim().min(1).optional(),
  sinTomar: z.enum(["true"]).optional(), // tareas del pool que nadie tomó todavía
});

export async function listarTareas(req: Request, res: Response) {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Filtros inválidos." });
  const q = parsed.data;

  const where: Prisma.TareaRefuerzoWhereInput = {
    caso: { eliminadoEn: null, ...whereArea(req.usuario!, parsearAreaQuery(req.query.area)) },
    ...(q.sinTomar ? { asignadoAId: null } : q.asignadoAId ? { asignadoAId: q.asignadoAId } : {}),
    ...(q.estado ? { estado: q.estado } : {}),
    ...(q.tipo ? { tipo: q.tipo } : {}),
    ...(q.resultado ? { resultado: q.resultado } : {}),
    ...(q.origenUploadId ? { origenUploadId: q.origenUploadId } : {}),
  };

  const LIMITE = 500;
  const [total, tareas, suprimidos] = await Promise.all([
    prisma.tareaRefuerzo.count({ where }),
    prisma.tareaRefuerzo.findMany({ where, orderBy: { creadaEn: "desc" }, take: LIMITE, include: INCLUDE_TAREA }),
    telefonosSuprimidos(),
  ]);
  res.json({ data: marcarSupresion(tareas, suprimidos), total, truncado: total > LIMITE, limite: LIMITE });
}

// ---------- GET /api/refuerzos/resumen-empleados (vista admin: por POOL) ----------
// Ya no hay "carga por empleado" (el backlog es del pool, no de una persona). Se
// muestra el estado de cada POOL (área+provincia) y, para productividad, cuántas
// completó cada gestor.

export async function resumenEmpleados(req: Request, res: Response) {
  const areaCaso = { eliminadoEn: null, ...whereArea(req.usuario!, parsearAreaQuery(req.query.area)) };
  const tareas = await prisma.tareaRefuerzo.findMany({
    where: { caso: areaCaso },
    select: {
      estado: true,
      asignadoAId: true,
      caso: { select: { area: true, sucursal: true } },
      asignadoA: { select: { nombre: true } },
    },
  });

  const pools = new Map<
    string,
    { area: string; sucursal: string; pendientes: number; enGestion: number; completadas: number; canceladas: number }
  >();
  const porGestor = new Map<string, { nombre: string; completadas: number }>();

  for (const t of tareas) {
    const area = t.caso?.area ?? "—";
    const sucursal = (t.caso?.sucursal ?? "").trim() || "(sin provincia)";
    const key = `${area}|${claveNormalizada(sucursal)}`;
    const p = pools.get(key) ?? { area, sucursal, pendientes: 0, enGestion: 0, completadas: 0, canceladas: 0 };
    if (t.estado === "PENDIENTE") p.pendientes++;
    else if (t.estado === "EN_GESTION") p.enGestion++;
    else if (t.estado === "COMPLETADA") p.completadas++;
    else if (t.estado === "CANCELADA") p.canceladas++;
    pools.set(key, p);

    if (t.estado === "COMPLETADA" && t.asignadoAId) {
      const g = porGestor.get(t.asignadoAId) ?? { nombre: t.asignadoA?.nombre ?? "—", completadas: 0 };
      g.completadas++;
      porGestor.set(t.asignadoAId, g);
    }
  }

  // Pools sin ningún integrante = tareas que NADIE ve (hay que resolverlo).
  const poolsData = await Promise.all(
    [...pools.values()].map(async (p) => {
      const areaEnum =
        p.area === "VENTAS" ? AreaTrabajo.VENTAS : p.area === "POSVENTA" ? AreaTrabajo.POSVENTA : undefined;
      const gente = await usuariosDelPool(areaEnum, p.sucursal === "(sin provincia)" ? null : p.sucursal);
      return { ...p, integrantes: gente.length, sinGente: gente.length === 0 };
    })
  );

  res.json({
    pools: poolsData.sort((a, b) => b.pendientes + b.enGestion - (a.pendientes + a.enGestion)),
    porGestor: [...porGestor.entries()]
      .map(([id, g]) => ({ id, ...g }))
      .sort((a, b) => b.completadas - a.completadas),
  });
}

// ---------- PATCH /api/refuerzos/:id (gestión de una tarea del pool) ----------
// Cualquier integrante del pool (misma área + provincia) puede gestionarla.

const patchSchema = z
  .object({
    estado: z.nativeEnum(EstadoTareaRefuerzo).optional(),
    resultado: z.nativeEnum(ResultadoTareaRefuerzo).nullable().optional(),
    notas: z.string().trim().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Indicá al menos un cambio." });

export async function patchTarea(req: Request, res: Response) {
  const parsed = patchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Datos inválidos." });
  }

  const tarea = await prisma.tareaRefuerzo.findUnique({
    where: { id: req.params.id },
    include: { caso: { select: { area: true, sucursal: true } }, asignadoA: { select: { nombre: true } } },
  });
  if (!tarea) return res.status(404).json({ message: "No se encontró la tarea." });

  // Pertenencia al POOL: misma área Y misma provincia (ADMIN/AMBAS/sin sucursal, sin límite).
  if (!puedeAcceder(req.usuario!, tarea.caso.area)) {
    return res.status(403).json({ message: "Esta tarea es de otra área; no tenés acceso." });
  }
  if (!mismaProvincia(req.usuario!.sucursal, tarea.caso.sucursal)) {
    return res.status(403).json({ message: "Esta tarea es de otra provincia; no tenés acceso." });
  }

  const c = parsed.data;
  const seCompleta = c.estado === EstadoTareaRefuerzo.COMPLETADA && tarea.estado !== EstadoTareaRefuerzo.COMPLETADA;

  // Anti-carrera: si ya la completó otra persona, avisar en vez de pisar.
  if (tarea.estado === EstadoTareaRefuerzo.COMPLETADA && c.estado === EstadoTareaRefuerzo.COMPLETADA) {
    return res.status(409).json({
      message: `Esta tarea ya fue completada${tarea.asignadoA?.nombre ? ` por ${tarea.asignadoA.nombre}` : ""}.`,
    });
  }

  // Al completar: resultado obligatorio; y notas obligatorias si el resultado no es "encuesta respondida"
  if (seCompleta) {
    const resultado = c.resultado ?? tarea.resultado;
    if (!resultado) {
      return res.status(400).json({ message: "Para completar la tarea, elegí un resultado." });
    }
    const notas = c.notas !== undefined ? c.notas : tarea.notas;
    if (resultado !== ResultadoTareaRefuerzo.ENCUESTA_RESPONDIDA && (!notas || !notas.trim())) {
      return res.status(400).json({ message: "Si el resultado no es 'encuesta respondida', las notas son obligatorias." });
    }
  }

  // GESTOR: al tomar/completar/cancelar, la tarea queda registrada a nombre de
  // quien la trabajó (soft-lock para no llamar dos veces al mismo cliente). Al
  // reabrir (PENDIENTE) vuelve al pool sin tomar (asignadoAId = null).
  const setGestor: string | null | undefined =
    c.estado === EstadoTareaRefuerzo.PENDIENTE
      ? null
      : c.estado === EstadoTareaRefuerzo.EN_GESTION ||
          c.estado === EstadoTareaRefuerzo.COMPLETADA ||
          c.estado === EstadoTareaRefuerzo.CANCELADA
        ? req.usuario!.id
        : undefined;

  const actualizada = await prisma.tareaRefuerzo.update({
    where: { id: tarea.id },
    data: {
      ...(c.estado ? { estado: c.estado } : {}),
      ...(c.resultado !== undefined ? { resultado: c.resultado } : {}),
      ...(c.notas !== undefined ? { notas: c.notas } : {}),
      ...(setGestor !== undefined ? { asignadoAId: setGestor } : {}),
      ...(seCompleta ? { completadaEn: new Date() } : {}),
      ...(c.estado && c.estado !== EstadoTareaRefuerzo.COMPLETADA && tarea.completadaEn ? { completadaEn: null } : {}),
    },
    include: INCLUDE_TAREA,
  });

  await auditar(req, {
    accion: seCompleta ? ACCIONES.TAREA_COMPLETADA : ACCIONES.TAREA_ACTUALIZADA,
    entidad: "TareaRefuerzo",
    entidadId: tarea.id,
    detalles: {
      casoId: tarea.casoId,
      estadoAntes: tarea.estado,
      estadoDespues: actualizada.estado,
      resultado: actualizada.resultado,
      gestorId: setGestor,
    },
  });

  res.json({ message: seCompleta ? "Tarea completada." : "Tarea actualizada.", data: actualizada });
}

// ---------- POST /api/refuerzos/vincular ----------
// Vincula a mano una fila "sin matchear" a un Caso existente, creando la tarea
// directo en el POOL (sin asignar a nadie). La usa la herramienta del resumen de
// importación.

const vincularSchema = z.object({
  casoId: z.string().trim().min(1, "Elegí un caso."),
  tipo: z.nativeEnum(TipoTareaRefuerzo),
  origenUploadId: z.string().trim().min(1, "Falta el origen de la importación."),
});

export async function vincularTarea(req: Request, res: Response) {
  const parsed = vincularSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message });
  const { casoId, tipo, origenUploadId } = parsed.data;

  const caso = await prisma.caso.findUnique({ where: { id: casoId } });
  if (!caso || caso.eliminadoEn) return res.status(404).json({ message: "No se encontró ese caso." });
  if (!puedeAcceder(req.usuario!, caso.area)) {
    return res.status(403).json({ message: "Ese caso es de otra área; no podés vincularlo." });
  }

  const existente = await prisma.tareaRefuerzo.findFirst({
    where: { casoId, estado: { in: ESTADOS_ABIERTOS } },
  });
  if (existente) return res.status(409).json({ message: "Ese caso ya tiene una tarea de refuerzo abierta." });

  const tarea = await prisma.tareaRefuerzo.create({
    data: { casoId, tipo, asignadoAId: null, origenUploadId }, // cae al pool de su área+provincia
    include: INCLUDE_TAREA,
  });

  await auditar(req, {
    accion: ACCIONES.TAREA_VINCULADA,
    entidad: "TareaRefuerzo",
    entidadId: tarea.id,
    detalles: { casoId, tipo, vinculacionManual: true },
  });

  res.status(201).json({ message: "Caso vinculado y tarea creada (queda en el pool del equipo).", data: tarea });
}
