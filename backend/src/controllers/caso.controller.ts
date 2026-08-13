import { Request, Response } from "express";
import { z } from "zod";
import { AreaTrabajo, EstadoContacto, OrigenAgendamiento, Prisma, TipoAlias, TipoUpload } from "@prisma/client";
import { prisma } from "../config/prisma";
import { estaSuprimido, telefonosSuprimidos } from "../services/supresion.service";
import { areaEfectiva, areaPermitida, parsearAreaQuery, puedeAcceder, whereArea } from "../services/area.service";
import { ACCIONES, auditar } from "../services/audit.service";
import { normalizarTelefonoAR } from "../services/telefono.service";
import { excelCasos } from "../services/exportacion.service";
import {
  aplicarAlias,
  cargarAliasMap,
  parsearAsesor,
  parsearSucursal,
  telefonosNormalizados,
} from "../services/normalizacion.service";

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

// Filtros del listado (los comparten el listado paginado y la exportación).
const casosFiltrosSchema = z.object({
  // Búsqueda rápida por número de orden. Como los casos sin orden se guardan con
  // el literal "S/N", escribir "S/N" en el buscador los encuentra a todos.
  busqueda: z.string().trim().min(1).optional(),
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

const casosQuerySchema = casosFiltrosSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// Arma el WHERE del listado a partir de los filtros ya validados. Incluye la
// restricción por área del usuario. Lo usan el listado y la exportación, para
// que el Excel salga EXACTAMENTE con los casos que se están viendo en pantalla.
function whereCasosDesdeFiltros(req: Request, q: z.infer<typeof casosFiltrosSchema>): Prisma.CasoWhereInput {
  return {
    eliminadoEn: null, // los casos borrados lógicamente no aparecen
    ...whereArea(req.usuario!, parsearAreaQuery(req.query.area)),
    ...(q.busqueda ? { numeroOrden: { contains: q.busqueda, mode: "insensitive" } } : {}),
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
}

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
      // Ambos tipos de contacto: si se filtraba solo por POSVENTA, los períodos
      // de las cargas de Ventas nunca aparecían en el desplegable.
      where: { eliminadoEn: null, tipo: { in: [TipoUpload.CONTACTO_POSVENTA, TipoUpload.CONTACTO_VENTAS] } },
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

  const where: Prisma.CasoWhereInput = whereCasosDesdeFiltros(req, q);

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
          // La clasificación que cuenta, no el último mensaje suelto: si no, un
          // "gracias" posterior a una queja dejaba el caso en verde.
          where: { esSeguimiento: false },
          orderBy: { analyzedAt: "desc" },
          take: 1,
          select: { semaforo: true, estrellas: true, esHistoricoImportado: true, resumenIA: true },
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

// ---------- GET /api/casos/exportar ----------
// Descarga a Excel TODOS los casos del filtro actual (sin paginar), con sus
// variables. Respeta la restricción por área igual que el listado.

export async function exportarCasos(req: Request, res: Response) {
  const parsed = casosFiltrosSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      message: `Hay filtros con formato incorrecto: ${parsed.error.errors.map((e) => e.message).join(" ")}`,
    });
  }

  const where = whereCasosDesdeFiltros(req, parsed.data);
  const buffer = await excelCasos(where);
  const fecha = new Date().toISOString().slice(0, 10);
  res
    .setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    .setHeader("Content-Disposition", `attachment; filename="casos-${fecha}.xlsx"`)
    .send(buffer);
}

// ---------- POST /api/casos ----------
// Alta MANUAL de un caso, para el cliente suelto que no vino en el Excel
// (llamó por teléfono, se lo olvidaron, entró fuera de plazo). Aplica la misma
// normalización que la importación para que no ensucie los rankings.

// Un campo obligatorio que directamente no viene devuelve "Required" en inglés:
// se le pone el mismo texto que cuando llega vacío, porque el mensaje lo lee la
// usuaria tal cual en el formulario.
const obligatorio = (mensaje: string) =>
  z.string({ required_error: mensaje, invalid_type_error: mensaje }).trim().min(1, mensaje);

const crearCasoSchema = z.object({
  nombrePropietario: obligatorio("Ingresá el nombre del cliente."),
  whatsapp: z.string().trim().optional(),
  celular: z.string().trim().optional(),
  modelo: obligatorio("Ingresá el modelo del vehículo."),
  patente: z.string().trim().optional(),
  asesor: obligatorio("Ingresá el asesor."),
  sucursal: obligatorio("Ingresá la sucursal."),
  fechaProgramacion: z
    .string({
      required_error: "Ingresá la fecha de la visita.",
      invalid_type_error: "Ingresá la fecha de la visita.",
    })
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha tiene que tener el formato AAAA-MM-DD."),
  numeroOrden: z.string().trim().optional(),
  emailPropietario: z.string().trim().email("El email no es válido.").optional().or(z.literal("")),
  origenAgendamiento: z.nativeEnum(OrigenAgendamiento).default(OrigenAgendamiento.DEALER),
  area: z.nativeEnum(AreaTrabajo).optional(),
  comentarioAsesor: z.string().trim().optional(),
});

export async function crearCasoManual(req: Request, res: Response) {
  const parsed = crearCasoSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Revisá los datos del formulario." });
  }
  const d = parsed.data;

  // Al menos un teléfono, y que sea contactable de verdad (normalizable a E.164)
  const waNorm = normalizarTelefonoAR(d.whatsapp);
  const celNorm = normalizarTelefonoAR(d.celular);
  if (!waNorm && !celNorm) {
    return res.status(400).json({
      message:
        "Ingresá un teléfono válido (WhatsApp o celular). Sin un número que se pueda normalizar, el caso no se puede contactar.",
    });
  }

  // Área: un usuario restringido solo puede crear en la suya.
  const restringido = areaPermitida(req.usuario!);
  const area = restringido ?? d.area ?? AreaTrabajo.POSVENTA;

  const fecha = new Date(`${d.fechaProgramacion}T12:00:00`);
  const periodo = d.fechaProgramacion.slice(0, 7); // AAAA-MM

  // Normalización idéntica a la de la importación (asesor/sucursal + alias)
  const [aliasAsesor, aliasSucursal] = await Promise.all([
    cargarAliasMap(TipoAlias.ASESOR),
    cargarAliasMap(TipoAlias.SUCURSAL),
  ]);
  const asesorNorm = aplicarAlias(parsearAsesor(d.asesor), aliasAsesor);
  const sucursalNorm = aplicarAlias(parsearSucursal(d.sucursal), aliasSucursal);
  const sucursalFinal = sucursalNorm.nombre || d.sucursal;
  const numeroOrden = d.numeroOrden || "S/N";

  // Número de orden único en todo el sistema: si ya existe un caso activo con esa
  // orden, no se carga y se avisa cuál es. No aplica cuando no se ingresó orden
  // (numeroOrden = "S/N": puede haber varios casos sin número de orden).
  if (d.numeroOrden) {
    const mismaOrden = await prisma.caso.findFirst({
      where: { eliminadoEn: null, numeroOrden: d.numeroOrden },
      select: { numeroOrden: true, nombrePropietario: true, sucursal: true },
    });
    if (mismaOrden) {
      return res.status(409).json({
        message:
          `Ya hay un caso con el número de orden ${mismaOrden.numeroOrden} ` +
          `(${mismaOrden.nombrePropietario}, ${mismaOrden.sucursal}). ` +
          `No se pueden repetir órdenes: revisá el número o buscá el caso existente.`,
      });
    }
  }

  // Además, misma patente el mismo día (evita recargar el mismo servicio sin orden)
  if (d.patente) {
    const mismaPatente = await prisma.caso.findFirst({
      where: {
        eliminadoEn: null,
        patente: { equals: d.patente, mode: "insensitive" },
        fechaProgramacion: fecha,
      },
      select: { numeroOrden: true, nombrePropietario: true },
    });
    if (mismaPatente) {
      return res.status(409).json({
        message: `Ya existe un caso de la patente ${d.patente} para esa fecha (orden ${mismaPatente.numeroOrden}, ${mismaPatente.nombrePropietario}). Revisá si no lo cargaste antes.`,
      });
    }
  }

  // Todo caso pertenece a una carga: se reusa (o crea) una "Carga manual" por
  // sucursal + período, para que los reportes por período sigan funcionando.
  const tipoUpload = area === AreaTrabajo.VENTAS ? TipoUpload.CONTACTO_VENTAS : TipoUpload.CONTACTO_POSVENTA;
  let upload = await prisma.excelUpload.findFirst({
    where: { tipo: tipoUpload, sucursal: sucursalFinal, periodo, filename: "Carga manual", eliminadoEn: null },
  });
  if (!upload) {
    upload = await prisma.excelUpload.create({
      data: {
        tipo: tipoUpload,
        filename: "Carga manual",
        sucursal: sucursalFinal,
        periodo,
        uploadedBy: req.usuario!.nombre,
        columnMapping: {},
        totalRows: 0,
        status: "COMPLETADO",
      },
    });
  }

  let caso;
  try {
    caso = await prisma.caso.create({
      data: {
        uploadId: upload.id,
        numeroOrden,
        fechaProgramacion: fecha,
        origenAgendamiento: d.origenAgendamiento,
        asesor: asesorNorm.nombre || d.asesor,
        asesorCodigo: asesorNorm.codigo,
        asesorRaw: d.asesor,
        modelo: d.modelo,
        patente: d.patente || "",
        nombrePropietario: d.nombrePropietario,
        emailPropietario: d.emailPropietario || null,
        celular: celNorm ?? d.celular ?? "",
        whatsapp: waNorm ?? celNorm ?? "",
        telefonosNorm: telefonosNormalizados(d.whatsapp, d.celular),
        comentarioAsesor: d.comentarioAsesor || null,
        sucursal: sucursalFinal,
        sucursalRaw: d.sucursal,
        area,
        estadoContacto: EstadoContacto.PENDIENTE,
      },
    });
  } catch (err) {
    // Red de seguridad del índice único de orden: si dos altas simultáneas
    // pasaron el chequeo de arriba, la base rechaza la segunda (P2002).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({
        message: `Ya hay un caso con el número de orden ${numeroOrden}. No se pueden repetir órdenes.`,
      });
    }
    throw err;
  }

  await auditar(req, {
    accion: ACCIONES.CASO_CREADO_MANUAL,
    entidad: "Caso",
    entidadId: caso.id,
    detalles: { numeroOrden: caso.numeroOrden, cliente: caso.nombrePropietario, sucursal: caso.sucursal, area },
  });

  res.status(201).json({
    message: `Caso de ${caso.nombrePropietario} creado. Queda en estado Pendiente, listo para contactar.`,
    data: caso,
  });
}

// ---------- PATCH /api/casos/:id ----------
// Edición de un caso para corregir datos mal cargados (nombre, teléfono, modelo,
// patente, asesor, sucursal, orden, etc.). NO toca el estado de contacto ni la
// conversación: solo los datos. Aplica la misma normalización que el alta.

export async function editarCaso(req: Request, res: Response) {
  const id = String(req.params.id ?? "").trim();
  const parsed = crearCasoSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Revisá los datos del formulario." });
  }
  const d = parsed.data;

  const existente = await prisma.caso.findFirst({
    where: { id, eliminadoEn: null },
    select: { id: true, area: true, numeroOrden: true, nombrePropietario: true },
  });
  if (!existente) {
    return res.status(404).json({ message: "No encontramos ese caso (puede haber sido eliminado)." });
  }

  // Restricción por área: un usuario restringido no puede editar un caso ajeno.
  if (!puedeAcceder(req.usuario!, existente.area)) {
    return res.status(403).json({ message: "Ese caso es de otra área: no lo podés editar." });
  }

  // Teléfono: al menos uno que normalice a E.164 (igual que en el alta).
  const waNorm = normalizarTelefonoAR(d.whatsapp);
  const celNorm = normalizarTelefonoAR(d.celular);
  if (!waNorm && !celNorm) {
    return res.status(400).json({
      message:
        "Ingresá un teléfono válido (WhatsApp o celular). Sin un número que se pueda normalizar, el caso no se puede contactar.",
    });
  }

  // Área destino: un usuario restringido no puede sacarlo de su área; uno que ve
  // todas puede corregirla. Por defecto se conserva la que tenía.
  const restringido = areaPermitida(req.usuario!);
  const area = restringido ?? d.area ?? existente.area;

  const fecha = new Date(`${d.fechaProgramacion}T12:00:00`);
  const numeroOrden = d.numeroOrden || "S/N";

  // Unicidad de orden: si cambió a una orden real, no puede chocar con OTRO caso.
  if (d.numeroOrden && d.numeroOrden !== existente.numeroOrden) {
    const mismaOrden = await prisma.caso.findFirst({
      where: { eliminadoEn: null, numeroOrden: d.numeroOrden, id: { not: existente.id } },
      select: { nombrePropietario: true, sucursal: true },
    });
    if (mismaOrden) {
      return res.status(409).json({
        message:
          `Ya hay otro caso con el número de orden ${d.numeroOrden} ` +
          `(${mismaOrden.nombrePropietario}, ${mismaOrden.sucursal}). No se pueden repetir órdenes.`,
      });
    }
  }

  // Misma normalización que el alta (asesor/sucursal + alias del ADMIN).
  const [aliasAsesor, aliasSucursal] = await Promise.all([
    cargarAliasMap(TipoAlias.ASESOR),
    cargarAliasMap(TipoAlias.SUCURSAL),
  ]);
  const asesorNorm = aplicarAlias(parsearAsesor(d.asesor), aliasAsesor);
  const sucursalNorm = aplicarAlias(parsearSucursal(d.sucursal), aliasSucursal);
  const sucursalFinal = sucursalNorm.nombre || d.sucursal;

  let caso;
  try {
    caso = await prisma.caso.update({
      where: { id: existente.id },
      data: {
        numeroOrden,
        fechaProgramacion: fecha,
        origenAgendamiento: d.origenAgendamiento,
        asesor: asesorNorm.nombre || d.asesor,
        asesorCodigo: asesorNorm.codigo,
        asesorRaw: d.asesor,
        modelo: d.modelo,
        patente: d.patente || "",
        nombrePropietario: d.nombrePropietario,
        emailPropietario: d.emailPropietario || null,
        celular: celNorm ?? d.celular ?? "",
        whatsapp: waNorm ?? celNorm ?? "",
        telefonosNorm: telefonosNormalizados(d.whatsapp, d.celular),
        comentarioAsesor: d.comentarioAsesor || null,
        sucursal: sucursalFinal,
        sucursalRaw: d.sucursal,
        area,
      },
    });
  } catch (err) {
    // Red de seguridad del índice único de orden (edición concurrente).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({
        message: `Ya hay otro caso con el número de orden ${numeroOrden}. No se pueden repetir órdenes.`,
      });
    }
    throw err;
  }

  await auditar(req, {
    accion: ACCIONES.CASO_EDITADO,
    entidad: "Caso",
    entidadId: caso.id,
    detalles: {
      ordenAntes: existente.numeroOrden,
      ordenDespues: caso.numeroOrden,
      cliente: caso.nombrePropietario,
      sucursal: caso.sucursal,
      area: caso.area,
    },
  });

  res.json({
    message: `Los datos de ${caso.nombrePropietario} se guardaron.`,
    data: caso,
  });
}
