import { Request, Response } from "express";
import { AreaTrabajo, EstadoRQR, Prisma } from "@prisma/client";
import { z } from "zod";
import { marca } from "../config/marca";
import {
  AREAS_VW,
  AreaVW,
  NOMBRE_AREA_VW,
  LARGO_CODIGO_SUCURSAL,
  ORIGENES_RQR_VALIDOS,
  SUBAREAS_VW_VALIDAS,
  subareaPerteneceAlArea,
} from "../config/areas-vw";
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
        sentimentAnalysis: { select: { semaforo: true, estrellas: true, confianza: true } },
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


// Campos que solo usa el RQR de Volkswagen. Se definen una vez y se reusan en el
// alta y en la edición. En Ford no vienen y quedan en null.
const camposVW = {
  tipoContacto: z.enum(AREAS_VW).optional(),
  // Sector responsable del reclamo. Es OTRA cosa que tipoContacto: ese dice por
  // qué tema llamó el cliente, este dice de quién es el problema. La subárea
  // cuelga de ESTE, no del tipo de contacto.
  areaPrincipal: z.enum(AREAS_VW).optional(),
  subarea: z.string().trim().min(1).optional(),
  origenRqr: z.string().trim().min(1).optional(),
  codigoSucursal: z
    .string()
    .trim()
    .length(LARGO_CODIGO_SUCURSAL, `El código de sucursal tiene ${LARGO_CODIGO_SUCURSAL} caracteres.`)
    .optional(),
  razonSocial: z.string().trim().min(1).max(160).optional(),
  tratamientoDadoPor2: z.string().trim().min(1).max(120).optional(),
};

/**
 * Valida las combinaciones imposibles del RQR de VW: una subárea que no
 * pertenece al área elegida, o un origen que no está en la lista. Devuelve el
 * mensaje de error, o null si está todo bien.
 *
 * Se hace acá y no con un refine del schema porque la subárea depende del
 * tipo de contacto, y en la EDICIÓN puede venir solo uno de los dos (hay que
 * mirar también lo que ya estaba guardado).
 */
function validarCamposVW(datos: {
  areaPrincipal?: string | null;
  subarea?: string | null;
  origenRqr?: string | null;
}): string | null {
  if (datos.origenRqr && !ORIGENES_RQR_VALIDOS.has(datos.origenRqr)) {
    return "El origen del RQR no es válido.";
  }
  if (datos.subarea) {
    if (!SUBAREAS_VW_VALIDAS.has(datos.subarea)) return "La subárea no es válida.";
    if (datos.areaPrincipal && !subareaPerteneceAlArea(datos.areaPrincipal as AreaVW, datos.subarea)) {
      return "Esa subárea no pertenece al área principal elegida.";
    }
  }
  return null;
}

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
    ...camposVW,
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
  const errorVW = validarCamposVW(datos);
  if (errorVW) return res.status(400).json({ message: errorVW });
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

  // En las marcas que clasifican por área+subárea, el campo libre "areaOrigen"
  // no se muestra en el formulario: se completa con la etiqueta del área
  // principal, para que todo lo que ya lo lee (Word, exportaciones, listados)
  // siga mostrando algo con sentido sin tener que tocarlo.
  const areaOrigen =
    marca.rqrConSubareas && datos.areaPrincipal
      ? NOMBRE_AREA_VW[datos.areaPrincipal as AreaVW]
      : datos.areaOrigen;

  // Queda registrado quién lo cargó: se imprime en el documento del RQR.
  const rqr = await crearRqrManual({ ...datos, areaOrigen, area, creadoPorId: req.usuario!.id });

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
  // Quién cargó el RQR: va en el documento que se imprime (Volkswagen lo pide
  // explícitamente para los que se cargan a mano).
  creadoPor: { select: { nombre: true } },
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
    // Campos de Volkswagen: se pueden corregir después de creado el RQR.
    ...camposVW,
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

  // La subárea depende del tipo de contacto, y en una edición puede venir solo
  // uno de los dos: se valida contra la mezcla de lo nuevo y lo ya guardado.
  const errorVW = validarCamposVW({
    areaPrincipal: parsed.data.areaPrincipal ?? existente.areaPrincipal,
    subarea: parsed.data.subarea ?? existente.subarea,
    origenRqr: parsed.data.origenRqr ?? existente.origenRqr,
  });
  if (errorVW) return res.status(400).json({ message: errorVW });

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
