import { Request, Response } from "express";
import { z } from "zod";
import { EstadoContacto, OrigenAgendamiento, Prisma, TipoUpload } from "@prisma/client";
import { prisma } from "../config/prisma";
import { estaSuprimido, telefonosSuprimidos } from "../services/supresion.service";
import { areaEfectiva, parsearAreaQuery, whereArea } from "../services/area.service";

// Fila que devuelve el autocompletado (misma forma que el select anterior)
interface CasoBusqueda {
  id: string;
  numeroOrden: string;
  nombrePropietario: string;
  whatsapp: string;
  celular: string;
  modelo: string;
  patente: string;
  sucursal: string;
  asesor: string;
  fechaProgramacion: Date;
  tieneRqrAbierto: boolean;
}

const casosQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sucursal: z.string().trim().min(1).optional(),
  asesor: z.string().trim().min(1).optional(),
  estadoContacto: z.nativeEnum(EstadoContacto).optional(),
  origenAgendamiento: z.nativeEnum(OrigenAgendamiento).optional(),
  periodo: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "El período tiene que tener el formato AAAA-MM, por ejemplo 2026-01.")
    .optional(),
  fechaDesde: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha 'desde' tiene que tener el formato AAAA-MM-DD.")
    .optional(),
  fechaHasta: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha 'hasta' tiene que tener el formato AAAA-MM-DD.")
    .optional(),
});

// ---------- GET /api/casos/buscar?q= (autocompletado para vincular RQR) ----------

export async function buscarCasos(req: Request, res: Response) {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) {
    return res.status(400).json({
      message: "Escribí al menos 2 caracteres para buscar (nombre, teléfono, patente u orden).",
    });
  }

  // Búsqueda insensible a mayúsculas Y a acentos (unaccent): "gomez" encuentra
  // "Gómez". Prisma `mode: insensitive` solo ignora mayúsculas, no tildes, por
  // eso se usa SQL crudo con unaccent() en ambos lados. Los parámetros van
  // parametrizados (${}) para evitar inyección.
  const patron = `%${q}%`;
  // Restricción por área: un usuario restringido solo autocompleta su área.
  const area = areaEfectiva(req.usuario!, parsearAreaQuery(req.query.area));
  const casos = await prisma.$queryRaw<CasoBusqueda[]>`
    SELECT id, "numeroOrden", "nombrePropietario", whatsapp, celular, modelo,
           patente, sucursal, asesor, "fechaProgramacion", "tieneRqrAbierto"
    FROM "Caso"
    WHERE "eliminadoEn" IS NULL
      AND (${area}::text IS NULL OR "area"::text = ${area}::text)
      AND (
        unaccent("numeroOrden") ILIKE unaccent(${patron})
        OR unaccent(patente) ILIKE unaccent(${patron})
        OR unaccent("nombrePropietario") ILIKE unaccent(${patron})
        OR whatsapp ILIKE ${patron}
        OR celular ILIKE ${patron}
      )
    ORDER BY "fechaProgramacion" DESC
    LIMIT 10
  `;

  res.json({ data: casos });
}

// ---------- GET /api/casos/opciones ----------
// Alimenta los desplegables de filtros (sucursal, asesor, período) con los
// valores REALES presentes en la base, en vez de que el usuario los tipee (lo
// que era sensible a tildes/mayúsculas y a errores de tipeo).

export async function opcionesCasos(req: Request, res: Response) {
  const areaWhere = whereArea(req.usuario!, parsearAreaQuery(req.query.area));
  const [sucursales, asesores, periodos] = await Promise.all([
    prisma.caso.findMany({
      where: { eliminadoEn: null, ...areaWhere },
      distinct: ["sucursal"],
      select: { sucursal: true },
      orderBy: { sucursal: "asc" },
    }),
    prisma.caso.findMany({
      where: { eliminadoEn: null, ...areaWhere },
      distinct: ["asesor"],
      select: { asesor: true },
      orderBy: { asesor: "asc" },
    }),
    prisma.excelUpload.findMany({
      where: { eliminadoEn: null, tipo: TipoUpload.CONTACTO_POSVENTA },
      distinct: ["periodo"],
      select: { periodo: true },
      orderBy: { periodo: "desc" },
    }),
  ]);

  res.json({
    sucursales: sucursales.map((s) => s.sucursal).filter(Boolean),
    asesores: asesores.map((a) => a.asesor).filter(Boolean),
    periodos: periodos.map((p) => p.periodo).filter(Boolean),
  });
}

export async function listCasos(req: Request, res: Response) {
  const parsed = casosQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      message: `Hay filtros con formato incorrecto: ${parsed.error.errors.map((e) => e.message).join(" ")}`,
    });
  }

  const q = parsed.data;

  const where: Prisma.CasoWhereInput = {
    eliminadoEn: null, // los casos borrados lógicamente no aparecen en el listado
    ...whereArea(req.usuario!, parsearAreaQuery(req.query.area)), // restricción por área
    ...(q.sucursal ? { sucursal: { equals: q.sucursal, mode: "insensitive" } } : {}),
    ...(q.asesor ? { asesor: { contains: q.asesor, mode: "insensitive" } } : {}),
    ...(q.estadoContacto ? { estadoContacto: q.estadoContacto } : {}),
    ...(q.origenAgendamiento ? { origenAgendamiento: q.origenAgendamiento } : {}),
    ...(q.periodo ? { upload: { periodo: q.periodo } } : {}),
    ...(q.fechaDesde || q.fechaHasta
      ? {
          fechaProgramacion: {
            ...(q.fechaDesde ? { gte: new Date(`${q.fechaDesde}T00:00:00`) } : {}),
            ...(q.fechaHasta ? { lte: new Date(`${q.fechaHasta}T23:59:59.999`) } : {}),
          },
        }
      : {}),
  };

  const [total, casos, suprimidos] = await Promise.all([
    prisma.caso.count({ where }),
    prisma.caso.findMany({
      where,
      orderBy: { fechaProgramacion: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        upload: { select: { periodo: true } },
        analisis: {
          orderBy: { analyzedAt: "desc" },
          take: 1,
          select: { semaforo: true, esHistoricoImportado: true, resumenIA: true },
        },
      },
    }),
    telefonosSuprimidos(),
  ]);

  res.json({
    data: casos.map((c) => ({
      ...c,
      periodo: c.upload.periodo,
      ultimoAnalisis: c.analisis[0] ?? null,
      // Cliente en la lista de supresión: no puede recibir campañas (además del
      // flag whatsappOptOut por caso).
      suprimido: estaSuprimido(c.telefonosNorm, suprimidos),
      upload: undefined,
      analisis: undefined,
    })),
    pagination: {
      page: q.page,
      pageSize: q.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    },
  });
}
