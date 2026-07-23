import { Request, Response } from "express";
import { z } from "zod";
import { dashboardResumen } from "../services/dashboard.service";
import { areaEfectiva, parsearAreaQuery } from "../services/area.service";

const querySchema = z.object({
  fechaDesde: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha 'desde' tiene que tener el formato AAAA-MM-DD.")
    .optional(),
  fechaHasta: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha 'hasta' tiene que tener el formato AAAA-MM-DD.")
    .optional(),
  sucursal: z.string().trim().min(1).optional(),
});

export async function getDashboardResumen(req: Request, res: Response) {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      message: `Hay filtros con formato incorrecto: ${parsed.error.errors.map((e) => e.message).join(" ")}`,
    });
  }

  // Default: últimos 30 días
  const q = parsed.data;
  const hoy = new Date();
  const hace30 = new Date(hoy.getTime() - 30 * 86_400_000);
  const fechaDesde = q.fechaDesde ?? hace30.toISOString().slice(0, 10);
  const fechaHasta = q.fechaHasta ?? hoy.toISOString().slice(0, 10);

  const area = areaEfectiva(req.usuario!, parsearAreaQuery(req.query.area));
  res.json(await dashboardResumen({ fechaDesde, fechaHasta, sucursal: q.sucursal, area }));
}
