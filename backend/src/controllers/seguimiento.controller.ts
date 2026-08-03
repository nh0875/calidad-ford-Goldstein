import { Request, Response } from "express";
import { EstadoContacto, MessageDirection, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { parsearAreaQuery, puedeAcceder, whereArea } from "../services/area.service";
import { mismaProvincia } from "../services/refuerzo.service";
import { estadoVentana, telefonoContactable, ultimoEntranteAt } from "../services/seguimiento.service";
import { sendTemplateMessage, sendTextMessage, WhatsappApiError } from "../services/whatsapp.service";
import { estaSuprimido, telefonosSuprimidos } from "../services/supresion.service";
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
// Aislamiento: a diferencia de los tableros (Casos/Sentimiento, que son por
// área), acá cada quien ve SOLO su PROVINCIA + área. El ADMIN y "AMBAS/todas"
// ven todo. El filtro de área va en la base; la provincia se filtra en JS por
// los acentos (Postgres no los pliega). Ver refuerzo.service.mismaProvincia.

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

/** 403 si el caso no es del área+provincia del usuario. Devuelve true si autorizó. */
function autorizadoSobreCaso(req: Request, caso: { area: any; sucursal: string | null }): boolean {
  return puedeAcceder(req.usuario!, caso.area) && mismaProvincia(req.usuario!.sucursal, caso.sucursal);
}

// ---------- GET /api/seguimiento (lista de conversaciones) ----------

const listQuerySchema = z.object({
  // "todas" (default) | "revision" (pendientes de clasificar) | "rojos"
  filtro: z.enum(["todas", "revision", "rojos"]).default("todas"),
  q: z.string().trim().max(80).optional(),
});

export async function listarConversaciones(req: Request, res: Response) {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: "Filtro inválido." });
  }
  const { filtro, q } = parsed.data;
  const areaWhere = whereArea(req.usuario!, parsearAreaQuery(req.query.area));

  const casos = await prisma.caso.findMany({
    where: {
      eliminadoEn: null,
      ...areaWhere,
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
  });

  const termino = q?.toLowerCase();
  const lista = casos
    // Provincia (acentos): se filtra en JS sobre lo que trajo la base.
    .filter((c) => mismaProvincia(req.usuario!.sucursal, c.sucursal))
    .map((c) => {
      const um = c.mensajes[0];
      const a = c.analisis[0];
      return {
        id: c.id,
        numeroOrden: c.numeroOrden,
        nombre: c.nombrePropietario,
        modelo: c.modelo,
        asesor: c.asesor,
        sucursal: c.sucursal,
        area: c.area,
        estadoContacto: c.estadoContacto,
        tieneRqrAbierto: c.tieneRqrAbierto,
        optOut: c.whatsappOptOut,
        semaforo: a?.semaforo ?? null,
        requiereRevision: a?.requiereRevisionManual ?? false,
        totalMensajes: c._count.mensajes,
        ultimoMensaje: um
          ? {
              content: um.content,
              direction: um.direction,
              createdAt: um.createdAt,
              status: um.status,
              mediaTipo: um.mediaTipo,
            }
          : null,
      };
    })
    .filter((c) => (filtro === "revision" ? c.requiereRevision : filtro === "rojos" ? c.semaforo === "ROJO" : true))
    .filter(
      (c) =>
        !termino ||
        c.nombre.toLowerCase().includes(termino) ||
        c.numeroOrden.toLowerCase().includes(termino)
    )
    .sort((a, b) => {
      const ta = a.ultimoMensaje?.createdAt.getTime() ?? 0;
      const tb = b.ultimoMensaje?.createdAt.getTime() ?? 0;
      return tb - ta; // más reciente primero (como WhatsApp)
    });

  res.json({ data: lista, total: lista.length });
}

// ---------- GET /api/seguimiento/pendientes (badge del menú, por provincia) ----------

export async function contarPendientesSeguimiento(req: Request, res: Response) {
  const areaWhere = whereArea(req.usuario!, parsearAreaQuery(req.query.area));
  const analisis = await prisma.sentimentAnalysis.findMany({
    where: {
      esSeguimiento: false,
      requiereRevisionManual: true,
      caso: { eliminadoEn: null, ...areaWhere },
    },
    select: { caso: { select: { sucursal: true } } },
  });
  const pendientes = analisis.filter((a) => mismaProvincia(req.usuario!.sucursal, a.caso?.sucursal)).length;
  res.json({ pendientes });
}

// ---------- GET /api/seguimiento/:casoId (hilo completo) ----------

export async function verConversacion(req: Request, res: Response) {
  const caso = await prisma.caso.findFirst({
    where: { id: req.params.casoId, eliminadoEn: null },
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

  // Ventana de 24 hs: se calcula desde el último ENTRANTE (ya lo tenemos en la tanda).
  const ultimoEntrante =
    [...mensajes].reverse().find((m) => m.direction === MessageDirection.ENTRANTE)?.createdAt ?? null;
  const ventana = estadoVentana(ultimoEntrante);

  const suprimido = estaSuprimido(caso.telefonosNorm, await telefonosSuprimidos());
  const tel = telefonoContactable(caso);

  // ¿Se puede escribir texto libre AHORA? (ventana abierta + no bloqueado)
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

  // La plantilla se puede (re)enviar siempre que no esté bloqueado por baja/supresión/teléfono.
  const puedeReenviarPlantilla = !caso.whatsappOptOut && !suprimido && !!tel;

  res.json({
    data: {
      caso: {
        id: caso.id,
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
      },
      mensajes,
      analisis,
      ventana,
      puedeResponder,
      puedeReenviarPlantilla,
    },
  });
}

// ---------- POST /api/seguimiento/:casoId/responder (texto libre) ----------

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

  const caso = await prisma.caso.findFirst({
    where: { id: req.params.casoId, eliminadoEn: null },
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

  // Una respuesta a mano CANCELA el agradecimiento automático: si no, el sistema
  // le mandaría además su mensaje enlatado y se pisarían. Marcar el caso como
  // "ya agradecido" hace que el worker lo omita; además se saca el job pendiente.
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

// ---------- POST /api/seguimiento/:casoId/reenviar-plantilla ----------

export async function reenviarPlantilla(req: Request, res: Response) {
  const caso = await prisma.caso.findFirst({
    where: { id: req.params.casoId, eliminadoEn: null },
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

  let waMessageId: string;
  let templateName: string;
  try {
    ({ waMessageId, templateName } = await sendTemplateMessage(tel, []));
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
  // La plantilla reabre el ciclo: el caso vuelve a "esperando respuesta".
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
