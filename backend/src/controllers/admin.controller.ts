import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { ACCIONES, auditar } from "../services/audit.service";
import { recalcularTieneRqrAbierto } from "../services/rqr.service";

// Borrado lógico y restauración. TODO esto es solo ADMIN (lo exige la ruta con
// requireAdmin). Nunca se borra físicamente: se marca eliminadoEn/eliminadoPorId
// y los listados excluyen esas filas, pero los datos quedan recuperables.

// ---------- DELETE /api/casos/:id ----------

export async function eliminarCaso(req: Request, res: Response) {
  const caso = await prisma.caso.findUnique({ where: { id: req.params.id } });
  if (!caso || caso.eliminadoEn) {
    return res.status(404).json({ message: "No se encontró ese caso (o ya estaba eliminado)." });
  }

  await prisma.caso.update({
    where: { id: caso.id },
    data: { eliminadoEn: new Date(), eliminadoPorId: req.usuario!.id },
  });

  await auditar(req, {
    accion: ACCIONES.CASO_ELIMINADO,
    entidad: "Caso",
    entidadId: caso.id,
    detalles: { numeroOrden: caso.numeroOrden, sucursal: caso.sucursal, cliente: caso.nombrePropietario },
  });

  res.json({ message: `El caso de orden ${caso.numeroOrden} se eliminó (recuperable desde auditoría).` });
}

// ---------- DELETE /api/rqr/:id ----------

export async function eliminarRqr(req: Request, res: Response) {
  const rqr = await prisma.rQR.findUnique({ where: { id: req.params.id } });
  if (!rqr || rqr.eliminadoEn) {
    return res.status(404).json({ message: "No se encontró ese RQR (o ya estaba eliminado)." });
  }

  await prisma.rQR.update({
    where: { id: rqr.id },
    data: { eliminadoEn: new Date(), eliminadoPorId: req.usuario!.id },
  });
  // La marca del caso ignora los RQR eliminados
  await recalcularTieneRqrAbierto(rqr.casoId);

  await auditar(req, {
    accion: ACCIONES.RQR_ELIMINADO,
    entidad: "RQR",
    entidadId: rqr.id,
    detalles: { numeroRQR: rqr.numeroRQR, estado: rqr.estado },
  });

  res.json({ message: `${rqr.numeroRQR} se eliminó (recuperable desde auditoría).` });
}

// ---------- DELETE /api/uploads/:id ----------

export async function eliminarUpload(req: Request, res: Response) {
  const upload = await prisma.excelUpload.findUnique({ where: { id: req.params.id } });
  if (!upload || upload.eliminadoEn) {
    return res.status(404).json({ message: "No se encontró esa carga (o ya estaba eliminada)." });
  }

  await prisma.excelUpload.update({
    where: { id: upload.id },
    data: { eliminadoEn: new Date(), eliminadoPorId: req.usuario!.id },
  });

  await auditar(req, {
    accion: ACCIONES.EXCEL_UPLOAD_ELIMINADO,
    entidad: "ExcelUpload",
    entidadId: upload.id,
    detalles: { filename: upload.filename, sucursal: upload.sucursal, periodo: upload.periodo },
  });

  res.json({ message: `La carga "${upload.filename}" (${upload.periodo}) se eliminó (recuperable desde auditoría).` });
}

// ---------- POST /api/admin/restaurar/:tipo/:id ----------
// Revierte un borrado lógico. tipo ∈ caso | rqr | upload.

const TIPOS = new Set(["caso", "rqr", "upload"]);

export async function restaurar(req: Request, res: Response) {
  const tipo = String(req.params.tipo).toLowerCase();
  const id = req.params.id;
  if (!TIPOS.has(tipo)) {
    return res.status(400).json({ message: "Tipo inválido. Usá caso, rqr o upload." });
  }

  if (tipo === "caso") {
    const caso = await prisma.caso.findUnique({ where: { id } });
    if (!caso || !caso.eliminadoEn) {
      return res.status(404).json({ message: "No hay un caso eliminado con ese id." });
    }
    await prisma.caso.update({ where: { id }, data: { eliminadoEn: null, eliminadoPorId: null } });
    await auditar(req, { accion: ACCIONES.CASO_RESTAURADO, entidad: "Caso", entidadId: id, detalles: { numeroOrden: caso.numeroOrden } });
    return res.json({ message: `El caso de orden ${caso.numeroOrden} se restauró.` });
  }

  if (tipo === "rqr") {
    const rqr = await prisma.rQR.findUnique({ where: { id } });
    if (!rqr || !rqr.eliminadoEn) {
      return res.status(404).json({ message: "No hay un RQR eliminado con ese id." });
    }
    await prisma.rQR.update({ where: { id }, data: { eliminadoEn: null, eliminadoPorId: null } });
    await recalcularTieneRqrAbierto(rqr.casoId);
    await auditar(req, { accion: ACCIONES.RQR_RESTAURADO, entidad: "RQR", entidadId: id, detalles: { numeroRQR: rqr.numeroRQR } });
    return res.json({ message: `${rqr.numeroRQR} se restauró.` });
  }

  // upload
  const upload = await prisma.excelUpload.findUnique({ where: { id } });
  if (!upload || !upload.eliminadoEn) {
    return res.status(404).json({ message: "No hay una carga eliminada con ese id." });
  }
  await prisma.excelUpload.update({ where: { id }, data: { eliminadoEn: null, eliminadoPorId: null } });
  await auditar(req, { accion: ACCIONES.EXCEL_UPLOAD_RESTAURADO, entidad: "ExcelUpload", entidadId: id, detalles: { filename: upload.filename } });
  return res.json({ message: `La carga "${upload.filename}" se restauró.` });
}
