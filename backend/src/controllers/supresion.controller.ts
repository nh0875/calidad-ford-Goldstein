import { Request, Response } from "express";
import { MotivoSupresion, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { ACCIONES, auditar } from "../services/audit.service";
import { agregarSupresion } from "../services/supresion.service";
import { normalizarTelefonoAR } from "../services/telefono.service";

// GET /api/supresion — lista con filtros (solo ADMIN, lo exige la ruta)
const listSchema = z.object({
  motivo: z.nativeEnum(MotivoSupresion).optional(),
  q: z.string().trim().min(1).optional(), // teléfono contiene
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export async function listSupresion(req: Request, res: Response) {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Filtros inválidos." });
  const q = parsed.data;

  const where: Prisma.SupresionContactoWhereInput = {
    ...(q.motivo ? { motivo: q.motivo } : {}),
    ...(q.q ? { telefono: { contains: q.q.replace(/\s/g, "") } } : {}),
  };

  const [total, data] = await Promise.all([
    prisma.supresionContacto.count({ where }),
    prisma.supresionContacto.findMany({
      where,
      orderBy: { creadoEn: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        creadoPor: { select: { nombre: true } },
        casoOrigen: { select: { numeroOrden: true, nombrePropietario: true } },
      },
    }),
  ]);

  res.json({
    data,
    pagination: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) },
  });
}

// POST /api/supresion — alta manual (baja pedida por teléfono/presencial)
const addSchema = z.object({
  telefono: z.string().trim().min(6, "Ingresá un teléfono."),
  motivo: z.nativeEnum(MotivoSupresion).default(MotivoSupresion.SOLICITUD_MANUAL),
  notas: z.string().trim().min(1).optional(),
});

export async function addSupresion(req: Request, res: Response) {
  const parsed = addSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Datos inválidos." });
  }

  const tel = normalizarTelefonoAR(parsed.data.telefono);
  if (!tel) {
    return res.status(400).json({ message: "El teléfono no es válido (no se pudo normalizar a formato internacional)." });
  }

  const resultado = await agregarSupresion({
    telefono: tel,
    motivo: parsed.data.motivo,
    creadoPorId: req.usuario!.id,
    notas: parsed.data.notas ?? null,
  });

  if (resultado.yaExistia) {
    return res.status(200).json({ message: `El teléfono ${tel} ya estaba en la lista de supresión.`, yaExistia: true });
  }

  await auditar(req, {
    accion: ACCIONES.SUPRESION_AGREGADA,
    entidad: "SupresionContacto",
    detalles: { telefono: tel, motivo: parsed.data.motivo, manual: true },
  });

  res.status(201).json({ message: `${tel} agregado a la lista de supresión.` });
}

// DELETE /api/supresion/:id — quitar de la lista (motivo obligatorio, auditado)
const removeSchema = z.object({
  motivo: z.string().trim().min(3, "Indicá el motivo por el que quitás el teléfono de la lista."),
});

export async function removeSupresion(req: Request, res: Response) {
  const parsed = removeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Falta el motivo." });
  }

  const sup = await prisma.supresionContacto.findUnique({ where: { id: req.params.id } });
  if (!sup) return res.status(404).json({ message: "No se encontró ese teléfono en la lista." });

  await prisma.supresionContacto.delete({ where: { id: sup.id } });

  await auditar(req, {
    accion: ACCIONES.SUPRESION_ELIMINADA,
    entidad: "SupresionContacto",
    entidadId: sup.id,
    detalles: { telefono: sup.telefono, motivoOriginal: sup.motivo, motivoBaja: parsed.data.motivo },
  });

  res.json({ message: `${sup.telefono} quitado de la lista de supresión. Podrá volver a recibir campañas.` });
}
