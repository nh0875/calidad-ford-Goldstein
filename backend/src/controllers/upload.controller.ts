import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import {
  CAMPOS_CASO,
  abrirWorkbook,
  borrarArchivoTemporal,
  derivarPeriodo,
  guardarArchivoTemporal,
  leerArchivoTemporal,
  parsearHoja,
  sugerirMapeo,
} from "../services/excel.service";
import { importarHojas } from "../services/importacion.service";
import { ACCIONES, auditar } from "../services/audit.service";

const FILAS_PREVIEW = 5;

// ---------- POST /api/uploads (preview, no guarda nada en la base) ----------

const previewQuerySchema = z.object({
  anio: z.coerce
    .number()
    .int()
    .min(2000, "El año tiene que ser un número de 4 cifras, por ejemplo 2026.")
    .max(2100, "El año tiene que ser un número de 4 cifras, por ejemplo 2026.")
    .optional(),
});

export async function previewUpload(req: Request, res: Response) {
  if (!req.file) {
    return res.status(400).json({
      message: "No se recibió ningún archivo. Elegí el Excel de Contacto Posterior (.xlsx) y volvé a intentar.",
    });
  }

  const query = previewQuerySchema.safeParse({ anio: req.body?.anio ?? req.query?.anio });
  const anio = query.success && query.data.anio ? query.data.anio : new Date().getFullYear();

  let workbook;
  try {
    workbook = abrirWorkbook(req.file.buffer);
  } catch {
    return res.status(400).json({
      message: "El archivo no se pudo leer como Excel. Verificá que sea un .xlsx válido (no un PDF ni un CSV renombrado).",
    });
  }

  if (workbook.SheetNames.length === 0) {
    return res.status(400).json({ message: "El archivo Excel no tiene ninguna hoja." });
  }

  const fileToken = guardarArchivoTemporal(req.file.buffer, req.file.originalname);

  const hojas = workbook.SheetNames.map((nombre) => {
    const parseada = parsearHoja(workbook, nombre);
    if ("error" in parseada) {
      return { nombre, ok: false as const, error: parseada.error };
    }
    return {
      nombre,
      ok: true as const,
      periodoSugerido: derivarPeriodo(nombre, anio),
      filaEncabezado: parseada.filaEncabezado + 1, // 1-based, como se ve en Excel
      columnas: parseada.columnas,
      mappingSugerido: sugerirMapeo(parseada.columnas),
      kpisResumen: parseada.kpisResumen,
      totalFilasDatos: parseada.filas.length,
      preview: parseada.filas.slice(0, FILAS_PREVIEW).map((f) => f.datos),
    };
  });

  res.json({
    fileToken,
    filename: req.file.originalname,
    anio,
    hojas,
  });
}

// ---------- POST /api/uploads/confirm ----------

const confirmSchema = z.object({
  fileToken: z.string().uuid("El identificador del archivo no es válido. Volvé a subir el Excel."),
  sucursal: z
    .string({ required_error: "Falta indicar la sucursal." })
    .trim()
    .min(1, "Falta indicar la sucursal."),
  anio: z.coerce
    .number({ invalid_type_error: "El año tiene que ser un número, por ejemplo 2026." })
    .int()
    .min(2000, "El año tiene que ser un número de 4 cifras, por ejemplo 2026.")
    .max(2100, "El año tiene que ser un número de 4 cifras, por ejemplo 2026."),
  uploadedBy: z.string().trim().min(1).default("Calidad"),
  // Área de la carga: POSVENTA (Contacto Posventa, por defecto) o VENTAS
  // (Contacto Ventas). Mismo formato de Excel; solo cambia el área asignada.
  area: z.enum(["POSVENTA", "VENTAS"]).default("POSVENTA"),
  hojas: z
    .array(
      z.object({
        nombre: z.string().trim().min(1, "Falta el nombre de la hoja."),
        periodo: z
          .string()
          .regex(/^\d{4}-\d{2}$/, "El período tiene que tener el formato AAAA-MM, por ejemplo 2026-01.")
          .optional(),
        mapping: z.record(
          z.string(),
          z.enum(CAMPOS_CASO, {
            errorMap: () => ({ message: "Hay una columna mapeada a un campo que no existe." }),
          })
        ),
      })
    )
    .min(1, "Elegí al menos una hoja (mes) para importar."),
});

export async function confirmUpload(req: Request, res: Response) {
  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) {
    const detalles = parsed.error.errors.map((e) => e.message);
    return res.status(400).json({
      message: `Revisá el formulario antes de confirmar: ${[...new Set(detalles)].join(" ")}`,
    });
  }

  const { fileToken, sucursal, anio, uploadedBy, area, hojas } = parsed.data;

  const archivo = leerArchivoTemporal(fileToken);
  if (!archivo) {
    return res.status(410).json({
      message:
        "El archivo ya no está disponible en el servidor (los archivos se guardan por 24 horas o hasta confirmar la carga). " +
        "Volvé a subir el Excel desde el paso 1.",
    });
  }

  const resultado = await importarHojas({
    buffer: archivo.buffer,
    filename: archivo.filename,
    sucursal,
    anio,
    uploadedBy,
    hojas,
    tipo: area === "VENTAS" ? "CONTACTO_VENTAS" : "CONTACTO_POSVENTA",
    area,
  });

  // Si todas las hojas se procesaron, el archivo temporal ya no hace falta
  if (resultado.resultados.every((r) => r.ok)) {
    borrarArchivoTemporal(fileToken);
  }

  await auditar(req, {
    accion: ACCIONES.EXCEL_IMPORTADO,
    entidad: "ExcelUpload",
    detalles: {
      sucursal,
      anio,
      hojas: hojas.map((h) => h.nombre),
      insertados: resultado.totales.insertados,
      duplicados: resultado.totales.duplicados,
      conError: resultado.totales.conError,
    },
  });

  const t = resultado.totales;
  const message =
    `Carga finalizada: ${t.insertados} casos nuevos guardados, ` +
    `${t.duplicados} ya existían y se omitieron, ${t.conError} filas con problemas. ` +
    `${t.historicosConSentimiento} casos históricos quedaron clasificados con semáforo ` +
    `(${t.semaforo.VERDE} verdes, ${t.semaforo.AMARILLO} amarillos, ${t.semaforo.ROJO} rojos).` +
    (t.suprimidos > 0
      ? ` ${t.suprimidos} caso(s) son de clientes que solicitaron no ser contactados: quedaron cargados pero nunca entrarán en una campaña.`
      : "");

  res.status(resultado.resultados.some((r) => r.ok) ? 201 : 400).json({
    message,
    ...resultado,
  });
}

// ---------- GET /api/uploads ----------

export async function listUploads(_req: Request, res: Response) {
  const uploads = await prisma.excelUpload.findMany({
    where: { eliminadoEn: null },
    orderBy: { uploadedAt: "desc" },
    take: 100,
    include: { _count: { select: { casos: { where: { eliminadoEn: null } } } } },
  });

  res.json({
    data: uploads.map((u) => ({
      id: u.id,
      filename: u.filename,
      sucursal: u.sucursal,
      periodo: u.periodo,
      uploadedBy: u.uploadedBy,
      uploadedAt: u.uploadedAt,
      status: u.status,
      totalRows: u.totalRows,
      casosCargados: u._count.casos,
      kpisResumen: u.kpiResumen,
    })),
  });
}
