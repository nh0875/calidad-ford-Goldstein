import { Request, Response } from "express";
import { EstadoContacto } from "@prisma/client";
import { prisma } from "../config/prisma";
import { marca } from "../config/marca";
import { ACCIONES, auditar } from "../services/audit.service";
import { recalcularTieneRqrAbierto } from "../services/rqr.service";
import { whereVisible } from "../services/area.service";

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

// ---------- GET y POST /api/admin/casos-internos ----------
//
// Los casos en estado INTERNO, todos de una vez (pedido del dueño, 19-09-2026):
// en Volkswagen ya no se cargan, y los que quedaron de antes se eliminan con esto.
// Es el MISMO borrado lógico que "Eliminar" en un caso: salen de las listas, los
// reportes y el tablero, y cada uno se puede restaurar. El GET cuenta cuántos hay,
// para que la pantalla lo diga antes de confirmar.

function motivoSinInternos(): string | null {
  return marca.excluirCasosInternos
    ? null
    : `En ${marca.nombre} los casos internos se cargan a propósito desde su Excel: esta acción no aplica.`;
}

// Con la visibilidad del usuario: en VW la provincia rige en todo el sistema, así
// que se cuentan y se borran solo los internos que esa persona ve en Casos. Un
// ADMIN sin provincia (lo normal) ve todos y los borra todos.
async function whereInternosActivos(req: Request) {
  return {
    estadoContacto: EstadoContacto.INTERNO,
    eliminadoEn: null,
    ...(await whereVisible(req.usuario!)),
  };
}

export async function contarCasosInternos(req: Request, res: Response) {
  const motivo = motivoSinInternos();
  if (motivo) return res.status(404).json({ message: motivo });
  res.json({ cantidad: await prisma.caso.count({ where: await whereInternosActivos(req) }) });
}

export async function eliminarCasosInternos(req: Request, res: Response) {
  const motivo = motivoSinInternos();
  if (motivo) return res.status(404).json({ message: motivo });

  const where = await whereInternosActivos(req);
  const internos = await prisma.caso.findMany({
    where,
    select: { id: true, numeroOrden: true },
  });
  if (internos.length === 0) {
    return res.json({ cantidad: 0, message: "No había casos internos para eliminar." });
  }
  const ids = internos.map((c) => c.id);
  // Por id y con la condición repetida: si entre la lectura y acá alguien cambió
  // el estado de uno, ese no se toca.
  const { count } = await prisma.caso.updateMany({
    where: { id: { in: ids }, ...where },
    data: { eliminadoEn: new Date(), eliminadoPorId: req.usuario!.id },
  });

  // Un solo registro con TODOS los ids: es lo que permite encontrar y restaurar
  // cualquiera de ellos después, uno por uno, igual que un borrado suelto.
  await auditar(req, {
    accion: ACCIONES.CASOS_INTERNOS_ELIMINADOS,
    entidad: "Caso",
    detalles: { cantidad: count, ids, ordenes: internos.map((c) => c.numeroOrden) },
  });

  res.json({
    cantidad: count,
    message: `Se eliminaron ${count} caso(s) internos. Se pueden restaurar uno por uno, igual que cualquier caso eliminado.`,
  });
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
