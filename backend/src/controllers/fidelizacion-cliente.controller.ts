// ABM de destinatarios de Fidelización (pantalla "Clientes de fidelización").
//
// Es a Fidelización lo que /casos es a la Carga de Excel: el listado global de
// TODOS los destinatarios de todas las cargas, con buscador y filtros, alta a
// mano del cliente que no vino en ninguna planilla, corrección de datos,
// exclusión reversible del envío y envío individual.
//
// Visibilidad: igual que en Seguimiento, Fidelización NO se restringe por área
// (es un programa transversal) pero SÍ por PROVINCIA. Un usuario con sucursal
// null ve todo. El filtrado de provincia se hace en JS con `mismaProvincia`
// porque Postgres no pliega acentos.
import { Request, Response } from "express";
import { EstadoFidelizacion, OrigenFidelizacion, Prisma, TipoUpload, UploadStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { ACCIONES, auditar } from "../services/audit.service";
import { encolarEnvioFidelizacionCliente, motivoBloqueoEnvio } from "../services/fidelizacion.service";
import { mismaProvincia } from "../services/refuerzo.service";
import { normalizarTelefonoARFlexible } from "../services/telefono.service";

const MAX_POR_PAGINA = 100;

// Campos que devuelve el listado y el detalle (una sola forma para el front).
const SELECT_CLIENTE = {
  id: true,
  origen: true,
  nombre: true,
  telefono: true,
  telefonosNorm: true,
  modelo: true,
  patente: true,
  asesor: true,
  numeroServicio: true,
  comentarioAsesor: true,
  fechaEntrega: true,
  sucursal: true,
  estado: true,
  error: true,
  enviadoEn: true,
  quiereAsesorEn: true,
  createdAt: true,
  updatedAt: true,
  upload: { select: { id: true, filename: true, periodo: true } },
  _count: { select: { mensajes: true } },
} satisfies Prisma.ClienteFidelizacionSelect;

type ClienteListado = Prisma.ClienteFidelizacionGetPayload<{ select: typeof SELECT_CLIENTE }>;

function aRespuesta(c: ClienteListado) {
  return {
    id: c.id,
    origen: c.origen,
    nombre: c.nombre,
    telefono: c.telefono,
    modelo: c.modelo,
    patente: c.patente,
    asesor: c.asesor,
    numeroServicio: c.numeroServicio,
    comentarioAsesor: c.comentarioAsesor,
    fechaEntrega: c.fechaEntrega,
    sucursal: c.sucursal,
    estado: c.estado,
    error: c.error,
    enviadoEn: c.enviadoEn,
    quiereAsesor: c.quiereAsesorEn != null,
    // Sin teléfono normalizado no hay a quién escribirle: el front lo avisa.
    contactable: c.telefonosNorm.length > 0,
    mensajes: c._count.mensajes,
    carga: c.upload ? { id: c.upload.id, filename: c.upload.filename, periodo: c.upload.periodo } : null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

// ---------- GET /api/fidelizacion/clientes (listado con filtros) ----------

const listQuerySchema = z.object({
  // Buscador libre: nombre, teléfono, patente o modelo.
  q: z.string().trim().max(80).optional(),
  origen: z.nativeEnum(OrigenFidelizacion).optional(),
  estado: z.nativeEnum(EstadoFidelizacion).optional(),
  uploadId: z.string().trim().min(1).optional(),
  sucursal: z.string().trim().max(80).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(MAX_POR_PAGINA).default(50),
});

export async function listarClientesFidelizacion(req: Request, res: Response) {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Filtro inválido." });
  }
  const { q, origen, estado, uploadId, sucursal, pagina, porPagina } = parsed.data;

  const where: Prisma.ClienteFidelizacionWhereInput = {
    eliminadoEn: null,
    ...(origen ? { origen } : {}),
    ...(estado ? { estado } : {}),
    ...(uploadId ? { uploadId } : {}),
    ...(q
      ? {
          OR: [
            { nombre: { contains: q, mode: "insensitive" } },
            { telefono: { contains: q, mode: "insensitive" } },
            { patente: { contains: q, mode: "insensitive" } },
            { modelo: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  // La provincia se filtra en JS (Postgres no pliega acentos), así que se trae
  // el resultado del filtro y se pagina DESPUÉS.
  // LÍMITE CONOCIDO: esto carga en memoria todas las filas que matchean, igual
  // que hace Seguimiento. Con el volumen real (una planilla por mes, ~700 filas)
  // no molesta ni de cerca; si algún día esta tabla pasa las ~50.000 filas, hay
  // que paginar en SQL y resolver la provincia con `claveNormalizada` en la base.
  const todos = await prisma.clienteFidelizacion.findMany({
    where,
    select: SELECT_CLIENTE,
    orderBy: { createdAt: "desc" },
  });

  const visibles = todos
    .filter((c) => mismaProvincia(req.usuario!.sucursal, c.sucursal))
    .filter((c) => !sucursal || mismaProvincia(sucursal, c.sucursal));

  const desde = (pagina - 1) * porPagina;
  const pagina_ = visibles.slice(desde, desde + porPagina);

  // Opciones de los desplegables: lo que el usuario PUEDE ver, antes de filtrar.
  const visiblesSinFiltroProvincia = todos.filter((c) => mismaProvincia(req.usuario!.sucursal, c.sucursal));
  const provincias = [
    ...new Set(visiblesSinFiltroProvincia.map((c) => c.sucursal).filter(Boolean) as string[]),
  ].sort();
  const cargas = [
    ...new Map(
      visiblesSinFiltroProvincia
        .filter((c) => c.upload)
        .map((c) => [c.upload!.id, { id: c.upload!.id, filename: c.upload!.filename, periodo: c.upload!.periodo }])
    ).values(),
  ].sort((a, b) => a.filename.localeCompare(b.filename));

  res.json({
    data: pagina_.map(aRespuesta),
    total: visibles.length,
    pagina,
    porPagina,
    opciones: { provincias, cargas },
  });
}

// ---------- POST /api/fidelizacion/clientes (alta manual) ----------

const camposSchema = z.object({
  nombre: z.string().trim().min(1, "Ingresá el nombre del cliente.").max(160),
  telefono: z.string().trim().min(1, "Ingresá un teléfono."),
  modelo: z.string().trim().max(120).optional().or(z.literal("")),
  patente: z.string().trim().max(20).optional().or(z.literal("")),
  asesor: z.string().trim().max(120).optional().or(z.literal("")),
  // 1 a 5: si lo cargan, el mensaje y los tableros lo muestran como "N° service".
  numeroServicio: z.coerce.number().int().min(1).max(5).optional().nullable(),
  fechaEntrega: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha de entrega tiene que ser AAAA-MM-DD.")
    .optional()
    .or(z.literal("")),
  sucursal: z.string().trim().max(80).optional().or(z.literal("")),
  comentarioAsesor: z.string().trim().max(2000).optional().or(z.literal("")),
});

/**
 * Provincia con la que se guarda un cliente de fidelizacion.
 *
 * Un usuario acotado a una provincia NO puede mandar un registro a otra ni
 * dejarlo sin provincia: con sucursal en null el cliente desaparece de su propia
 * pantalla (mismaProvincia lo excluye) y aparece en la de otro. Se le impone la
 * suya y listo. Los que ven todas las provincias (sucursal vacia) siguen
 * eligiendo libremente.
 */
function sucursalPermitida(req: Request, pedida?: string | null): string | null {
  const propia = req.usuario?.sucursal?.trim();
  if (propia) return propia;
  const limpia = (pedida ?? "").trim();
  return limpia === "" ? null : limpia;
}

export async function crearClienteFidelizacion(req: Request, res: Response) {
  const parsed = camposSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Revisá los datos del formulario." });
  }
  const d = parsed.data;

  // Sin un número normalizable no hay a quién escribirle: se corta acá y se avisa,
  // en vez de crear un destinatario incontactable.
  const telefonoNorm = normalizarTelefonoARFlexible(d.telefono);
  if (!telefonoNorm) {
    return res.status(400).json({
      message:
        "El teléfono no es válido. Tiene que ser un celular argentino con código de área " +
        "(ej. 261 5600368). Sin eso el recordatorio no se puede entregar.",
    });
  }

  const sucursal = sucursalPermitida(req, d.sucursal) ?? "General";
  const fechaEntrega = d.fechaEntrega ? new Date(`${d.fechaEntrega}T12:00:00`) : null;
  const periodo = (fechaEntrega ?? new Date()).toISOString().slice(0, 7); // AAAA-MM

  // Todo destinatario pertenece a una carga: se reusa (o crea) una "Carga manual"
  // por sucursal + período, igual que hace el alta manual de casos.
  let upload = await prisma.excelUpload.findFirst({
    where: {
      tipo: TipoUpload.FIDELIZACION,
      sucursal,
      periodo,
      filename: "Carga manual",
      eliminadoEn: null,
    },
  });
  if (!upload) {
    upload = await prisma.excelUpload.create({
      data: {
        tipo: TipoUpload.FIDELIZACION,
        filename: "Carga manual",
        sucursal,
        periodo,
        uploadedBy: req.usuario!.nombre,
        columnMapping: {},
        totalRows: 0,
        status: UploadStatus.COMPLETADO,
      },
    });
  }

  const cliente = await prisma.clienteFidelizacion.create({
    data: {
      uploadId: upload.id,
      origen: OrigenFidelizacion.MANUAL,
      nombre: d.nombre,
      telefono: telefonoNorm,
      telefonosNorm: [telefonoNorm],
      modelo: d.modelo || null,
      patente: d.patente || null,
      asesor: d.asesor || null,
      numeroServicio: d.numeroServicio ?? null,
      comentarioAsesor: d.comentarioAsesor || null,
      fechaEntrega,
      sucursal,
      estado: EstadoFidelizacion.PENDIENTE,
    },
    select: SELECT_CLIENTE,
  });

  await auditar(req, {
    accion: ACCIONES.FIDELIZACION_CLIENTE_CREADO,
    entidad: "ClienteFidelizacion",
    entidadId: cliente.id,
    detalles: { nombre: cliente.nombre, telefono: cliente.telefono, sucursal },
  });

  res.status(201).json({
    message: `${cliente.nombre} quedó cargado y pendiente de recordatorio.`,
    cliente: aRespuesta(cliente),
  });
}

// ---------- PATCH /api/fidelizacion/clientes/:id (editar) ----------

const editarSchema = camposSchema.partial();

export async function editarClienteFidelizacion(req: Request, res: Response) {
  const parsed = editarSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Revisá los datos del formulario." });
  }
  const d = parsed.data;

  const actual = await prisma.clienteFidelizacion.findFirst({
    where: { id: req.params.id, eliminadoEn: null },
    select: { id: true, nombre: true, sucursal: true, telefono: true },
  });
  if (!actual) return res.status(404).json({ message: "No se encontró el cliente." });
  if (!mismaProvincia(req.usuario!.sucursal, actual.sucursal)) {
    return res.status(403).json({ message: "Ese cliente es de otra provincia." });
  }

  const datos: Prisma.ClienteFidelizacionUpdateInput = {};
  if (d.nombre !== undefined) datos.nombre = d.nombre;
  if (d.modelo !== undefined) datos.modelo = d.modelo || null;
  if (d.patente !== undefined) datos.patente = d.patente || null;
  if (d.asesor !== undefined) datos.asesor = d.asesor || null;
  if (d.numeroServicio !== undefined) datos.numeroServicio = d.numeroServicio ?? null;
  if (d.comentarioAsesor !== undefined) datos.comentarioAsesor = d.comentarioAsesor || null;
  if (d.sucursal !== undefined) datos.sucursal = sucursalPermitida(req, d.sucursal);
  if (d.fechaEntrega !== undefined) {
    datos.fechaEntrega = d.fechaEntrega ? new Date(`${d.fechaEntrega}T12:00:00`) : null;
  }

  // El teléfono se revalida: si lo corrigen, tiene que seguir siendo contactable.
  if (d.telefono !== undefined) {
    const telefonoNorm = normalizarTelefonoARFlexible(d.telefono);
    if (!telefonoNorm) {
      return res.status(400).json({
        message:
          "El teléfono no es válido. Tiene que ser un celular argentino con código de área " +
          "(ej. 261 5600368).",
      });
    }
    datos.telefono = telefonoNorm;
    datos.telefonosNorm = [telefonoNorm];
  }

  const cliente = await prisma.clienteFidelizacion.update({
    where: { id: actual.id },
    data: datos,
    select: SELECT_CLIENTE,
  });

  await auditar(req, {
    accion: ACCIONES.FIDELIZACION_CLIENTE_EDITADO,
    entidad: "ClienteFidelizacion",
    entidadId: cliente.id,
    detalles: { campos: Object.keys(datos), nombre: cliente.nombre },
  });

  res.json({ message: "Datos actualizados.", cliente: aRespuesta(cliente) });
}

// ---------- POST /api/fidelizacion/clientes/:id/excluir (excluir / reincorporar) ----------

const excluirSchema = z.object({
  excluir: z.boolean(),
  motivo: z.string().trim().max(300).optional(),
});

export async function excluirClienteFidelizacion(req: Request, res: Response) {
  const parsed = excluirSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: "Indicá si se excluye o se reincorpora." });
  }
  const { excluir, motivo } = parsed.data;

  const actual = await prisma.clienteFidelizacion.findFirst({
    where: { id: req.params.id, eliminadoEn: null },
    select: { id: true, nombre: true, sucursal: true, estado: true, telefonosNorm: true },
  });
  if (!actual) return res.status(404).json({ message: "No se encontró el cliente." });
  if (!mismaProvincia(req.usuario!.sucursal, actual.sucursal)) {
    return res.status(403).json({ message: "Ese cliente es de otra provincia." });
  }

  // Al que ya recibió el mensaje no tiene sentido excluirlo: ya salió.
  if (excluir && actual.estado === EstadoFidelizacion.ENVIADO) {
    return res.status(409).json({
      message: `A ${actual.nombre} ya se le envió el recordatorio, no se puede excluir.`,
    });
  }
  if (!excluir && actual.estado !== EstadoFidelizacion.OMITIDO) {
    return res.status(409).json({ message: "Ese cliente no está excluido." });
  }
  // Reincorporar a alguien sin teléfono usable lo dejaría en un pendiente que
  // nunca se puede enviar: se avisa en vez de simular que quedó listo.
  if (!excluir && actual.telefonosNorm.length === 0) {
    return res.status(409).json({
      message: `${actual.nombre} no tiene un teléfono válido. Corregí el teléfono y después reincorporalo.`,
    });
  }

  const cliente = await prisma.clienteFidelizacion.update({
    where: { id: actual.id },
    data: excluir
      ? {
          estado: EstadoFidelizacion.OMITIDO,
          error: motivo || "Excluido a mano desde la pantalla.",
        }
      : { estado: EstadoFidelizacion.PENDIENTE, error: null },
    select: SELECT_CLIENTE,
  });

  await auditar(req, {
    accion: excluir ? ACCIONES.FIDELIZACION_CLIENTE_EXCLUIDO : ACCIONES.FIDELIZACION_CLIENTE_REINCORPORADO,
    entidad: "ClienteFidelizacion",
    entidadId: cliente.id,
    detalles: { nombre: cliente.nombre, motivo: motivo ?? null },
  });

  res.json({
    message: excluir
      ? `${cliente.nombre} no va a recibir el recordatorio.`
      : `${cliente.nombre} vuelve a quedar pendiente de recordatorio.`,
    cliente: aRespuesta(cliente),
  });
}

// ---------- POST /api/fidelizacion/clientes/:id/enviar (envío individual) ----------

export async function enviarClienteFidelizacion(req: Request, res: Response) {
  const actual = await prisma.clienteFidelizacion.findFirst({
    where: { id: req.params.id, eliminadoEn: null },
    select: { id: true, nombre: true, sucursal: true, estado: true, telefonosNorm: true },
  });
  if (!actual) return res.status(404).json({ message: "No se encontró el cliente." });
  if (!mismaProvincia(req.usuario!.sucursal, actual.sucursal)) {
    return res.status(403).json({ message: "Ese cliente es de otra provincia." });
  }

  const bloqueo = await motivoBloqueoEnvio();
  if (bloqueo) return res.status(409).json({ message: bloqueo });

  if (actual.estado === EstadoFidelizacion.ENVIADO) {
    return res.status(409).json({ message: `A ${actual.nombre} ya se le envió el recordatorio.` });
  }
  if (actual.estado === EstadoFidelizacion.OMITIDO) {
    return res.status(409).json({
      message: `${actual.nombre} está excluido del envío. Reincorporalo primero si querés mandárselo.`,
    });
  }
  if (actual.telefonosNorm.length === 0) {
    return res.status(409).json({ message: `${actual.nombre} no tiene un teléfono válido.` });
  }

  const encolado = await encolarEnvioFidelizacionCliente(actual.id);
  if (!encolado) {
    return res.status(409).json({ message: "No se pudo encolar el recordatorio de ese cliente." });
  }

  await auditar(req, {
    accion: ACCIONES.CAMPANA_ENVIADA,
    entidad: "ClienteFidelizacion",
    entidadId: actual.id,
    detalles: { nombre: actual.nombre, individual: true },
  });

  res.json({ message: `Recordatorio encolado para ${actual.nombre}.` });
}

// ---------- DELETE /api/fidelizacion/clientes/:id (borrado lógico, solo ADMIN) ----------

export async function eliminarClienteFidelizacion(req: Request, res: Response) {
  const actual = await prisma.clienteFidelizacion.findFirst({
    where: { id: req.params.id, eliminadoEn: null },
    select: { id: true, nombre: true, sucursal: true },
  });
  if (!actual) return res.status(404).json({ message: "No se encontró el cliente." });

  await prisma.clienteFidelizacion.update({
    where: { id: actual.id },
    data: { eliminadoEn: new Date(), eliminadoPorId: req.usuario!.id },
  });

  await auditar(req, {
    accion: ACCIONES.FIDELIZACION_CLIENTE_ELIMINADO,
    entidad: "ClienteFidelizacion",
    entidadId: actual.id,
    detalles: { nombre: actual.nombre, sucursal: actual.sucursal },
  });

  res.json({ message: `${actual.nombre} se quitó de la lista.` });
}
