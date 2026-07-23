import { Request, Response } from "express";
import { z } from "zod";
import { reporteCausaRaiz, reporteSentimiento } from "../services/reporte.service";
import { excelReporteCausaRaiz, excelReporteSentimiento } from "../services/exportacion.service";
import { CATEGORIAS_CAUSA_RAIZ } from "../services/sentiment.service";
import { areaEfectiva, parsearAreaQuery } from "../services/area.service";

// Filtros compartidos por ambas pantallas de reportes (misma semántica que /api/casos)
const filtrosBaseSchema = z.object({
  fechaDesde: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha 'desde' tiene que tener el formato AAAA-MM-DD.")
    .optional(),
  fechaHasta: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha 'hasta' tiene que tener el formato AAAA-MM-DD.")
    .optional(),
  sucursal: z.string().trim().min(1).optional(),
  asesor: z.string().trim().min(1).optional(),
  periodo: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "El período tiene que tener el formato AAAA-MM.")
    .optional(),
});

const filtrosCausaRaizSchema = filtrosBaseSchema.extend({
  categoria: z.enum(CATEGORIAS_CAUSA_RAIZ).optional(),
  incluirAmarilloSinRqr: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

function responderErrorFiltros(res: Response, error: z.ZodError) {
  return res.status(400).json({
    message: `Hay filtros con formato incorrecto: ${error.errors.map((e) => e.message).join(" ")}`,
  });
}

// ---------- Sentimiento ----------

export async function getReporteSentimiento(req: Request, res: Response) {
  const parsed = filtrosBaseSchema.safeParse(req.query);
  if (!parsed.success) return responderErrorFiltros(res, parsed.error);
  const area = areaEfectiva(req.usuario!, parsearAreaQuery(req.query.area));
  res.json(await reporteSentimiento({ ...parsed.data, area }));
}

export async function exportarReporteSentimiento(req: Request, res: Response) {
  const parsed = filtrosBaseSchema.safeParse(req.query);
  if (!parsed.success) return responderErrorFiltros(res, parsed.error);

  const area = areaEfectiva(req.usuario!, parsearAreaQuery(req.query.area));
  const buffer = await excelReporteSentimiento({ ...parsed.data, area });
  const fecha = new Date().toISOString().slice(0, 10);
  res
    .setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    .setHeader("Content-Disposition", `attachment; filename="reporte-sentimiento-${fecha}.xlsx"`)
    .send(buffer);
}

// ---------- Causa raíz ----------

export async function getReporteCausaRaiz(req: Request, res: Response) {
  const parsed = filtrosCausaRaizSchema.safeParse(req.query);
  if (!parsed.success) return responderErrorFiltros(res, parsed.error);
  const area = areaEfectiva(req.usuario!, parsearAreaQuery(req.query.area));
  res.json(await reporteCausaRaiz({ ...parsed.data, area }));
}

export async function exportarReporteCausaRaiz(req: Request, res: Response) {
  const parsed = filtrosCausaRaizSchema.safeParse(req.query);
  if (!parsed.success) return responderErrorFiltros(res, parsed.error);

  const area = areaEfectiva(req.usuario!, parsearAreaQuery(req.query.area));
  const buffer = await excelReporteCausaRaiz({ ...parsed.data, area });
  const fecha = new Date().toISOString().slice(0, 10);
  res
    .setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    .setHeader("Content-Disposition", `attachment; filename="reporte-causa-raiz-${fecha}.xlsx"`)
    .send(buffer);
}
