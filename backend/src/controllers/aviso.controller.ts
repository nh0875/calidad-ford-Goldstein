import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { whereAvisosVigentes } from "../services/aviso.service";

// ---------- GET /api/avisos ----------
// Alimenta el cartel rojo del encabezado. Devuelve solo los avisos vigentes del
// área del usuario; se consulta cada pocos minutos desde el frontend, así que
// tiene que ser barato: sin joins pesados y con tope de filas.

const MAX_AVISOS = 20;

export async function listAvisos(req: Request, res: Response) {
  const where = whereAvisosVigentes(req.usuario!);

  const [total, avisos] = await Promise.all([
    prisma.aviso.count({ where }),
    prisma.aviso.findMany({
      where,
      orderBy: { creadoEn: "desc" },
      take: MAX_AVISOS,
      select: {
        id: true,
        tipo: true,
        area: true,
        titulo: true,
        detalle: true,
        creadoEn: true,
        casoId: true,
        rqrId: true,
        rqr: { select: { numeroRQR: true, estado: true } },
        caso: { select: { numeroOrden: true, nombrePropietario: true, asesor: true, sucursal: true } },
      },
    }),
  ]);

  res.json({ total, data: avisos, mostrados: avisos.length });
}

// ---------- POST /api/avisos/:id/visto ----------

export async function marcarAvisoVisto(req: Request, res: Response) {
  const id = String(req.params.id ?? "").trim();

  // Se filtra por los avisos que el usuario TIENE PERMITIDO ver: uno de otra
  // área no se puede apagar aunque se mande el id a mano.
  const permitido = await prisma.aviso.findFirst({
    where: { id, ...whereAvisosVigentes(req.usuario!) },
    select: { id: true },
  });
  if (!permitido) {
    return res.status(404).json({ message: "Ese aviso no existe o ya no está vigente." });
  }

  await prisma.aviso.update({
    where: { id },
    data: { vistoEn: new Date(), vistoPorId: req.usuario!.id },
  });

  res.json({ message: "Aviso marcado como visto." });
}

// ---------- POST /api/avisos/vistos ----------
// "Marcar todos como vistos": para cuando se acumularon y ya se revisaron.

export async function marcarTodosVistos(req: Request, res: Response) {
  const vigentes = await prisma.aviso.findMany({
    where: whereAvisosVigentes(req.usuario!),
    select: { id: true },
  });

  if (vigentes.length === 0) {
    return res.json({ marcados: 0, message: "No había avisos pendientes." });
  }

  await prisma.aviso.updateMany({
    where: { id: { in: vigentes.map((a) => a.id) } },
    data: { vistoEn: new Date(), vistoPorId: req.usuario!.id },
  });

  res.json({
    marcados: vigentes.length,
    message: `Se marcaron ${vigentes.length} aviso(s) como vistos.`,
  });
}
