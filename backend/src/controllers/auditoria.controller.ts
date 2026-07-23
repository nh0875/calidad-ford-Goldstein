import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma";

// GET /api/auditoria — solo ADMIN (lo exige la ruta). Consulta de solo lectura
// sobre AuditLog. No hay endpoints de escritura/borrado: la tabla es inmutable.

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
  usuarioId: z.string().trim().min(1).optional(),
  accion: z.string().trim().min(1).optional(),
  entidad: z.string().trim().min(1).optional(),
  ip: z.string().trim().min(1).optional(), // búsqueda libre (contiene)
  fechaDesde: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha 'desde' tiene que tener el formato AAAA-MM-DD.")
    .optional(),
  fechaHasta: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha 'hasta' tiene que tener el formato AAAA-MM-DD.")
    .optional(),
});

export async function listAuditoria(req: Request, res: Response) {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      message: `Hay filtros con formato incorrecto: ${parsed.error.errors.map((e) => e.message).join(" ")}`,
    });
  }
  const q = parsed.data;

  const where: Prisma.AuditLogWhereInput = {
    ...(q.usuarioId ? { usuarioId: q.usuarioId } : {}),
    ...(q.accion ? { accion: q.accion } : {}),
    ...(q.entidad ? { entidad: q.entidad } : {}),
    ...(q.ip ? { ip: { contains: q.ip, mode: "insensitive" } } : {}),
    ...(q.fechaDesde || q.fechaHasta
      ? {
          createdAt: {
            ...(q.fechaDesde ? { gte: new Date(`${q.fechaDesde}T00:00:00`) } : {}),
            ...(q.fechaHasta ? { lte: new Date(`${q.fechaHasta}T23:59:59.999`) } : {}),
          },
        }
      : {}),
  };

  const [total, data] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { usuario: { select: { id: true, nombre: true, email: true, rol: true } } },
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

// Catálogo de acciones/entidades presentes, para poblar los filtros del frontend.
export async function opcionesAuditoria(_req: Request, res: Response) {
  const [acciones, entidades] = await Promise.all([
    prisma.auditLog.findMany({ distinct: ["accion"], select: { accion: true }, orderBy: { accion: "asc" } }),
    prisma.auditLog.findMany({ distinct: ["entidad"], select: { entidad: true }, orderBy: { entidad: "asc" } }),
  ]);
  res.json({
    acciones: acciones.map((a) => a.accion),
    entidades: entidades.map((e) => e.entidad),
  });
}
