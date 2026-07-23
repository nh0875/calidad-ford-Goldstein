import { Request, Response } from "express";
import {
  EstadoTareaRefuerzo,
  Prisma,
  ResultadoTareaRefuerzo,
  TipoTareaRefuerzo,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { ACCIONES, auditar } from "../services/audit.service";
import { Repartidor, contarPendientesDe, usuariosElegiblesConCarga } from "../services/refuerzo.service";
import { estaSuprimido, telefonosSuprimidos } from "../services/supresion.service";
import { parsearAreaQuery, puedeAcceder, whereArea } from "../services/area.service";

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
      sucursal: true,
      telefonosNorm: true,
      fechaSalida: true,
      fechaProgramacion: true,
      tieneRqrAbierto: true,
      encuestaFordEstado: true,
      analisis: {
        orderBy: { analyzedAt: "desc" as const },
        take: 1,
        select: { semaforo: true },
      },
    },
  },
  asignadoA: { select: { id: true, nombre: true, activo: true } },
} satisfies Prisma.TareaRefuerzoInclude;

type TareaConCaso = { caso: { telefonosNorm: string[] } | null };
function marcarSupresion<T extends TareaConCaso>(tareas: T[], suprimidos: Set<string>) {
  return tareas.map((t) => ({
    ...t,
    suprimido: t.caso ? estaSuprimido(t.caso.telefonosNorm, suprimidos) : false,
  }));
}

// ---------- GET /api/refuerzos/mias (tareas del usuario logueado) ----------

export async function misTareas(req: Request, res: Response) {
  const estado = req.query.estado as EstadoTareaRefuerzo | undefined;
  const soloAbiertas = !estado;
  const [tareas, suprimidos] = await Promise.all([
    prisma.tareaRefuerzo.findMany({
      where: {
        asignadoAId: req.usuario!.id,
        caso: { eliminadoEn: null, ...whereArea(req.usuario!) }, // no casos borrados ni de otra área
        ...(estado ? { estado } : { estado: { in: [EstadoTareaRefuerzo.PENDIENTE, EstadoTareaRefuerzo.EN_GESTION] } }),
      },
      orderBy: { creadaEn: "asc" },
      include: INCLUDE_TAREA,
    }),
    telefonosSuprimidos(),
  ]);
  // El refuerzo Ford lo hace un humano por otro canal (no lo bloquea la
  // supresión), pero se marca para que sepa que el cliente pidió no recibir
  // WhatsApp nuestro.
  res.json({ data: marcarSupresion(tareas, suprimidos), soloAbiertas });
}

export async function misPendientes(req: Request, res: Response) {
  res.json({ pendientes: await contarPendientesDe(req.usuario!.id) });
}

// ---------- GET /api/refuerzos (vista admin: todas, con filtros) ----------

const listSchema = z.object({
  asignadoAId: z.string().trim().min(1).optional(),
  estado: z.nativeEnum(EstadoTareaRefuerzo).optional(),
  tipo: z.nativeEnum(TipoTareaRefuerzo).optional(),
  resultado: z.nativeEnum(ResultadoTareaRefuerzo).optional(),
  origenUploadId: z.string().trim().min(1).optional(),
  sinAsignar: z.enum(["true"]).optional(),
});

export async function listarTareas(req: Request, res: Response) {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Filtros inválidos." });
  const q = parsed.data;

  const where: Prisma.TareaRefuerzoWhereInput = {
    // No casos borrados ni de otra área (admin sin restricción, o filtra por ?area)
    caso: { eliminadoEn: null, ...whereArea(req.usuario!, parsearAreaQuery(req.query.area)) },
    ...(q.sinAsignar ? { asignadoAId: null } : q.asignadoAId ? { asignadoAId: q.asignadoAId } : {}),
    ...(q.estado ? { estado: q.estado } : {}),
    ...(q.tipo ? { tipo: q.tipo } : {}),
    ...(q.resultado ? { resultado: q.resultado } : {}),
    ...(q.origenUploadId ? { origenUploadId: q.origenUploadId } : {}),
  };

  const LIMITE = 500;
  const [total, tareas, suprimidos] = await Promise.all([
    prisma.tareaRefuerzo.count({ where }),
    prisma.tareaRefuerzo.findMany({
      where,
      orderBy: { creadaEn: "desc" },
      take: LIMITE,
      include: INCLUDE_TAREA,
    }),
    telefonosSuprimidos(),
  ]);
  // Aviso si el listado quedó recortado, para no dar sensación de "esto es todo".
  res.json({ data: marcarSupresion(tareas, suprimidos), total, truncado: total > LIMITE, limite: LIMITE });
}

// Mini-reporte por empleado (solo ADMIN)
export async function resumenEmpleados(req: Request, res: Response) {
  const areaCaso = { eliminadoEn: null, ...whereArea(req.usuario!, parsearAreaQuery(req.query.area)) };
  const usuarios = await prisma.usuario.findMany({
    where: { rol: "CALIDAD" },
    select: { id: true, nombre: true, activo: true, participaEnRefuerzos: true, area: true },
    orderBy: { nombre: "asc" },
  });

  const porEstado = await prisma.tareaRefuerzo.groupBy({
    by: ["asignadoAId", "estado"],
    where: { caso: areaCaso }, // no contar tareas de casos borrados ni de otra área
    _count: { _all: true },
  });
  const porResultado = await prisma.tareaRefuerzo.groupBy({
    by: ["asignadoAId", "resultado"],
    where: { resultado: { not: null }, caso: areaCaso },
    _count: { _all: true },
  });

  const data = usuarios.map((u) => {
    const estados = porEstado.filter((e) => e.asignadoAId === u.id);
    const asignadas = estados.reduce((a, e) => a + e._count._all, 0);
    const completadas = estados.filter((e) => e.estado === "COMPLETADA").reduce((a, e) => a + e._count._all, 0);
    const abiertas = estados
      .filter((e) => e.estado === "PENDIENTE" || e.estado === "EN_GESTION")
      .reduce((a, e) => a + e._count._all, 0);
    const resultados: Record<string, number> = {};
    for (const r of porResultado.filter((x) => x.asignadoAId === u.id)) {
      if (r.resultado) resultados[r.resultado] = r._count._all;
    }
    return {
      id: u.id,
      nombre: u.nombre,
      activo: u.activo,
      area: u.area,
      participaEnRefuerzos: u.participaEnRefuerzos,
      asignadas,
      completadas,
      abiertas,
      pctCompletadas: asignadas > 0 ? Math.round((completadas / asignadas) * 1000) / 10 : 0,
      resultados,
    };
  });

  const sinAsignar = porEstado
    .filter((e) => e.asignadoAId === null && (e.estado === "PENDIENTE" || e.estado === "EN_GESTION"))
    .reduce((a, e) => a + e._count._all, 0);

  res.json({ data, sinAsignar });
}

// ---------- PATCH /api/refuerzos/:id (gestión de una tarea) ----------
// Un CALIDAD solo puede tocar SUS tareas; ADMIN cualquiera (validado acá).

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
    include: { caso: { select: { area: true } } },
  });
  if (!tarea) return res.status(404).json({ message: "No se encontró la tarea." });

  // Restricción por área: la tarea es de otra área → 403.
  if (!puedeAcceder(req.usuario!, tarea.caso.area)) {
    return res.status(403).json({ message: "Esta tarea es de otra área; no tenés acceso." });
  }

  const esAdmin = req.usuario!.rol === "ADMIN";
  if (!esAdmin && tarea.asignadoAId !== req.usuario!.id) {
    return res.status(403).json({ message: "Solo podés gestionar las tareas asignadas a vos." });
  }

  const c = parsed.data;
  const seCompleta = c.estado === EstadoTareaRefuerzo.COMPLETADA && tarea.estado !== EstadoTareaRefuerzo.COMPLETADA;

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

  const actualizada = await prisma.tareaRefuerzo.update({
    where: { id: tarea.id },
    data: {
      ...(c.estado ? { estado: c.estado } : {}),
      ...(c.resultado !== undefined ? { resultado: c.resultado } : {}),
      ...(c.notas !== undefined ? { notas: c.notas } : {}),
      ...(seCompleta ? { completadaEn: new Date() } : {}),
      // Reabrir limpia la fecha de completado
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
    },
  });

  res.json({ message: seCompleta ? "Tarea completada." : "Tarea actualizada.", data: actualizada });
}

// ---------- POST /api/refuerzos/:id/reasignar (solo ADMIN) ----------

const reasignarSchema = z.object({ asignadoAId: z.string().trim().min(1, "Elegí un empleado.") });

export async function reasignarTarea(req: Request, res: Response) {
  const parsed = reasignarSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message });

  const tarea = await prisma.tareaRefuerzo.findUnique({
    where: { id: req.params.id },
    include: { caso: { select: { area: true } } },
  });
  if (!tarea) return res.status(404).json({ message: "No se encontró la tarea." });

  const nuevo = await prisma.usuario.findUnique({ where: { id: parsed.data.asignadoAId } });
  if (!nuevo || !nuevo.activo) {
    return res.status(400).json({ message: "El empleado elegido no existe o está desactivado." });
  }
  // No se puede reasignar a alguien de otra área (rompería el aislamiento).
  if (nuevo.rol !== "ADMIN" && nuevo.area !== "AMBAS" && nuevo.area !== tarea.caso.area) {
    return res.status(400).json({
      message: `El empleado elegido es de otra área (la tarea es de ${tarea.caso.area}). Elegí a alguien de esa área o de AMBAS.`,
    });
  }

  const actualizada = await prisma.tareaRefuerzo.update({
    where: { id: tarea.id },
    data: { asignadoAId: nuevo.id },
    include: INCLUDE_TAREA,
  });

  await auditar(req, {
    accion: ACCIONES.TAREA_REASIGNADA,
    entidad: "TareaRefuerzo",
    entidadId: tarea.id,
    detalles: { casoId: tarea.casoId, deId: tarea.asignadoAId, aId: nuevo.id, aNombre: nuevo.nombre },
  });

  res.json({ message: `Tarea reasignada a ${nuevo.nombre}.`, data: actualizada });
}

// ---------- POST /api/refuerzos/vincular ----------
// Vincula a mano una fila "sin matchear" a un Caso existente, creando la tarea
// (con reparto equitativo). La usa la herramienta del resumen de importación.

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
    where: { casoId, estado: { in: [EstadoTareaRefuerzo.PENDIENTE, EstadoTareaRefuerzo.EN_GESTION] } },
  });
  if (existente) return res.status(409).json({ message: "Ese caso ya tiene una tarea de refuerzo abierta." });

  // Reparto entre usuarios del área del caso (o AMBAS).
  const repartidor = new Repartidor(await usuariosElegiblesConCarga(caso.area));
  const asignadoAId = repartidor.siguiente();

  const tarea = await prisma.tareaRefuerzo.create({
    data: { casoId, tipo, asignadoAId, origenUploadId },
    include: INCLUDE_TAREA,
  });

  await auditar(req, {
    accion: ACCIONES.TAREA_ASIGNADA,
    entidad: "TareaRefuerzo",
    entidadId: tarea.id,
    detalles: { casoId, tipo, asignadoAId, vinculacionManual: true },
  });

  res.status(201).json({ message: "Caso vinculado y tarea creada.", data: tarea });
}
