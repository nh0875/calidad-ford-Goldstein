import { Request, Response } from "express";
import { z } from "zod";
import { marca } from "../config/marca";
import { DEFINICION_ITEMS } from "../config/posventa-vw";
import { reporteDesempenoPosventa } from "../services/reporte-posventa.service";
import { excelDesempenoPosventa, wordDesempenoPosventa } from "../services/exportacion-posventa.service";
import { areaPermitida } from "../services/area.service";

// Filtros del reporte. El área NO es un filtro: este reporte es de Posventa por
// definición, así que un usuario restringido a Ventas no tiene nada que ver acá
// (lo corta requirePosventaPorItems + el chequeo de abajo).
const filtrosSchema = z.object({
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
});

/** Un usuario restringido a VENTAS no puede ver el desempeño de Posventa. */
function puedeVerPosventa(req: Request): boolean {
  const restringido = areaPermitida(req.usuario!); // null = ve todo
  return restringido === null || restringido === "POSVENTA";
}

export async function getDesempenoPosventa(req: Request, res: Response) {
  const parsed = filtrosSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors.map((e) => e.message).join(" ") });
  }
  if (!puedeVerPosventa(req)) {
    return res.status(403).json({ message: "Este reporte es del área de Posventa." });
  }
  const data = await reporteDesempenoPosventa(parsed.data);
  res.json({ data, items: DEFINICION_ITEMS });
}

function nombreArchivo(ext: string): string {
  const hoy = new Date();
  const f = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
  return `desempeno-posventa-${marca.nombre.toLowerCase()}-${f}.${ext}`;
}

export async function exportarDesempenoExcel(req: Request, res: Response) {
  const parsed = filtrosSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors.map((e) => e.message).join(" ") });
  }
  if (!puedeVerPosventa(req)) {
    return res.status(403).json({ message: "Este reporte es del área de Posventa." });
  }
  const buffer = await excelDesempenoPosventa(parsed.data);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo("xlsx")}"`);
  res.send(buffer);
}

export async function exportarDesempenoWord(req: Request, res: Response) {
  const parsed = filtrosSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors.map((e) => e.message).join(" ") });
  }
  if (!puedeVerPosventa(req)) {
    return res.status(403).json({ message: "Este reporte es del área de Posventa." });
  }
  const buffer = await wordDesempenoPosventa(parsed.data);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo("docx")}"`);
  res.send(buffer);
}
