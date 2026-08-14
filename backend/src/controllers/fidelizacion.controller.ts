import { Request, Response } from "express";
import { EstadoFidelizacion, OrigenFidelizacion, Prisma, TipoUpload, UploadStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { marca } from "../config/marca";
import { abrirWorkbook } from "../services/excel.service";
import {
  encolarEnviosFidelizacion,
  motivoBloqueoEnvio,
  parsearPlanillaFidelizacion,
  plantillaBloqueaEnvio,
  progresoColaFidelizacion,
} from "../services/fidelizacion.service";
import {
  obtenerCredencialesMeta,
  obtenerEstadoPlantillaFidelizacion,
} from "../services/configuracion.service";
import { ACCIONES, auditar } from "../services/audit.service";

// ---------- POST /api/fidelizacion (subir Excel y detectar candidatos) ----------
// A diferencia del Contacto Posventa, acá NO hay paso de preview/confirm ni
// mapeo manual: se detecta solo (mismo formato Ford). Persiste la carga y los
// candidatos en PENDIENTE; el envío se dispara aparte con el botón.

const subirSchema = z.object({
  sucursal: z.string().trim().min(1, "Indicá la sucursal de la carga.").default("General"),
});

export async function subirFidelizacion(req: Request, res: Response) {
  if (!req.file) {
    return res.status(400).json({
      message: "No se recibió ningún archivo. Elegí el Excel de agendamientos (.xls o .xlsx).",
    });
  }

  const parsed = subirSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Revisá los datos." });
  }
  const sucursal = parsed.data.sucursal;

  let workbook;
  try {
    workbook = abrirWorkbook(req.file.buffer);
  } catch {
    return res.status(400).json({
      message: "El archivo no se pudo leer como Excel. Verificá que sea un .xls/.xlsx válido.",
    });
  }
  if (workbook.SheetNames.length === 0) {
    return res.status(400).json({ message: "El archivo Excel no tiene ninguna hoja." });
  }

  // El formato (turnos de Ford o planilla de ventas) se detecta solo por las
  // columnas: la usuaria sube el Excel que tenga y no elige nada.
  const parseo = parsearPlanillaFidelizacion(workbook, workbook.SheetNames[0]);
  if ("error" in parseo) {
    return res.status(400).json({ message: parseo.error });
  }
  const esVentas = parseo.resumen.formato === OrigenFidelizacion.VENTAS;

  const periodo = parseo.periodoSugerido ?? new Date().toISOString().slice(0, 7);

  // Persistir: la carga (ExcelUpload tipo FIDELIZACION) + un ClienteFidelizacion
  // por candidato. Los que no tienen teléfono válido quedan OMITIDO de entrada.
  const upload = await prisma.excelUpload.create({
    data: {
      tipo: TipoUpload.FIDELIZACION,
      filename: req.file.originalname,
      sucursal,
      periodo,
      uploadedBy: req.usuario?.nombre ?? "Calidad",
      columnMapping: parseo.mapping as Prisma.InputJsonValue,
      totalRows: parseo.resumen.totalFilas,
      status: UploadStatus.COMPLETADO,
    },
  });

  const registros = parseo.candidatos.map((c) => {
    const telefonosNorm = [...new Set([c.whatsappNorm, c.celularNorm].filter((t): t is string => !!t))];
    const telefono = telefonosNorm[0] ?? c.telefonoCrudo ?? "";
    return {
      uploadId: upload.id,
      origen: c.origen,
      nombre: c.nombre,
      telefono,
      telefonosNorm,
      modelo: c.modelo,
      patente: c.patente,
      asesor: c.asesor,
      numeroServicio: c.numeroServicio,
      comentarioAsesor: c.comentarioAsesor,
      fechaEntrega: c.fechaEntrega,
      // La planilla de ventas trae la provincia por fila, y es la que gobierna
      // quién ve la conversación en Seguimiento; si no vino, queda la de la carga.
      sucursal: c.provincia ?? sucursal,
      // Las filas con motivo (sin teléfono, teléfono repetido) NO se envían.
      estado: c.motivoOmision ? EstadoFidelizacion.OMITIDO : EstadoFidelizacion.PENDIENTE,
      error: c.motivoOmision,
    };
  });

  if (registros.length > 0) {
    await prisma.clienteFidelizacion.createMany({ data: registros });
  }

  const pendientes = registros.filter((r) => r.estado === EstadoFidelizacion.PENDIENTE).length;

  await auditar(req, {
    accion: ACCIONES.EXCEL_IMPORTADO,
    entidad: "ExcelUpload",
    entidadId: upload.id,
    detalles: {
      tipo: "FIDELIZACION",
      formato: parseo.resumen.formato,
      sucursal,
      totalFilas: parseo.resumen.totalFilas,
      candidatos: registros.length,
      pendientes,
      ...(esVentas
        ? {
            noElegibles: parseo.resumen.noElegibles,
            duplicados: parseo.resumen.duplicados,
          }
        : {
            fueraDeRango: parseo.resumen.servicioFueraDeRango,
            sinService: parseo.resumen.sinServicio,
          }),
      sinTelefono: parseo.resumen.sinTelefono,
    },
  });

  const r = parseo.resumen;
  const message = esVentas
    ? `Planilla de ventas: de ${r.totalFilas} fila(s) se tomaron ${registros.length} ${marca.nombre} 0km ` +
      `(${pendientes} listos para el recordatorio). ` +
      `${r.noElegibles} no eran ${marca.nombre} 0km (usados, venta directa u otra marca), ` +
      `${r.duplicados} tenían un teléfono repetido y ${r.sinTelefono} no tenían teléfono usable: ` +
      `esos NO reciben el mensaje.`
    : `Carga lista: se detectaron ${registros.length} cliente(s) con service 1° a 5° pendiente ` +
      `(${pendientes} con teléfono, listos para el recordatorio). ` +
      `${r.servicioFueraDeRango} tenían un service 6° o superior y ` +
      `${r.sinServicio} no eran un service de mantenimiento: esos NO reciben recordatorio.`;

  res.status(201).json({
    message,
    uploadId: upload.id,
    formato: r.formato,
    resumen: r,
    pendientes,
  });
}

// ---------- GET /api/fidelizacion (listado de cargas) ----------

export async function listarFidelizacion(_req: Request, res: Response) {
  const uploads = await prisma.excelUpload.findMany({
    where: { tipo: TipoUpload.FIDELIZACION, eliminadoEn: null },
    orderBy: { uploadedAt: "desc" },
    take: 100,
  });

  const ids = uploads.map((u) => u.id);

  // Conteos por estado para cada carga (una sola consulta agrupada) y de qué
  // planilla salió cada carga (turnos de Ford o ventas), para mostrarlo en la lista.
  const [conteos, origenes] = await Promise.all([
    prisma.clienteFidelizacion.groupBy({
      by: ["uploadId", "estado"],
      where: { uploadId: { in: ids }, eliminadoEn: null },
      _count: { _all: true },
    }),
    prisma.clienteFidelizacion.groupBy({
      by: ["uploadId", "origen"],
      where: { uploadId: { in: ids }, eliminadoEn: null },
      _count: { _all: true },
    }),
  ]);

  const porUpload = new Map<string, Record<string, number>>();
  for (const c of conteos) {
    const m = porUpload.get(c.uploadId) ?? {};
    m[c.estado] = c._count._all;
    porUpload.set(c.uploadId, m);
  }

  // Una carga sale de un solo archivo, así que tiene un solo origen; igual se
  // toma el mayoritario por si alguna carga vieja quedara mezclada.
  const origenPorUpload = new Map<string, { origen: OrigenFidelizacion; filas: number }>();
  for (const o of origenes) {
    const actual = origenPorUpload.get(o.uploadId);
    if (!actual || o._count._all > actual.filas) {
      origenPorUpload.set(o.uploadId, { origen: o.origen, filas: o._count._all });
    }
  }

  res.json({
    data: uploads.map((u) => {
      const e = porUpload.get(u.id) ?? {};
      return {
        id: u.id,
        filename: u.filename,
        origen: origenPorUpload.get(u.id)?.origen ?? OrigenFidelizacion.TURNOS,
        sucursal: u.sucursal,
        periodo: u.periodo,
        uploadedBy: u.uploadedBy,
        uploadedAt: u.uploadedAt,
        totalRows: u.totalRows,
        pendientes: e[EstadoFidelizacion.PENDIENTE] ?? 0,
        enviados: e[EstadoFidelizacion.ENVIADO] ?? 0,
        errores: e[EstadoFidelizacion.ERROR] ?? 0,
        omitidos: e[EstadoFidelizacion.OMITIDO] ?? 0,
      };
    }),
  });
}

// ---------- GET /api/fidelizacion/:id (detalle con la lista de clientes) ----------

export async function detalleFidelizacion(req: Request, res: Response) {
  const upload = await prisma.excelUpload.findFirst({
    where: { id: req.params.id, tipo: TipoUpload.FIDELIZACION, eliminadoEn: null },
  });
  if (!upload) return res.status(404).json({ message: "No se encontró la carga de fidelización." });

  const clientes = await prisma.clienteFidelizacion.findMany({
    where: { uploadId: upload.id, eliminadoEn: null },
    // En VENTAS no hay service: esas filas ordenan por nombre (numeroServicio es
    // null y Postgres los manda al final, así que el orden queda estable igual).
    orderBy: [{ numeroServicio: "asc" }, { nombre: "asc" }],
  });

  res.json({
    upload: {
      id: upload.id,
      filename: upload.filename,
      origen: clientes[0]?.origen ?? OrigenFidelizacion.TURNOS,
      sucursal: upload.sucursal,
      periodo: upload.periodo,
      uploadedAt: upload.uploadedAt,
      totalRows: upload.totalRows,
    },
    clientes: clientes.map((c) => ({
      id: c.id,
      origen: c.origen,
      nombre: c.nombre,
      telefono: c.telefono,
      modelo: c.modelo,
      patente: c.patente,
      asesor: c.asesor,
      numeroServicio: c.numeroServicio,
      fechaEntrega: c.fechaEntrega,
      sucursal: c.sucursal,
      estado: c.estado,
      error: c.error,
      enviadoEn: c.enviadoEn,
      comentarioAsesor: c.comentarioAsesor,
    })),
  });
}

// ---------- POST /api/fidelizacion/:id/enviar (encolar recordatorios) ----------

export async function enviarFidelizacion(req: Request, res: Response) {
  const upload = await prisma.excelUpload.findFirst({
    where: { id: req.params.id, tipo: TipoUpload.FIDELIZACION, eliminadoEn: null },
  });
  if (!upload) return res.status(404).json({ message: "No se encontró la carga de fidelización." });

  // Sin credenciales de Meta o sin la plantilla aprobada no tiene sentido encolar.
  const bloqueo = await motivoBloqueoEnvio();
  if (bloqueo) return res.status(409).json({ message: bloqueo });

  const encolados = await encolarEnviosFidelizacion(upload.id);

  if (encolados === 0) {
    return res.json({
      message: "No hay recordatorios pendientes para enviar en esta carga.",
      encolados: 0,
    });
  }

  await auditar(req, {
    accion: ACCIONES.CAMPANA_ENVIADA,
    entidad: "ExcelUpload",
    entidadId: upload.id,
    detalles: { tipo: "FIDELIZACION", encolados },
  });

  res.json({
    message: `Se encolaron ${encolados} recordatorio(s) de fidelización. Empezarán a salir en breve.`,
    encolados,
  });
}

// ---------- GET /api/fidelizacion/progreso ----------

export async function progresoFidelizacion(_req: Request, res: Response) {
  res.json(await progresoColaFidelizacion());
}

// ---------- GET /api/fidelizacion/plantilla (estado de la plantilla en Meta) ----------

export async function estadoPlantillaFidelizacion(_req: Request, res: Response) {
  const [creds, estado] = await Promise.all([
    obtenerCredencialesMeta(),
    obtenerEstadoPlantillaFidelizacion(),
  ]);
  res.json({
    templateName: creds.fidelizacionTemplateName,
    estado, // "APPROVED" | "PENDING" | "REJECTED" | ... | "" (sin confirmar)
    aprobada: estado.toUpperCase() === "APPROVED",
    // Se puede intentar enviar si está aprobada o si todavía no hay confirmación
    // de Meta (en ese caso, un fallo del envío avisará el motivo real).
    puedeEnviar: !plantillaBloqueaEnvio(estado),
  });
}

// ---------- DELETE /api/fidelizacion/:id (borrado lógico, solo ADMIN) ----------

export async function eliminarFidelizacion(req: Request, res: Response) {
  const upload = await prisma.excelUpload.findFirst({
    where: { id: req.params.id, tipo: TipoUpload.FIDELIZACION, eliminadoEn: null },
  });
  if (!upload) return res.status(404).json({ message: "No se encontró la carga de fidelización." });

  await prisma.excelUpload.update({
    where: { id: upload.id },
    data: { eliminadoEn: new Date(), eliminadoPorId: req.usuario?.id ?? null },
  });

  await auditar(req, {
    accion: ACCIONES.EXCEL_UPLOAD_ELIMINADO,
    entidad: "ExcelUpload",
    entidadId: upload.id,
    detalles: { tipo: "FIDELIZACION", filename: upload.filename },
  });

  res.json({ message: "Carga de fidelización eliminada." });
}
