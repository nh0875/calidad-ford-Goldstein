import { Request, Response } from "express";
import { AreaTrabajo, Prisma, Semaforo, TipoAviso } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { CATEGORIAS_CAUSA_RAIZ, derivarDeEstrellas } from "../services/sentiment.service";
import { ACCIONES, auditar } from "../services/audit.service";
import { apagarAvisosCaso } from "../services/aviso.service";
import { parsearAreaQuery, puedeAcceder, whereArea } from "../services/area.service";
import { ITEM_QUE_DEFINE_EL_CASO } from "../config/posventa-vw";
import { usaEncuestaPorItems } from "../services/encuesta-posventa.service";

const INCLUDE_CASO = {
  caso: {
    select: {
      id: true,
      numeroOrden: true,
      nombrePropietario: true,
      modelo: true,
      asesor: true,
      sucursal: true,
      area: true,
      whatsapp: true,
      celular: true,
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

function construirWhere(
  q: z.infer<typeof listQuerySchema>,
  areaWhere: { area?: AreaTrabajo } = {}
): Prisma.SentimentAnalysisWhereInput {
  return {
    // Un caso = una clasificación. Los análisis de seguimiento (mensajes que el
    // cliente mandó después) no se listan como si fueran casos distintos.
    esSeguimiento: false,
    ...(q.semaforo ? { semaforo: q.semaforo } : {}),
    ...(q.categoriaCausaRaiz ? { categoriaCausaRaiz: q.categoriaCausaRaiz } : {}),
    ...(q.requiereRevisionManual !== undefined
      ? { requiereRevisionManual: q.requiereRevisionManual }
      : {}),
    // Excluye análisis de casos borrados lógicamente + restricción por área
    caso: {
      eliminadoEn: null,
      ...areaWhere,
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
  const where = construirWhere(q, whereArea(req.usuario!, parsearAreaQuery(req.query.area)));

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
// Bandeja de casos que la IA no pudo clasificar sola: respuestas no textuales
// (audio, imagen), reacciones ambiguas, o primeras respuestas demasiado cortas.
// Es la lista de "qué tengo que mirar a mano".

export async function listRevisionManual(req: Request, res: Response) {
  // Restricción por área: un usuario de VENTAS no ve la bandeja de POSVENTA.
  const areaWhere = whereArea(req.usuario!, parsearAreaQuery(req.query.area));
  const data = await prisma.sentimentAnalysis.findMany({
    where: {
      esSeguimiento: false,
      requiereRevisionManual: true,
      caso: { eliminadoEn: null, ...areaWhere },
    },
    orderBy: { analyzedAt: "asc" }, // los más viejos primero: son los que más esperan
    take: 200,
    include: INCLUDE_CASO,
  });
  res.json({ data, total: data.length });
}

// ---------- GET /api/sentiment-analysis/revision-manual/pendientes ----------
// Solo el número, para el badge del menú (barato: se consulta al navegar).

export async function contarRevisionManual(req: Request, res: Response) {
  const areaWhere = whereArea(req.usuario!, parsearAreaQuery(req.query.area));
  const pendientes = await prisma.sentimentAnalysis.count({
    where: {
      esSeguimiento: false,
      requiereRevisionManual: true,
      caso: { eliminadoEn: null, ...areaWhere },
    },
  });
  res.json({ pendientes });
}

// ---------- PATCH /api/sentiment-analysis/:id ----------
// Permite a Calidad corregir la clasificación de la IA.

const patchSchema = z
  .object({
    semaforo: z.nativeEnum(Semaforo).nullable().optional(),
    // Corrección en la escala de estrellas (Volkswagen). Si viene, el semáforo
    // y la severidad se recalculan a partir del puntaje: son la misma opinión
    // en dos escalas y no pueden quedar contradiciéndose.
    estrellas: z.number().int().min(1).max(5).nullable().optional(),
    categoriaCausaRaiz: z.enum(CATEGORIAS_CAUSA_RAIZ).nullable().optional(),
    requiereRevisionManual: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message:
      "Indicá al menos un campo para corregir (semaforo, estrellas, categoriaCausaRaiz o requiereRevisionManual).",
  });

export async function patchSentimentAnalysis(req: Request, res: Response) {
  const parsed = patchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      message: `No se pudo guardar la corrección: ${parsed.error.errors.map((e) => e.message).join(" ")}`,
    });
  }

  const existente = await prisma.sentimentAnalysis.findUnique({
    where: { id: req.params.id },
    include: { caso: { select: { area: true } } },
  });
  if (!existente) {
    return res.status(404).json({ message: "No se encontró ese análisis." });
  }
  // Un usuario restringido no puede corregir la clasificación de otra área.
  if (existente.caso && !puedeAcceder(req.usuario!, existente.caso.area)) {
    return res.status(403).json({ message: "Ese caso es de otra área: no lo podés gestionar." });
  }

  const cambios = parsed.data;
  const actualizado = await prisma.sentimentAnalysis.update({
    where: { id: existente.id },
    data: {
      // Si corrigen las estrellas, el semáforo y la severidad se DERIVAN del
      // puntaje nuevo (misma regla que usa la IA), y esa derivación pisa un
      // semáforo que hubiera venido en el mismo pedido.
      ...(cambios.estrellas != null
        ? { estrellas: cambios.estrellas, ...derivarDeEstrellas(cambios.estrellas) }
        : cambios.semaforo !== undefined
          ? { semaforo: cambios.semaforo }
          : {}),
      ...(cambios.categoriaCausaRaiz !== undefined
        ? { categoriaCausaRaiz: cambios.categoriaCausaRaiz }
        : {}),
      // Al corregir a mano, salvo que se pida lo contrario, el caso deja de estar pendiente de revisión
      requiereRevisionManual: cambios.requiereRevisionManual ?? false,
    },
    include: INCLUDE_CASO,
  });

  // Si se corrigieron las estrellas y este caso usa la encuesta por ítems, hay que
  // corregir TAMBIÉN el ítem GENERAL: de esa fila sale exactamente el mismo
  // número. Sin esto, el mismo caso mostraba una nota en Seguimiento (la
  // corregida) y otra en el reporte de desempeño (la vieja), y no había forma de
  // saber cuál era la buena.
  if (
    cambios.estrellas != null &&
    actualizado.casoId &&
    actualizado.caso &&
    usaEncuestaPorItems(actualizado.caso.area)
  ) {
    await prisma.evaluacionPosventa.updateMany({
      where: { casoId: actualizado.casoId, item: ITEM_QUE_DEFINE_EL_CASO },
      data: { estrellas: cambios.estrellas },
    });
  }

  // Al clasificar a mano, el caso deja de estar pendiente de revisión: se apaga
  // su aviso del cartel (si tenía uno). Así el aviso "se apaga solo" al resolver.
  if (!actualizado.requiereRevisionManual && actualizado.casoId) {
    await apagarAvisosCaso(actualizado.casoId, TipoAviso.REVISION_MANUAL);
  }

  await auditar(req, {
    accion: ACCIONES.SENTIMENT_CORREGIDO,
    entidad: "SentimentAnalysis",
    entidadId: actualizado.id,
    detalles: {
      semaforoAntes: existente.semaforo,
      semaforoDespues: actualizado.semaforo,
      estrellasAntes: existente.estrellas,
      estrellasDespues: actualizado.estrellas,
      categoriaAntes: existente.categoriaCausaRaiz,
      categoriaDespues: actualizado.categoriaCausaRaiz,
    },
  });

  res.json({
    message: "Corrección guardada. La clasificación manual pisa la de la IA en los reportes.",
    data: actualizado,
  });
}
