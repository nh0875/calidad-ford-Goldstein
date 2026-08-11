import { Request, Response } from "express";
import { EstadoContacto, EstadoFidelizacion, MessageDirection, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { areaPermitida, parsearAreaQuery, puedeAcceder, whereArea } from "../services/area.service";
import { mismaProvincia } from "../services/refuerzo.service";
import { etiquetaFidelizacion } from "../services/fidelizacion.service";
import { estadoVentana, telefonoContactable, ultimoEntranteAt } from "../services/seguimiento.service";
import { sendTemplateMessage, sendTextMessage, WhatsappApiError } from "../services/whatsapp.service";
import { estaSuprimido, telefonosSuprimidos } from "../services/supresion.service";
import { obtenerCredencialesMeta, plantillaContactoPara } from "../services/configuracion.service";
import { agradecimientoQueue } from "../jobs/queues";
import { ACCIONES, auditar } from "../services/audit.service";

// ---------- "WhatsApp interno" (seguimiento de conversaciones) ----------
//
// El número del sistema es de la Cloud API: NO se puede abrir en un celular. Por
// eso Calidad no tenía forma de ver si un mensaje salió, si el cliente contestó,
// ni de responderle a mano. Esta pantalla suple eso: la lista de conversaciones,
// el hilo completo con el ESTADO de cada mensaje, y la respuesta manual (dentro
// de la ventana de 24 hs; fuera de eso, reenvío de plantilla).
//
// Dos fuentes de conversación:
//  - CASOS (Contacto Posventa/Ventas): aislados por ÁREA + PROVINCIA.
//  - FIDELIZACIÓN (recordatorio de service): NO se restringe por área; lo ve
//    cualquiera de su PROVINCIA. Es un programa transversal.
// El filtro de área de la pantalla tiene TRES valores: Posventa / Ventas /
// Fidelización. Cada conversación se identifica con un id PREFIJADO:
// "caso:<id>" o "fid:<id>", para saber de qué fuente es en las acciones.

// Campos del caso que necesitan las acciones de envío (responder / reenviar).
const SELECT_CASO_ENVIO = {
  id: true,
  numeroOrden: true,
  nombrePropietario: true,
  modelo: true,
  asesor: true,
  sucursal: true,
  area: true,
  whatsapp: true,
  celular: true,
  telefonosNorm: true,
  estadoContacto: true,
  whatsappOptOut: true,
  agradecimientoEnviadoEn: true,
  tieneRqrAbierto: true,
  ultimoErrorEnvio: true,
} satisfies Prisma.CasoSelect;

// Campos del cliente de fidelización para las acciones.
const SELECT_FIDEL_ENVIO = {
  id: true,
  nombre: true,
  modelo: true,
  asesor: true,
  sucursal: true,
  telefono: true,
  telefonosNorm: true,
  numeroServicio: true,
  estado: true,
  error: true,
  quiereAsesorEn: true,
} satisfies Prisma.ClienteFidelizacionSelect;

type ConvTipo = "caso" | "fidelizacion";

/** Parsea el id prefijado de una conversación ("caso:<id>" / "fid:<id>"). Sin
 * prefijo se asume caso (compatibilidad con enlaces viejos). */
function parseConvId(raw: unknown): { tipo: ConvTipo; id: string } | null {
  const s = String(raw ?? "");
  const i = s.indexOf(":");
  if (i < 0) return s ? { tipo: "caso", id: s } : null;
  const pre = s.slice(0, i);
  const id = s.slice(i + 1);
  if (!id) return null;
  if (pre === "caso") return { tipo: "caso", id };
  if (pre === "fid") return { tipo: "fidelizacion", id };
  return null;
}

// Valores del desplegable de la pantalla. Además de las áreas propiamente
// dichas hay dos categorías por ORIGEN de la conversación, que es lo que la
// gente de Calidad quiere separar de un vistazo:
//   CONTACTO    = todo el Contacto Posterior (Ventas + Posventa) junto.
//   FIDELIZACION = los recordatorios para que el cliente vuelva al taller.
type FiltroSeguimiento = "CONTACTO" | "VENTAS" | "POSVENTA" | "FIDELIZACION";
const FILTROS_SEGUIMIENTO: FiltroSeguimiento[] = ["CONTACTO", "VENTAS", "POSVENTA", "FIDELIZACION"];

function parseAreaSeguimiento(valor: unknown): FiltroSeguimiento | null {
  const v = String(valor ?? "").toUpperCase();
  return (FILTROS_SEGUIMIENTO as string[]).includes(v) ? (v as FiltroSeguimiento) : null;
}

/** ¿Esta conversación entra en el filtro elegido? */
function coincideFiltro(
  conv: { tipo: ConvTipo; area: string },
  filtro: FiltroSeguimiento | null
): boolean {
  if (!filtro) return true;
  if (filtro === "CONTACTO") return conv.tipo === "caso";
  return conv.area === filtro;
}

/** 403 si el caso no es del área+provincia del usuario. */
function autorizadoSobreCaso(req: Request, caso: { area: any; sucursal: string | null }): boolean {
  return puedeAcceder(req.usuario!, caso.area) && mismaProvincia(req.usuario!.sucursal, caso.sucursal);
}

/** Fidelización: NO se restringe por área, solo por PROVINCIA (decisión de negocio). */
function autorizadoSobreFidelizacion(req: Request, cliente: { sucursal: string | null }): boolean {
  return mismaProvincia(req.usuario!.sucursal, cliente.sucursal);
}

/** El mejor teléfono (E.164) para escribirle a un cliente de fidelización. */
function telFidelizacion(c: { telefono: string | null; telefonosNorm: string[] }): string {
  const norm = c.telefonosNorm.find((t) => t.startsWith("+"));
  if (norm) return norm;
  const t = (c.telefono ?? "").trim();
  return t.startsWith("+") ? t : "";
}

/** Estado a mostrar para una conversación de fidelización (reusa los badges de caso). */
function estadoFidelParaMostrar(ultimoDir: MessageDirection | undefined, estado: EstadoFidelizacion): string {
  if (ultimoDir === MessageDirection.ENTRANTE) return "RESPONDIDO";
  if (estado === EstadoFidelizacion.ERROR) return "ERROR";
  return "ENVIADO";
}

// ---------- GET /api/seguimiento (lista de conversaciones) ----------

const listQuerySchema = z.object({
  // "todas" (default) | "revision" (a clasificar) | "rojos" | "asesor" (quiere turno)
  filtro: z.enum(["todas", "revision", "rojos", "asesor"]).default("todas"),
  q: z.string().trim().max(80).optional(),
  // Filtro por provincia (solo NARROWING: nunca deja ver fuera de lo permitido).
  sucursal: z.string().trim().max(80).optional(),
});

export async function listarConversaciones(req: Request, res: Response) {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: "Filtro inválido." });
  }
  const { filtro, q, sucursal } = parsed.data;
  const areaFiltro = parseAreaSeguimiento(req.query.area); // VENTAS | POSVENTA | FIDELIZACION | null
  const sucursalPedida = sucursal ?? "";
  // Para la base traemos con la restricción de área del usuario SOBRE LOS CASOS
  // (no el filtro pedido, así los desplegables ofrecen todas las opciones).
  const restringido = areaPermitida(req.usuario!);

  const [casos, fidels] = await Promise.all([
    prisma.caso.findMany({
      where: {
        eliminadoEn: null,
        ...(restringido ? { area: restringido } : {}),
        mensajes: { some: {} }, // solo casos con actividad de WhatsApp
      },
      select: {
        id: true,
        numeroOrden: true,
        nombrePropietario: true,
        modelo: true,
        asesor: true,
        sucursal: true,
        area: true,
        estadoContacto: true,
        whatsappOptOut: true,
        tieneRqrAbierto: true,
        mensajes: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { content: true, direction: true, createdAt: true, status: true, mediaTipo: true },
        },
        analisis: {
          where: { esSeguimiento: false },
          orderBy: { analyzedAt: "desc" },
          take: 1,
          select: { semaforo: true, requiereRevisionManual: true },
        },
        _count: { select: { mensajes: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    // Fidelización: sin restricción de área (la ve cualquiera de la provincia).
    prisma.clienteFidelizacion.findMany({
      where: { mensajes: { some: {} } },
      select: {
        id: true,
        nombre: true,
        modelo: true,
        asesor: true,
        sucursal: true,
        numeroServicio: true,
        estado: true,
        quiereAsesorEn: true,
        mensajes: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { content: true, direction: true, createdAt: true, status: true, mediaTipo: true },
        },
        _count: { select: { mensajes: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  ]);

  // Alcance real del usuario (su provincia; null = ve todas). Se filtra en JS
  // por los acentos (Postgres no los pliega).
  const casosVis = casos.filter((c) => mismaProvincia(req.usuario!.sucursal, c.sucursal));
  const fidelsVis = fidels.filter((f) => mismaProvincia(req.usuario!.sucursal, f.sucursal));

  // Opciones para los desplegables: todo lo que el usuario PUEDE ver, ANTES de
  // aplicar el filtro pedido (así no se vacían al elegir uno).
  const provincias = [
    ...new Set([...casosVis.map((c) => c.sucursal), ...fidelsVis.map((f) => f.sucursal)].filter(Boolean) as string[]),
  ].sort();
  const areasSet = new Set<string>(casosVis.map((c) => c.area));
  if (fidelsVis.length > 0) areasSet.add("FIDELIZACION");
  // "Contacto Posterior" (todos los casos juntos) solo tiene sentido ofrecerlo si
  // además hay conversaciones de Fidelización de las que separarlo.
  if (casosVis.length > 0 && fidelsVis.length > 0) areasSet.add("CONTACTO");
  // Orden fijo (de lo general a lo particular), no alfabético.
  const areas = FILTROS_SEGUIMIENTO.filter((f) => areasSet.has(f));

  // Forma unificada de una conversación (para la lista tipo WhatsApp).
  const itemsCaso = casosVis.map((c) => {
    const um = c.mensajes[0];
    const a = c.analisis[0];
    return {
      tipo: "caso" as ConvTipo,
      id: `caso:${c.id}`,
      numeroOrden: c.numeroOrden,
      nombre: c.nombrePropietario,
      modelo: c.modelo,
      asesor: c.asesor,
      sucursal: c.sucursal,
      area: c.area as string,
      estadoContacto: c.estadoContacto as string,
      tieneRqrAbierto: c.tieneRqrAbierto,
      optOut: c.whatsappOptOut,
      quiereAsesor: false,
      semaforo: a?.semaforo ?? null,
      requiereRevision: a?.requiereRevisionManual ?? false,
      totalMensajes: c._count.mensajes,
      ultimoMensaje: um
        ? { content: um.content, direction: um.direction, createdAt: um.createdAt, status: um.status, mediaTipo: um.mediaTipo }
        : null,
    };
  });

  const itemsFidel = fidelsVis.map((f) => {
    const um = f.mensajes[0];
    return {
      tipo: "fidelizacion" as ConvTipo,
      id: `fid:${f.id}`,
      numeroOrden: etiquetaFidelizacion(f),
      nombre: f.nombre,
      modelo: f.modelo ?? "",
      asesor: f.asesor ?? "",
      sucursal: f.sucursal,
      area: "FIDELIZACION",
      estadoContacto: estadoFidelParaMostrar(um?.direction, f.estado),
      tieneRqrAbierto: false,
      optOut: false,
      quiereAsesor: f.quiereAsesorEn != null,
      semaforo: null,
      requiereRevision: false,
      totalMensajes: f._count.mensajes,
      ultimoMensaje: um
        ? { content: um.content, direction: um.direction, createdAt: um.createdAt, status: um.status, mediaTipo: um.mediaTipo }
        : null,
    };
  });

  const termino = q?.toLowerCase();
  const lista = [...itemsCaso, ...itemsFidel]
    // Filtros pedidos (área + provincia): solo ACOTAN lo que ya puede ver.
    .filter((c) => coincideFiltro(c, areaFiltro))
    .filter((c) => !sucursalPedida || mismaProvincia(sucursalPedida, c.sucursal))
    .filter((c) =>
      filtro === "revision"
        ? c.requiereRevision
        : filtro === "rojos"
          ? c.semaforo === "ROJO"
          : filtro === "asesor"
            ? c.quiereAsesor
            : true
    )
    .filter(
      (c) => !termino || c.nombre.toLowerCase().includes(termino) || c.numeroOrden.toLowerCase().includes(termino)
    )
    .sort((a, b) => {
      const ta = a.ultimoMensaje?.createdAt.getTime() ?? 0;
      const tb = b.ultimoMensaje?.createdAt.getTime() ?? 0;
      return tb - ta; // más reciente primero (como WhatsApp)
    });

  res.json({ data: lista, total: lista.length, opciones: { provincias, areas } });
}

// ---------- GET /api/seguimiento/pendientes (badge del menú, por provincia) ----------

export async function contarPendientesSeguimiento(req: Request, res: Response) {
  const areaWhere = whereArea(req.usuario!, parsearAreaQuery(req.query.area));
  const [analisis, fidelAsesor] = await Promise.all([
    prisma.sentimentAnalysis.findMany({
      where: { esSeguimiento: false, requiereRevisionManual: true, caso: { eliminadoEn: null, ...areaWhere } },
      select: { caso: { select: { sucursal: true } } },
    }),
    // Fidelización que pidió turno con asesor (sin restricción de área).
    prisma.clienteFidelizacion.findMany({
      where: { quiereAsesorEn: { not: null } },
      select: { sucursal: true },
    }),
  ]);
  const pendCasos = analisis.filter((a) => mismaProvincia(req.usuario!.sucursal, a.caso?.sucursal)).length;
  const pendFidel = fidelAsesor.filter((f) => mismaProvincia(req.usuario!.sucursal, f.sucursal)).length;
  res.json({ pendientes: pendCasos + pendFidel });
}

// ---------- GET /api/seguimiento/:id (hilo completo) ----------

export async function verConversacion(req: Request, res: Response) {
  const conv = parseConvId(req.params.casoId);
  if (!conv) return res.status(404).json({ message: "No se encontró la conversación." });
  if (conv.tipo === "fidelizacion") return verConversacionFidelizacion(req, res, conv.id);

  const caso = await prisma.caso.findFirst({
    where: { id: conv.id, eliminadoEn: null },
    select: { ...SELECT_CASO_ENVIO },
  });
  if (!caso) return res.status(404).json({ message: "No se encontró la conversación." });
  if (!autorizadoSobreCaso(req, caso)) {
    return res.status(403).json({ message: "Esa conversación es de otra área o provincia: no la podés ver." });
  }

  const mensajes = await prisma.whatsappMessage.findMany({
    where: { casoId: caso.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      direction: true,
      content: true,
      status: true,
      templateName: true,
      esAgradecimiento: true,
      mediaTipo: true,
      waMessageId: true,
      createdAt: true,
    },
  });

  const analisis = await prisma.sentimentAnalysis.findFirst({
    where: { casoId: caso.id, esSeguimiento: false },
    orderBy: { analyzedAt: "desc" },
    select: { id: true, semaforo: true, requiereRevisionManual: true, resumenIA: true, categoriaCausaRaiz: true },
  });

  const ultimoEntrante =
    [...mensajes].reverse().find((m) => m.direction === MessageDirection.ENTRANTE)?.createdAt ?? null;
  const ventana = estadoVentana(ultimoEntrante);

  const suprimido = estaSuprimido(caso.telefonosNorm, await telefonosSuprimidos());
  const tel = telefonoContactable(caso);

  let puedeResponder: { ok: boolean; motivo: string };
  if (caso.whatsappOptOut) {
    puedeResponder = { ok: false, motivo: "El cliente pidió la baja (BAJA/STOP): no se le puede escribir." };
  } else if (suprimido) {
    puedeResponder = { ok: false, motivo: "El teléfono está en la lista de no contactar." };
  } else if (!tel) {
    puedeResponder = { ok: false, motivo: "El caso no tiene un teléfono válido de WhatsApp." };
  } else if (!ventana.abierta) {
    puedeResponder = {
      ok: false,
      motivo: ventana.cierraEn
        ? "Pasaron más de 24 hs desde el último mensaje del cliente: WhatsApp no permite texto libre. Podés reenviar la plantilla para reabrir la conversación."
        : "El cliente todavía no respondió, así que no hay ventana de 24 hs abierta. Podés reenviar la plantilla.",
    };
  } else {
    puedeResponder = { ok: true, motivo: "" };
  }

  const puedeReenviarPlantilla = !caso.whatsappOptOut && !suprimido && !!tel;

  res.json({
    data: {
      caso: {
        id: `caso:${caso.id}`,
        tipo: "caso",
        numeroOrden: caso.numeroOrden,
        nombre: caso.nombrePropietario,
        modelo: caso.modelo,
        asesor: caso.asesor,
        sucursal: caso.sucursal,
        area: caso.area,
        estadoContacto: caso.estadoContacto,
        tieneRqrAbierto: caso.tieneRqrAbierto,
        ultimoErrorEnvio: caso.ultimoErrorEnvio,
        optOut: caso.whatsappOptOut,
        suprimido,
        quiereAsesor: false,
      },
      mensajes,
      analisis,
      ventana,
      puedeResponder,
      puedeReenviarPlantilla,
    },
  });
}

async function verConversacionFidelizacion(req: Request, res: Response, id: string) {
  const cliente = await prisma.clienteFidelizacion.findUnique({ where: { id }, select: { ...SELECT_FIDEL_ENVIO } });
  if (!cliente) return res.status(404).json({ message: "No se encontró la conversación." });
  if (!autorizadoSobreFidelizacion(req, cliente)) {
    return res.status(403).json({ message: "Esa conversación es de otra provincia: no la podés ver." });
  }

  const mensajes = await prisma.whatsappMessage.findMany({
    where: { clienteFidelizacionId: cliente.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      direction: true,
      content: true,
      status: true,
      templateName: true,
      esAgradecimiento: true,
      mediaTipo: true,
      waMessageId: true,
      createdAt: true,
    },
  });

  const ultimoEntrante =
    [...mensajes].reverse().find((m) => m.direction === MessageDirection.ENTRANTE)?.createdAt ?? null;
  const ventana = estadoVentana(ultimoEntrante);

  const suprimido = estaSuprimido(cliente.telefonosNorm, await telefonosSuprimidos());
  const tel = telFidelizacion(cliente);

  let puedeResponder: { ok: boolean; motivo: string };
  if (suprimido) {
    puedeResponder = { ok: false, motivo: "El teléfono está en la lista de no contactar." };
  } else if (!tel) {
    puedeResponder = { ok: false, motivo: "El cliente no tiene un teléfono válido de WhatsApp." };
  } else if (!ventana.abierta) {
    puedeResponder = {
      ok: false,
      motivo: ventana.cierraEn
        ? "Pasaron más de 24 hs desde el último mensaje del cliente: WhatsApp no permite texto libre. Podés reenviar la plantilla para reabrir la conversación."
        : "El cliente todavía no respondió, así que no hay ventana de 24 hs abierta. Podés reenviar la plantilla.",
    };
  } else {
    puedeResponder = { ok: true, motivo: "" };
  }

  const puedeReenviarPlantilla = !suprimido && !!tel;

  res.json({
    data: {
      caso: {
        id: `fid:${cliente.id}`,
        tipo: "fidelizacion",
        numeroOrden: etiquetaFidelizacion(cliente),
        nombre: cliente.nombre,
        modelo: cliente.modelo ?? "",
        asesor: cliente.asesor ?? "",
        sucursal: cliente.sucursal,
        area: "FIDELIZACION",
        estadoContacto: estadoFidelParaMostrar(mensajes[mensajes.length - 1]?.direction, cliente.estado),
        tieneRqrAbierto: false,
        ultimoErrorEnvio: cliente.error,
        optOut: false,
        suprimido,
        quiereAsesor: cliente.quiereAsesorEn != null,
      },
      mensajes,
      analisis: null,
      ventana,
      puedeResponder,
      puedeReenviarPlantilla,
    },
  });
}

// ---------- POST /api/seguimiento/:id/responder (texto libre) ----------

const responderSchema = z.object({
  texto: z.string().trim().min(1, "Escribí un mensaje.").max(1000, "El mensaje es demasiado largo."),
});

/** Traduce un error de la API de WhatsApp a un HTTP + mensaje legible. */
function responderErrorWhatsapp(res: Response, err: unknown) {
  if (err instanceof WhatsappApiError) {
    return res.status(err.reintenable ? 503 : 409).json({ message: err.message });
  }
  return res.status(500).json({ message: "No se pudo enviar el mensaje. Probá de nuevo." });
}

export async function responder(req: Request, res: Response) {
  const parsed = responderSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Revisá el mensaje." });
  }
  const conv = parseConvId(req.params.casoId);
  if (!conv) return res.status(404).json({ message: "No se encontró la conversación." });
  if (conv.tipo === "fidelizacion") return responderFidelizacion(req, res, conv.id, parsed.data.texto);

  const caso = await prisma.caso.findFirst({
    where: { id: conv.id, eliminadoEn: null },
    select: { ...SELECT_CASO_ENVIO },
  });
  if (!caso) return res.status(404).json({ message: "No se encontró la conversación." });
  if (!autorizadoSobreCaso(req, caso)) {
    return res.status(403).json({ message: "Esa conversación es de otra área o provincia: no la podés gestionar." });
  }

  const tel = telefonoContactable(caso);
  if (!tel) return res.status(409).json({ message: "El caso no tiene un teléfono válido de WhatsApp." });
  if (caso.whatsappOptOut) {
    return res.status(409).json({ message: "El cliente pidió la baja: no se le puede escribir." });
  }
  if (estaSuprimido(caso.telefonosNorm, await telefonosSuprimidos())) {
    return res.status(409).json({ message: "El teléfono está en la lista de no contactar." });
  }
  const ventana = estadoVentana(await ultimoEntranteAt(caso.id));
  if (!ventana.abierta) {
    return res.status(409).json({
      message:
        "Pasaron más de 24 hs desde el último mensaje del cliente: WhatsApp no permite texto libre. " +
        "Reenviá la plantilla para reabrir la conversación.",
    });
  }

  let waMessageId: string;
  try {
    ({ waMessageId } = await sendTextMessage(tel, parsed.data.texto));
  } catch (err) {
    return responderErrorWhatsapp(res, err);
  }

  const mensaje = await prisma.whatsappMessage.create({
    data: {
      casoId: caso.id,
      direction: MessageDirection.SALIENTE,
      content: parsed.data.texto,
      status: "enviado",
      waMessageId,
    },
  });

  // Una respuesta a mano CANCELA el agradecimiento automático (si no, se pisarían).
  if (!caso.agradecimientoEnviadoEn) {
    await prisma.caso.update({ where: { id: caso.id }, data: { agradecimientoEnviadoEn: new Date() } });
  }
  try {
    await agradecimientoQueue.remove(`agradecimiento-${caso.id}`);
  } catch {
    // no existía o estaba activo: no pasa nada
  }

  await auditar(req, {
    accion: ACCIONES.SEGUIMIENTO_RESPUESTA,
    entidad: "Caso",
    entidadId: caso.id,
    detalles: { numeroOrden: caso.numeroOrden, largo: parsed.data.texto.length },
  });

  res.status(201).json({ message: "Mensaje enviado.", data: mensaje });
}

async function responderFidelizacion(req: Request, res: Response, id: string, texto: string) {
  const cliente = await prisma.clienteFidelizacion.findUnique({ where: { id }, select: { ...SELECT_FIDEL_ENVIO } });
  if (!cliente) return res.status(404).json({ message: "No se encontró la conversación." });
  if (!autorizadoSobreFidelizacion(req, cliente)) {
    return res.status(403).json({ message: "Esa conversación es de otra provincia: no la podés gestionar." });
  }

  const tel = telFidelizacion(cliente);
  if (!tel) return res.status(409).json({ message: "El cliente no tiene un teléfono válido de WhatsApp." });
  if (estaSuprimido(cliente.telefonosNorm, await telefonosSuprimidos())) {
    return res.status(409).json({ message: "El teléfono está en la lista de no contactar." });
  }
  const ultimo = await prisma.whatsappMessage.findFirst({
    where: { clienteFidelizacionId: cliente.id, direction: MessageDirection.ENTRANTE },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (!estadoVentana(ultimo?.createdAt ?? null).abierta) {
    return res.status(409).json({
      message:
        "Pasaron más de 24 hs desde el último mensaje del cliente: WhatsApp no permite texto libre. " +
        "Reenviá la plantilla para reabrir la conversación.",
    });
  }

  let waMessageId: string;
  try {
    ({ waMessageId } = await sendTextMessage(tel, texto));
  } catch (err) {
    return responderErrorWhatsapp(res, err);
  }

  const mensaje = await prisma.whatsappMessage.create({
    data: {
      clienteFidelizacionId: cliente.id,
      direction: MessageDirection.SALIENTE,
      content: texto,
      status: "enviado",
      waMessageId,
    },
  });

  // Atender a mano el "quiere asesor" lo da por resuelto (se saca del pendiente).
  if (cliente.quiereAsesorEn) {
    await prisma.clienteFidelizacion.update({ where: { id: cliente.id }, data: { quiereAsesorEn: null } });
  }

  await auditar(req, {
    accion: ACCIONES.SEGUIMIENTO_RESPUESTA,
    entidad: "ClienteFidelizacion",
    entidadId: cliente.id,
    detalles: { cliente: cliente.nombre, largo: texto.length },
  });

  res.status(201).json({ message: "Mensaje enviado.", data: mensaje });
}

// ---------- POST /api/seguimiento/:id/reenviar-plantilla ----------
// Se puede ELEGIR qué plantilla mandar:
//  - "contacto": reabre el ciclo con la plantilla de contacto del área (o la de
//    fidelización, si la conversación es de fidelización).
//  - "respuesta_no_recibida": le pide al cliente que repita su mensaje (para las
//    respuestas que se perdieron / quedaron huérfanas).
const reenviarSchema = z.object({
  plantilla: z.enum(["contacto", "respuesta_no_recibida"]).default("contacto"),
});
type TipoPlantilla = z.infer<typeof reenviarSchema>["plantilla"];

export async function reenviarPlantilla(req: Request, res: Response) {
  // Body vacío → "contacto" (default). Body con una plantilla FUERA del enum →
  // 400 (no se convierte en "contacto" en silencio).
  const parsedPlantilla = reenviarSchema.safeParse(req.body ?? {});
  if (!parsedPlantilla.success) {
    return res.status(400).json({ message: "Elegí una plantilla válida (contacto o respuesta_no_recibida)." });
  }
  const tipoPlantilla: TipoPlantilla = parsedPlantilla.data.plantilla;
  const conv = parseConvId(req.params.casoId);
  if (!conv) return res.status(404).json({ message: "No se encontró la conversación." });
  if (conv.tipo === "fidelizacion") return reenviarPlantillaFidelizacion(req, res, conv.id, tipoPlantilla);

  const caso = await prisma.caso.findFirst({
    where: { id: conv.id, eliminadoEn: null },
    select: { ...SELECT_CASO_ENVIO },
  });
  if (!caso) return res.status(404).json({ message: "No se encontró la conversación." });
  if (!autorizadoSobreCaso(req, caso)) {
    return res.status(403).json({ message: "Esa conversación es de otra área o provincia: no la podés gestionar." });
  }

  const tel = telefonoContactable(caso);
  if (!tel) return res.status(409).json({ message: "El caso no tiene un teléfono válido de WhatsApp." });
  if (caso.whatsappOptOut) {
    return res.status(409).json({ message: "El cliente pidió la baja: no se le puede escribir." });
  }
  if (estaSuprimido(caso.telefonosNorm, await telefonosSuprimidos())) {
    return res.status(409).json({ message: "El teléfono está en la lista de no contactar." });
  }

  // Plantilla elegida: la de contacto del área, o la de "no nos llegó tu mensaje".
  let plantilla: { name?: string; lang?: string };
  if (tipoPlantilla === "respuesta_no_recibida") {
    const creds = await obtenerCredencialesMeta();
    if (!creds.respuestaNoRecibidaName) {
      return res.status(409).json({
        message: "La plantilla de “no nos llegó tu mensaje” no está configurada. Cargala en Configuración → WhatsApp.",
      });
    }
    plantilla = { name: creds.respuestaNoRecibidaName, lang: creds.respuestaNoRecibidaLang };
  } else {
    plantilla = await plantillaContactoPara(caso.area);
  }

  let waMessageId: string;
  let templateName: string;
  try {
    ({ waMessageId, templateName } = await sendTemplateMessage(tel, [], plantilla));
  } catch (err) {
    return responderErrorWhatsapp(res, err);
  }

  const mensaje = await prisma.whatsappMessage.create({
    data: {
      casoId: caso.id,
      direction: MessageDirection.SALIENTE,
      content: `Plantilla "${templateName}" reenviada desde Seguimiento`,
      templateName,
      status: "enviado",
      waMessageId,
    },
  });
  await prisma.caso.update({
    where: { id: caso.id },
    data: { estadoContacto: EstadoContacto.ENVIADO, ultimoErrorEnvio: null },
  });

  await auditar(req, {
    accion: ACCIONES.SEGUIMIENTO_PLANTILLA,
    entidad: "Caso",
    entidadId: caso.id,
    detalles: { numeroOrden: caso.numeroOrden, templateName },
  });

  res.status(201).json({ message: "Plantilla reenviada.", data: mensaje });
}

async function reenviarPlantillaFidelizacion(req: Request, res: Response, id: string, tipoPlantilla: TipoPlantilla) {
  const cliente = await prisma.clienteFidelizacion.findUnique({ where: { id }, select: { ...SELECT_FIDEL_ENVIO } });
  if (!cliente) return res.status(404).json({ message: "No se encontró la conversación." });
  if (!autorizadoSobreFidelizacion(req, cliente)) {
    return res.status(403).json({ message: "Esa conversación es de otra provincia: no la podés gestionar." });
  }

  const tel = telFidelizacion(cliente);
  if (!tel) return res.status(409).json({ message: "El cliente no tiene un teléfono válido de WhatsApp." });
  if (estaSuprimido(cliente.telefonosNorm, await telefonosSuprimidos())) {
    return res.status(409).json({ message: "El teléfono está en la lista de no contactar." });
  }

  // Plantilla elegida: la de FIDELIZACIÓN o la de "no nos llegó tu mensaje".
  const creds = await obtenerCredencialesMeta();
  let plantilla: { name?: string; lang?: string };
  if (tipoPlantilla === "respuesta_no_recibida") {
    if (!creds.respuestaNoRecibidaName) {
      return res.status(409).json({
        message: "La plantilla de “no nos llegó tu mensaje” no está configurada. Cargala en Configuración → WhatsApp.",
      });
    }
    plantilla = { name: creds.respuestaNoRecibidaName, lang: creds.respuestaNoRecibidaLang };
  } else {
    plantilla = { name: creds.fidelizacionTemplateName, lang: creds.fidelizacionTemplateLang };
  }

  let waMessageId: string;
  let templateName: string;
  try {
    ({ waMessageId, templateName } = await sendTemplateMessage(tel, [], plantilla));
  } catch (err) {
    return responderErrorWhatsapp(res, err);
  }

  const mensaje = await prisma.whatsappMessage.create({
    data: {
      clienteFidelizacionId: cliente.id,
      direction: MessageDirection.SALIENTE,
      content: `Plantilla "${templateName}" reenviada desde Seguimiento`,
      templateName,
      status: "enviado",
      waMessageId,
    },
  });
  await prisma.clienteFidelizacion.update({
    where: { id: cliente.id },
    data: { estado: EstadoFidelizacion.ENVIADO, enviadoEn: new Date(), waMessageId, error: null },
  });

  await auditar(req, {
    accion: ACCIONES.SEGUIMIENTO_PLANTILLA,
    entidad: "ClienteFidelizacion",
    entidadId: cliente.id,
    detalles: { cliente: cliente.nombre, templateName },
  });

  res.status(201).json({ message: "Plantilla reenviada.", data: mensaje });
}
