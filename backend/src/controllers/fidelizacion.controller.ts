import { Request, Response } from "express";
import { EstadoFidelizacion, Prisma, TipoUpload, UploadStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { abrirWorkbook } from "../services/excel.service";
import {
  encolarEnviosFidelizacion,
  parsearFidelizacion,
  progresoColaFidelizacion,
} from "../services/fidelizacion.service";
import { estadoMeta } from "../services/configuracion.service";
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

  const parseo = parsearFidelizacion(workbook, workbook.SheetNames[0]);
  if ("error" in parseo) {
    return res.status(400).json({ message: parseo.error });
  }

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
    const sinTelefono = telefonosNorm.length === 0;
    return {
      uploadId: upload.id,
      nombre: c.nombre,
      telefono,
      telefonosNorm,
      modelo: c.modelo,
      patente: c.patente,
      asesor: c.asesor,
      numeroServicio: c.numeroServicio,
      comentarioAsesor: c.comentarioAsesor,
      sucursal,
      estado: sinTelefono ? EstadoFidelizacion.OMITIDO : EstadoFidelizacion.PENDIENTE,
      error: sinTelefono ? "Sin teléfono válido (WhatsApp/celular)." : null,
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
      sucursal,
      totalFilas: parseo.resumen.totalFilas,
      candidatos: registros.length,
      pendientes,
      fueraDeRango: parseo.resumen.servicioFueraDeRango,
      sinService: parseo.resumen.sinServicio,
      sinTelefono: parseo.resumen.sinTelefono,
    },
  });

  res.status(201).json({
    message:
      `Carga lista: se detectaron ${registros.length} cliente(s) con service 1° a 5° pendiente ` +
      `(${pendientes} con teléfono, listos para el recordatorio). ` +
      `${parseo.resumen.servicioFueraDeRango} tenían un service 6° o superior y ` +
      `${parseo.resumen.sinServicio} no eran un service de mantenimiento: esos NO reciben recordatorio.`,
    uploadId: upload.id,
    resumen: parseo.resumen,
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

  // Conteos por estado para cada carga (una sola consulta agrupada).
  const conteos = await prisma.clienteFidelizacion.groupBy({
    by: ["uploadId", "estado"],
    where: { uploadId: { in: uploads.map((u) => u.id) } },
    _count: { _all: true },
  });

  const porUpload = new Map<string, Record<string, number>>();
  for (const c of conteos) {
    const m = porUpload.get(c.uploadId) ?? {};
    m[c.estado] = c._count._all;
    porUpload.set(c.uploadId, m);
  }

  res.json({
    data: uploads.map((u) => {
      const e = porUpload.get(u.id) ?? {};
      return {
        id: u.id,
        filename: u.filename,
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
    where: { uploadId: upload.id },
    orderBy: [{ numeroServicio: "asc" }, { nombre: "asc" }],
  });

  res.json({
    upload: {
      id: upload.id,
      filename: upload.filename,
      sucursal: upload.sucursal,
      periodo: upload.periodo,
      uploadedAt: upload.uploadedAt,
      totalRows: upload.totalRows,
    },
    clientes: clientes.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      telefono: c.telefono,
      modelo: c.modelo,
      patente: c.patente,
      asesor: c.asesor,
      numeroServicio: c.numeroServicio,
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

  // Sin credenciales de Meta (y sin MODO_DEMO) no tiene sentido encolar.
  if (!env.modoDemo) {
    const meta = await estadoMeta();
    if (!meta.completo) {
      return res.status(409).json({
        message:
          "Faltan las credenciales de WhatsApp en Configuración (token y phone number ID de Meta). " +
          "Cargálas y probá la conexión antes de enviar.",
      });
    }
  }

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
