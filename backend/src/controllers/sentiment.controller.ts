import { Request, Response } from "express";
import { Prisma, Semaforo } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { CATEGORIAS_CAUSA_RAIZ } from "../services/sentiment.service";
import { ACCIONES, auditar } from "../services/audit.service";

const INCLUDE_CASO = {
  caso: {
    select: {
      id: true,
      numeroOrden: true,
      nombrePropietario: true,
      modelo: true,
      asesor: true,
      sucursal: true,
      tieneRqrAbierto: true,
    },
  },
  message: { select: { content: true, createdAt: true } },
  rqr: { select: { id: true, numeroRQR: true, estado: true } },
} satisfies Prisma.SentimentAnalysisInclude;

// ---------- GET /api/sentiment-analysis ----------

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  semaforo: z.nativeEnum(Semaforo).optional(),
  sucursal: z.string().trim().min(1).optional(),
  asesor: z.string().trim().min(1).optional(),
  categoriaCausaRaiz: z.enum(CATEGORIAS_CAUSA_RAIZ).optional(),
  requiereRevisionManual: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
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

function construirWhere(q: z.infer<typeof listQuerySchema>): Prisma.SentimentAnalysisWhereInput {
  return {
    ...(q.semaforo ? { semaforo: q.semaforo } : {}),
    ...(q.categoriaCausaRaiz ? { categoriaCausaRaiz: q.categoriaCausaRaiz } : {}),
    ...(q.requiereRevisionManual !== undefined
      ? { requiereRevisionManual: q.requiereRevisionManual }
      : {}),
    // Excluye análisis de casos borrados lógicamente
    caso: {
      eliminadoEn: null,
      ...(q.sucursal ? { sucursal: { equals: q.sucursal, mode: "insensitive" } } : {}),
      ...(q.asesor ? { asesor: { contains: q.asesor, mode: "insensitive" } } : {}),
    },
    ...(q.fechaDesde || q.fechaHasta
      ? {
          analyzedAt: {
            ...(q.fechaDesde ? { gte: new Date(`${q.fechaDesde}T00:00:00`) } : {}),
            ...(q.fechaHasta ? { lte: new Date(`${q.fechaHasta}T23:59:59.999`) } : {}),
          },
        }
      : {}),
  };
}

export async function listSentimentAnalysis(req: Request, res: Response) {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      message: `Hay filtros con formato incorrecto: ${parsed.error.errors.map((e) => e.message).join(" ")}`,
    });
  }
  const q = parsed.data;
  const where = construirWhere(q);

  const [total, data] = await Promise.all([
    prisma.sentimentAnalysis.count({ where }),
    prisma.sentimentAnalysis.findMany({
      where,
      orderBy: { analyzedAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: INCLUDE_CASO,
    }),
  ]);

  res.json({
    data,
    pagination: {
      page: q.page,
      pageSize: q.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    },
  });
}

// ---------- GET /api/sentiment-analysis/revision-manual ----------

export async function listRevisionManual(_req: Request, res: Response) {
  const data = await prisma.sentimentAnalysis.findMany({
    where: { requiereRevisionManual: true, caso: { eliminadoEn: null } },
    orderBy: { analyzedAt: "asc" }, // los más viejos primero: son los que más esperan
    take: 200,
    include: INCLUDE_CASO,
  });
  res.json({ data, total: data.length });
}

// ---------- PATCH /api/sentiment-analysis/:id ----------
// Permite a Calidad corregir la clasificación de la IA.

const patchSchema = z
  .object({
    semaforo: z.nativeEnum(Semaforo).nullable().optional(),
    categoriaCausaRaiz: z.enum(CATEGORIAS_CAUSA_RAIZ).nullable().optional(),
    requiereRevisionManual: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Indicá al menos un campo para corregir (semaforo, categoriaCausaRaiz o requiereRevisionManual).",
  });

export async function patchSentimentAnalysis(req: Request, res: Response) {
  const parsed = patchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      message: `No se pudo guardar la corrección: ${parsed.error.errors.map((e) => e.message).join(" ")}`,
    });
  }

  const existente = await prisma.sentimentAnalysis.findUnique({ where: { id: req.params.id } });
  if (!existente) {
    return res.status(404).json({ message: "No se encontró ese análisis." });
  }

  const cambios = parsed.data;
  const actualizado = await prisma.sentimentAnalysis.update({
    where: { id: existente.id },
    data: {
      ...(cambios.semaforo !== undefined ? { semaforo: cambios.semaforo } : {}),
      ...(cambios.categoriaCausaRaiz !== undefined
        ? { categoriaCausaRaiz: cambios.categoriaCausaRaiz }
        : {}),
      // Al corregir a mano, salvo que se pida lo contrario, el caso deja de estar pendiente de revisión
      requiereRevisionManual: cambios.requiereRevisionManual ?? false,
    },
    include: INCLUDE_CASO,
  });

  await auditar(req, {
    accion: ACCIONES.SENTIMENT_CORREGIDO,
    entidad: "SentimentAnalysis",
    entidadId: actualizado.id,
    detalles: {
      semaforoAntes: existente.semaforo,
      semaforoDespues: actualizado.semaforo,
      categoriaAntes: existente.categoriaCausaRaiz,
      categoriaDespues: actualizado.categoriaCausaRaiz,
    },
  });

  res.json({
    message: "Corrección guardada. La clasificación manual pisa la de la IA en los reportes.",
    data: actualizado,
  });
}
