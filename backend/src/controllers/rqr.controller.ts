import { Request, Response } from "express";
import { AreaTrabajo, EstadoRQR, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { crearRqrManual, recalcularTieneRqrAbierto } from "../services/rqr.service";
import { areaPermitida, parsearAreaQuery, puedeAcceder, whereArea } from "../services/area.service";
import { importarFormulariosRqr } from "../services/rqr-import.service";
import { CATEGORIAS_CAUSA_RAIZ } from "../services/sentiment.service";
import { wordRqr } from "../services/exportacion.service";
import { ACCIONES, auditar } from "../services/audit.service";

// ---------- GET /api/rqr ----------

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  estado: z.nativeEnum(EstadoRQR).optional(),
  sucursal: z.string().trim().min(1).optional(),
  asesor: z.string().trim().min(1).optional(),
  categoria: z.enum(CATEGORIAS_CAUSA_RAIZ).optional(),
  fechaDesde: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha 'desde' tiene que tener el formato AAAA-MM-DD.")
    .optional(),
  fechaHasta: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha 'hasta' tiene que tener el formato AAAA-MM-DD.")
    .optional(),
});

export async function listRqr(req: Request, res: Response) {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      message: `Hay filtros con formato incorrecto: ${parsed.error.errors.map((e) => e.message).join(" ")}`,
    });
  }
  const q = parsed.data;

  const where: Prisma.RQRWhereInput = {
    eliminadoEn: null, // los RQR borrados lógicamente no aparecen en el listado
    ...whereArea(req.usuario!, parsearAreaQuery(req.query.area)), // restricción por área
    ...(q.estado ? { estado: q.estado } : {}),
    ...(q.categoria ? { causaRaiz: q.categoria } : {}),
    ...(q.asesor ? { asesor: { contains: q.asesor, mode: "insensitive" } } : {}),
    ...(q.sucursal ? { caso: { sucursal: { equals: q.sucursal, mode: "insensitive" } } } : {}),
    ...(q.fechaDesde || q.fechaHasta
      ? {
          fechaApertura: {
            ...(q.fechaDesde ? { gte: new Date(`${q.fechaDesde}T00:00:00`) } : {}),
            ...(q.fechaHasta ? { lte: new Date(`${q.fechaHasta}T23:59:59.999`) } : {}),
          },
        }
      : {}),
  };

  const [total, data] = await Promise.all([
    prisma.rQR.count({ where }),
    prisma.rQR.findMany({
      where,
      orderBy: { fechaApertura: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        caso: {
          select: { numeroOrden: true, nombrePropietario: true, modelo: true, sucursal: true },
        },
        sentimentAnalysis: { select: { semaforo: true, confianza: true } },
      },
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

// ---------- POST /api/rqr (creación manual) ----------
// Camino alternativo al RQR automático de la IA: reclamos que llegan por
// teléfono, en persona u otro canal. Con Caso vinculado o con datos manuales.

const createSchema = z
  .object({
    casoId: z.string().trim().min(1).optional(),
    nombreClienteManual: z.string().trim().min(1).optional(),
    telefonoManual: z.string().trim().min(1).optional(),
    modeloManual: z.string().trim().min(1).optional(),
    canal: z.string().trim().min(1).default("Posventa"),
    areaOrigen: z.string().trim().min(1).default("Taller"),
    areaAfectada: z.string().trim().min(1).optional(),
    asesor: z.string().trim().min(1, "Indicá el asesor del reclamo."),
    descripcionReclamo: z.string().trim().min(1, "La descripción del reclamo no puede estar vacía."),
    causaRaiz: z.enum(CATEGORIAS_CAUSA_RAIZ).optional(),
    tratamientoBitacora: z.string().trim().min(1).optional(),
    observaciones: z.string().trim().min(1).optional(),
    area: z.nativeEnum(AreaTrabajo).optional(), // solo para RQR manual sin caso
  })
  .refine((v) => v.casoId || v.nombreClienteManual, {
    message: "Vinculá un caso existente o cargá al menos el nombre del cliente.",
  });

export async function createRqr(req: Request, res: Response) {
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      message: `No se pudo crear el RQR: ${parsed.error.errors.map((e) => e.message).join(" ")}`,
    });
  }
  const datos = parsed.data;
  const restringido = areaPermitida(req.usuario!); // null = admin/ambas

  // El área del RQR: si vincula un caso, hereda la del caso; si es manual, la
  // elige (un usuario restringido solo puede elegir la suya).
  let area: AreaTrabajo;
  if (datos.casoId) {
    const caso = await prisma.caso.findUnique({ where: { id: datos.casoId }, select: { area: true } });
    if (!caso) {
      return res.status(400).json({
        message: "El caso que intentás vincular ya no existe. Buscalo de nuevo o cargá los datos a mano.",
      });
    }
    if (!puedeAcceder(req.usuario!, caso.area)) {
      return res.status(403).json({ message: "Ese caso es de otra área; no podés crear un RQR sobre él." });
    }
    area = caso.area;
  } else {
    // RQR manual: el usuario restringido queda forzado a su área.
    area = restringido ?? datos.area ?? AreaTrabajo.POSVENTA;
  }

  const rqr = await crearRqrManual({ ...datos, area });

  await auditar(req, {
    accion: ACCIONES.RQR_CREADO,
    entidad: "RQR",
    entidadId: rqr.id,
    detalles: { numeroRQR: rqr.numeroRQR, casoId: datos.casoId ?? null, manual: true },
  });

  res.status(201).json({
    message: `${rqr.numeroRQR} creado correctamente.`,
    data: rqr,
  });
}

// ---------- POST /api/rqr/importar (Excel de formularios, una hoja por RQR) ----------

export async function importarRqr(req: Request, res: Response) {
  if (!req.file) {
    return res.status(400).json({
      message: "No se recibió ningún archivo. Elegí el Excel de RQR (.xlsx) y volvé a intentar.",
    });
  }

  let resultado;
  try {
    resultado = await importarFormulariosRqr(req.file.buffer);
  } catch {
    return res.status(400).json({
      message: "El archivo no se pudo leer como Excel. Verificá que sea un .xlsx válido.",
    });
  }

  await auditar(req, {
    accion: ACCIONES.RQR_IMPORTADO,
    entidad: "RQR",
    detalles: {
      archivo: req.file.originalname,
      creados: resultado.creados,
      duplicados: resultado.duplicados,
      conError: resultado.conError,
    },
  });

  res.status(resultado.creados > 0 ? 201 : 200).json({
    message:
      `Importación terminada: ${resultado.creados} RQR creados, ` +
      `${resultado.duplicados} ya existían y ${resultado.conError} hojas no se pudieron procesar.`,
    ...resultado,
  });
}

// ---------- GET /api/rqr/:id ----------

const INCLUDE_DETALLE = {
  caso: true,
  sentimentAnalysis: {
    include: { message: { select: { content: true, createdAt: true } } },
  },
} satisfies Prisma.RQRInclude;

export async function getRqr(req: Request, res: Response) {
  const rqr = await prisma.rQR.findUnique({
    where: { id: req.params.id },
    include: INCLUDE_DETALLE,
  });
  if (!rqr || rqr.eliminadoEn) {
    return res.status(404).json({ message: "No se encontró ese RQR." });
  }
  if (!puedeAcceder(req.usuario!, rqr.area)) {
    return res.status(403).json({ message: "Este RQR es de otra área; no tenés acceso." });
  }
  res.json({ data: rqr });
}

// ---------- GET /api/rqr/:id/word ----------
// Exporta el formulario con el formato de secciones del papel, para
// imprimir o mandar por mail a Ford.

export async function exportarRqrWord(req: Request, res: Response) {
  const rqr = await prisma.rQR.findUnique({
    where: { id: req.params.id },
    include: INCLUDE_DETALLE,
  });
  if (!rqr || rqr.eliminadoEn) {
    return res.status(404).json({ message: "No se encontró ese RQR." });
  }
  if (!puedeAcceder(req.usuario!, rqr.area)) {
    return res.status(403).json({ message: "Este RQR es de otra área; no tenés acceso." });
  }

  const buffer = await wordRqr(rqr);
  res
    .setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    .setHeader("Content-Disposition", `attachment; filename="${rqr.numeroRQR}.docx"`)
    .send(buffer);
}

// ---------- PATCH /api/rqr/:id ----------
// Tratamiento y cierre por parte de Calidad. Al cambiar el estado se
// recalcula Caso.tieneRqrAbierto.

const patchSchema = z
  .object({
    estado: z.nativeEnum(EstadoRQR).optional(),
    areaOrigen: z.string().trim().min(1).optional(),
    areaAfectada: z.string().trim().nullable().optional(),
    descripcionReclamo: z.string().trim().min(1).optional(),
    tratamientoBitacora: z.string().trim().nullable().optional(),
    solucionPropuesta: z.string().trim().nullable().optional(),
    tratamientoDadoPor: z.string().trim().nullable().optional(),
    observaciones: z.string().trim().nullable().optional(),
    responsableCierre: z.string().trim().nullable().optional(),
    causaRaiz: z.string().trim().nullable().optional(),
    // Se completa sola al pasar a CERRADO, pero Calidad puede corregirla
    fechaCierre: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha de cierre tiene que tener el formato AAAA-MM-DD.")
      .nullable()
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Indicá al menos un campo para actualizar.",
  });

export async function patchRqr(req: Request, res: Response) {
  const parsed = patchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      message: `No se pudo actualizar el RQR: ${parsed.error.errors.map((e) => e.message).join(" ")}`,
    });
  }

  const existente = await prisma.rQR.findUnique({ where: { id: req.params.id } });
  if (!existente || existente.eliminadoEn) {
    return res.status(404).json({ message: "No se encontró ese RQR." });
  }
  if (!puedeAcceder(req.usuario!, existente.area)) {
    return res.status(403).json({ message: "Este RQR es de otra área; no podés modificarlo." });
  }

  const { fechaCierre: fechaCierreManual, ...cambios } = parsed.data;
  const seCierra = cambios.estado === EstadoRQR.CERRADO && existente.estado !== EstadoRQR.CERRADO;
  const seReabre = cambios.estado && cambios.estado !== EstadoRQR.CERRADO && existente.fechaCierre;

  // Prioridad: fecha indicada a mano > automática al cerrar > limpieza al reabrir
  const fechaCierre =
    fechaCierreManual !== undefined
      ? fechaCierreManual
        ? new Date(`${fechaCierreManual}T12:00:00`)
        : null
      : seCierra
        ? new Date()
        : seReabre
          ? null
          : undefined;

  const actualizado = await prisma.rQR.update({
    where: { id: existente.id },
    data: {
      ...cambios,
      ...(fechaCierre !== undefined ? { fechaCierre } : {}),
    },
  });

  if (cambios.estado) {
    await recalcularTieneRqrAbierto(existente.casoId);
  }

  await auditar(req, {
    accion: seCierra ? ACCIONES.RQR_CERRADO : ACCIONES.RQR_MODIFICADO,
    entidad: "RQR",
    entidadId: actualizado.id,
    detalles: {
      numeroRQR: actualizado.numeroRQR,
      camposModificados: Object.keys(parsed.data),
      estadoAntes: existente.estado,
      estadoDespues: actualizado.estado,
    },
  });

  res.json({
    message: seCierra
      ? `${actualizado.numeroRQR} cerrado correctamente.`
      : `${actualizado.numeroRQR} actualizado.`,
    data: actualizado,
  });
}
