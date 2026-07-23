import { Request, Response } from "express";
import { z } from "zod";
import {
  abrirWorkbook,
  borrarArchivoTemporal,
  guardarArchivoTemporal,
  leerArchivoTemporal,
} from "../services/excel.service";
import { CAMPOS_FORD, parsearHojaFord } from "../services/encuesta-ford.service";
import { importarEncuestaFord } from "../services/importacion-ford.service";
import { auditar } from "../services/audit.service";

const FILAS_PREVIEW = 5;

// ---------- POST /api/uploads/ford (preview) ----------

export async function previewFord(req: Request, res: Response) {
  if (!req.file) {
    return res.status(400).json({ message: "No se recibió ningún archivo. Elegí el Excel de invitaciones de Ford (.xlsx)." });
  }

  let workbook;
  try {
    workbook = abrirWorkbook(req.file.buffer);
  } catch {
    return res.status(400).json({ message: "El archivo no se pudo leer como Excel. Verificá que sea un .xlsx válido." });
  }
  if (workbook.SheetNames.length === 0) {
    return res.status(400).json({ message: "El archivo Excel no tiene ninguna hoja." });
  }

  const hoja = parsearHojaFord(workbook, workbook.SheetNames[0]);
  if ("error" in hoja) {
    return res.status(400).json({ message: hoja.error });
  }

  const fileToken = guardarArchivoTemporal(req.file.buffer, req.file.originalname);

  res.json({
    fileToken,
    filename: req.file.originalname,
    filaEncabezado: hoja.filaEncabezado + 1, // 1-based, como se ve en Excel
    columnas: hoja.columnas,
    mappingSugerido: hoja.mappingSugerido,
    totalFilasDatos: hoja.filas.length,
    preview: hoja.filas.slice(0, FILAS_PREVIEW).map((f) => f.datos),
    camposFord: CAMPOS_FORD,
  });
}

// ---------- POST /api/uploads/ford/confirm ----------

const confirmSchema = z.object({
  fileToken: z.string().uuid("El identificador del archivo no es válido. Volvé a subir el Excel."),
  mapping: z.record(
    z.string(),
    z.enum(CAMPOS_FORD, { errorMap: () => ({ message: "Hay una columna mapeada a un campo que no existe." }) })
  ),
});

export async function confirmFord(req: Request, res: Response) {
  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors.map((e) => e.message).join(" ") });
  }

  const archivo = leerArchivoTemporal(parsed.data.fileToken);
  if (!archivo) {
    return res.status(410).json({
      message: "El archivo ya no está disponible en el servidor. Volvé a subir el Excel desde el paso 1.",
    });
  }

  const resumen = await importarEncuestaFord({
    buffer: archivo.buffer,
    filename: archivo.filename,
    mapping: parsed.data.mapping,
    uploadedBy: req.usuario?.nombre ?? "Calidad",
    auditar: (d) => auditar(req, d),
  });

  borrarArchivoTemporal(parsed.data.fileToken);

  const t = resumen.tareasNuevas;
  res.status(201).json({
    message:
      `Importación de encuesta Ford terminada: ${resumen.matcheados} casos cruzados, ` +
      `${resumen.respondidas} respondieron, ${t.RECORDAR_ENCUESTA + t.VERIFICAR_EMAIL} tareas nuevas ` +
      `(${t.RECORDAR_ENCUESTA} recordar encuesta, ${t.VERIFICAR_EMAIL} verificar email), ` +
      `${resumen.cerradasAuto} cerradas y ${resumen.canceladasAuto} canceladas automáticamente, ` +
      `${resumen.sinMatchear.length} sin cruzar.`,
    resumen,
  });
}
