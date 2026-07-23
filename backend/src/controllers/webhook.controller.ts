import { Request, Response } from "express";
import { EstadoContacto, MessageDirection } from "@prisma/client";
import { prisma } from "../config/prisma";
import { analisisQueue } from "../jobs/queues";
import { normalizarTelefonoAR } from "../services/telefono.service";
import { marcarOptOutSiCorresponde } from "../services/agradecimiento.service";
import { obtenerCredencialesMeta } from "../services/configuracion.service";

// ---------- GET: verificación inicial del webhook por parte de Meta ----------

export async function verificarWebhook(req: Request, res: Response) {
  const modo = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  const { webhookVerifyToken } = await obtenerCredencialesMeta();
  if (modo === "subscribe" && webhookVerifyToken && token === webhookVerifyToken && typeof challenge === "string") {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
}

// ---------- POST: mensajes entrantes y actualizaciones de estado ----------

interface MensajeEntranteMeta {
  id: string;
  from: string; // ej "5492645123456" (sin el +)
  type: string;
  text?: { body: string };
  button?: { text: string };
  interactive?: { button_reply?: { title: string }; list_reply?: { title: string } };
}

function extraerContenido(mensaje: MensajeEntranteMeta): string {
  if (mensaje.text?.body) return mensaje.text.body;
  if (mensaje.button?.text) return mensaje.button.text;
  if (mensaje.interactive?.button_reply?.title) return mensaje.interactive.button_reply.title;
  if (mensaje.interactive?.list_reply?.title) return mensaje.interactive.list_reply.title;
  return `[mensaje de tipo ${mensaje.type}]`;
}

async function procesarMensajeEntrante(mensaje: MensajeEntranteMeta) {
  // El número llega como "549264..." — se prueba tal cual (+) y re-normalizado
  const candidatos = [...new Set([`+${mensaje.from}`, normalizarTelefonoAR(mensaje.from)])].filter(
    (t): t is string => t !== null
  );

  const contenido = extraerContenido(mensaje);

  // Se prioriza un caso esperando respuesta (ENVIADO); si no hay, cualquier caso
  // con ese teléfono (puede ser una respuesta tardía ya marcada NO_RESPONDIO)
  const caso =
    (await prisma.caso.findFirst({
      where: {
        estadoContacto: EstadoContacto.ENVIADO,
        OR: [{ whatsapp: { in: candidatos } }, { celular: { in: candidatos } }],
      },
      orderBy: { createdAt: "desc" },
    })) ??
    (await prisma.caso.findFirst({
      where: { OR: [{ whatsapp: { in: candidatos } }, { celular: { in: candidatos } }] },
      orderBy: { createdAt: "desc" },
    }));

  if (!caso) {
    // No se descarta: queda para revisión manual (puede ser otra persona
    // respondiendo por el cliente desde su propio número)
    await prisma.mensajeHuerfano.create({
      data: {
        telefono: candidatos[0] ?? mensaje.from,
        waMessageId: mensaje.id,
        content: contenido,
        payload: mensaje as object,
      },
    });
    console.warn(`[webhook] mensaje huérfano de ${mensaje.from}: no matchea ningún caso`);
    return;
  }

  const guardado = await prisma.whatsappMessage.create({
    data: {
      casoId: caso.id,
      direction: MessageDirection.ENTRANTE,
      content: contenido,
      waMessageId: mensaje.id,
      status: "recibido",
    },
  });

  await prisma.caso.update({
    where: { id: caso.id },
    data: { estadoContacto: EstadoContacto.RESPONDIDO },
  });

  // Opt-out (BAJA/STOP): se marca el caso; el agradecimiento lo respeta (no se envía)
  await marcarOptOutSiCorresponde(caso.id, contenido);

  await analisisQueue.add(
    "analizar-respuesta",
    { casoId: caso.id, messageId: guardado.id },
    {
      attempts: 5, // el 429 de cuota se reintenta con backoff largo; no queremos jobs muertos
      backoff: { type: "custom" }, // ver backoffStrategy del worker (60-90s ante 429)
      removeOnComplete: { age: 3600, count: 5000 },
      removeOnFail: { age: 24 * 3600 },
    }
  );

  console.log(`[webhook] respuesta de ${mensaje.from} asociada al caso ${caso.numeroOrden} (${caso.id})`);
}

interface StatusMeta {
  id: string; // waMessageId del mensaje saliente
  status: string; // sent | delivered | read | failed
}

export async function recibirWebhook(req: Request, res: Response) {
  // Meta exige responder 200 rápido; cualquier error se loguea pero no se propaga
  try {
    const entradas = req.body?.entry ?? [];
    for (const entrada of entradas) {
      for (const cambio of entrada?.changes ?? []) {
        const valor = cambio?.value;
        if (!valor) continue;

        for (const mensaje of (valor.messages ?? []) as MensajeEntranteMeta[]) {
          await procesarMensajeEntrante(mensaje);
        }

        // Acuses de entrega/lectura de los mensajes salientes
        for (const status of (valor.statuses ?? []) as StatusMeta[]) {
          if (!status?.id || !status?.status) continue;
          await prisma.whatsappMessage.updateMany({
            where: { waMessageId: status.id },
            data: { status: status.status },
          });
        }
      }
    }
  } catch (err) {
    console.error("[webhook] error procesando notificación de Meta:", err);
  }
  res.sendStatus(200);
}
