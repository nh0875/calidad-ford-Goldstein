import { Request, Response } from "express";
import { EstadoContacto, MessageDirection } from "@prisma/client";
import { prisma } from "../config/prisma";
import { normalizarTelefonoAR } from "../services/telefono.service";
import { marcarOptOutSiCorresponde } from "../services/agradecimiento.service";
import { programarAnalisis } from "../services/analisis.service";
import { guardarEstadoPlantillaFidelizacion, obtenerCredencialesMeta } from "../services/configuracion.service";

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
  // Reacción con emoji (el cliente "reacciona" a nuestro mensaje con 👍, ❤️, etc.).
  // Llega como type "reaction", NO como texto. emoji vacío = quitó la reacción.
  reaction?: { emoji?: string; message_id?: string };
  // Nota de voz / audio: llega con type "audio" y el id del archivo en Meta.
  audio?: { id?: string; mime_type?: string; voice?: boolean };
}

function extraerContenido(mensaje: MensajeEntranteMeta): string {
  if (mensaje.text?.body) return mensaje.text.body;
  // Una reacción es el emoji solo (👍). Se guarda tal cual para que el análisis
  // lo clasifique (un 👍 es un VERDE); ver esReaccionPositiva en analisis.service.
  if (mensaje.reaction?.emoji) return mensaje.reaction.emoji;
  if (mensaje.button?.text) return mensaje.button.text;
  if (mensaje.interactive?.button_reply?.title) return mensaje.interactive.button_reply.title;
  if (mensaje.interactive?.list_reply?.title) return mensaje.interactive.list_reply.title;
  // Audio: placeholder inicial; el worker lo reemplaza por la transcripción de Gemini.
  if (mensaje.audio?.id) return "[audio]";
  return `[mensaje de tipo ${mensaje.type}]`;
}

async function procesarMensajeEntrante(mensaje: MensajeEntranteMeta) {
  // Quitar una reacción (emoji vacío) no es una respuesta: llega como type
  // "reaction" con emoji "". Se ignora para no crear un mensaje fantasma ni
  // pasar el caso a RESPONDIDO por algo que el cliente justamente deshizo.
  if (mensaje.type === "reaction" && !mensaje.reaction?.emoji) {
    return;
  }

  // Idempotencia: Meta puede reintentar la MISMA entrega (mismo id). Si ese
  // waMessageId ya está guardado (como mensaje entrante o como huérfano), no se
  // procesa de nuevo (si no, se duplicaría el mensaje y se re-dispararía el
  // análisis). El índice único de waMessageId es la garantía dura ante carreras.
  if (mensaje.id) {
    const [yaMsg, yaHuerfano] = await Promise.all([
      prisma.whatsappMessage.findFirst({ where: { waMessageId: mensaje.id }, select: { id: true } }),
      prisma.mensajeHuerfano.findFirst({ where: { waMessageId: mensaje.id }, select: { id: true } }),
    ]);
    if (yaMsg || yaHuerfano) return;
  }

  // El número llega como "549264..." — se prueba tal cual (+) y re-normalizado
  const candidatos = [...new Set([`+${mensaje.from}`, normalizarTelefonoAR(mensaje.from)])].filter(
    (t): t is string => t !== null
  );

  const contenido = extraerContenido(mensaje);

  // Se prioriza un caso esperando respuesta (ENVIADO); si no hay, cualquier caso
  // con ese teléfono (puede ser una respuesta tardía ya marcada NO_RESPONDIO).
  // Se excluyen los casos borrados: una respuesta no debe engancharse a un caso
  // eliminado (ej. un duplicado que se dio de baja) y perderse de la vista.
  const caso =
    (await prisma.caso.findFirst({
      where: {
        eliminadoEn: null,
        estadoContacto: EstadoContacto.ENVIADO,
        OR: [{ whatsapp: { in: candidatos } }, { celular: { in: candidatos } }],
      },
      orderBy: { createdAt: "desc" },
    })) ??
    (await prisma.caso.findFirst({
      where: {
        eliminadoEn: null,
        OR: [{ whatsapp: { in: candidatos } }, { celular: { in: candidatos } }],
      },
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

  await prisma.whatsappMessage.create({
    data: {
      casoId: caso.id,
      direction: MessageDirection.ENTRANTE,
      content: contenido,
      waMessageId: mensaje.id,
      status: "recibido",
      // Audio: se guarda el id del archivo en Meta para que el worker lo baje y
      // Gemini lo transcriba (el análisis corre async, separado del webhook).
      ...(mensaje.audio?.id
        ? { mediaId: mensaje.audio.id, mediaMimeType: mensaje.audio.mime_type ?? null, mediaTipo: "audio" }
        : {}),
    },
  });

  await prisma.caso.update({
    where: { id: caso.id },
    data: { estadoContacto: EstadoContacto.RESPONDIDO },
  });

  // Opt-out (BAJA/STOP): se marca el caso; el agradecimiento lo respeta (no se envía)
  await marcarOptOutSiCorresponde(caso.id, contenido);

  // El análisis NO se dispara por mensaje: se programa (y se reprograma con
  // cada mensaje nuevo) para analizar la tanda completa de una sola vez. Un
  // cliente que escribe "hola" / "todo bien" / "pero tardaron" genera UN
  // análisis, no tres. Ver analisis.service.ts.
  await programarAnalisis(caso.id);

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

        // Cambio de estado de una plantilla: Meta avisa cuando aprueba/rechaza.
        // Se guarda el estado de la plantilla de fidelización para saber si ya
        // se puede enviar el recordatorio (sin "probar y ver"). Este cambio no
        // trae messages/statuses, así que se procesa y se pasa al siguiente.
        if (cambio?.field === "message_template_status_update") {
          try {
            const creds = await obtenerCredencialesMeta();
            if (valor.message_template_name === creds.fidelizacionTemplateName && valor.event) {
              await guardarEstadoPlantillaFidelizacion(String(valor.event));
              console.log(`[webhook] plantilla ${valor.message_template_name} → ${valor.event}`);
            }
          } catch (err) {
            console.error("[webhook] error procesando estado de plantilla:", err);
          }
          continue;
        }

        // Cada mensaje se aísla: si uno falla (DB, análisis, etc.) no debe
        // abortar el resto de la tanda ni perder los otros mensajes del batch.
        for (const mensaje of (valor.messages ?? []) as MensajeEntranteMeta[]) {
          try {
            await procesarMensajeEntrante(mensaje);
          } catch (err) {
            console.error(`[webhook] error procesando mensaje ${mensaje?.id ?? "?"}:`, err);
          }
        }

        // Acuses de entrega/lectura de los mensajes salientes
        for (const status of (valor.statuses ?? []) as StatusMeta[]) {
          if (!status?.id || !status?.status) continue;
          try {
            await prisma.whatsappMessage.updateMany({
              where: { waMessageId: status.id },
              data: { status: status.status },
            });
          } catch (err) {
            console.error(`[webhook] error actualizando status ${status.id}:`, err);
          }
        }
      }
    }
  } catch (err) {
    console.error("[webhook] error procesando notificación de Meta:", err);
  }
  res.sendStatus(200);
}
