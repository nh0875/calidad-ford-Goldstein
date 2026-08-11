import { Request, Response } from "express";
import { EstadoContacto, EstadoFidelizacion, MessageDirection, MotivoSupresion } from "@prisma/client";
import { prisma } from "../config/prisma";
import { normalizarTelefonoAR } from "../services/telefono.service";
import {
  esMensajeOptOut,
  marcarOptOutSiCorresponde,
  reemplazarPlaceholders,
} from "../services/agradecimiento.service";
import { programarAnalisis } from "../services/analisis.service";
import {
  CLAVES_CONFIG,
  guardarEstadoPlantillaFidelizacion,
  obtenerCredencialesMeta,
  obtenerValor,
} from "../services/configuracion.service";
import { agregarSupresion, estaSuprimido, telefonosSuprimidos } from "../services/supresion.service";
import { sendTextMessage } from "../services/whatsapp.service";

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

// Busca un cliente de Fidelización por teléfono (para engancharle su respuesta).
// Solo los que YA recibieron el recordatorio (estado ENVIADO) pueden estar
// respondiendo; se excluye a los PENDIENTE (enviadoEn=null, p.ej. de una
// reimportación), que además con NULLS FIRST quedarían primeros por error.
function buscarClienteFidelizacion(candidatos: string[]) {
  return prisma.clienteFidelizacion.findFirst({
    where: {
      eliminadoEn: null,
      estado: EstadoFidelizacion.ENVIADO,
      OR: [{ telefono: { in: candidatos } }, { telefonosNorm: { hasSome: candidatos } }],
    },
    orderBy: { enviadoEn: { sort: "desc", nulls: "last" } },
  });
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

  // ¿Es el 3er botón de la plantilla de Fidelización ("Agendar mi Turno con un
  // Asesor")? Ese botón SOLO existe en esa plantilla. El título a reconocer es
  // configurable (por si lo renombran en Meta).
  const esBoton =
    mensaje.type === "button" || Boolean(mensaje.button?.text) || Boolean(mensaje.interactive?.button_reply);
  const tituloBotonAsesor = (await obtenerValor(CLAVES_CONFIG.FIDELIZACION_TEXTO_BOTON_ASESOR)).trim().toLowerCase();
  const esBotonAsesor =
    esBoton && tituloBotonAsesor.length > 0 && contenido.trim().toLowerCase() === tituloBotonAsesor;

  // Resolución del destino (Caso vs Fidelización). Se excluyen los casos
  // borrados: una respuesta no debe engancharse a un caso eliminado.
  //  - el botón de asesor SOLO existe en Fidelización → va a fidelización.
  //  - si no, prioridad al Caso esperando respuesta (ENVIADO); luego un cliente
  //    de fidelización recién recordado; luego cualquier Caso; si nada, huérfano.
  const wherePorTelefono = { OR: [{ whatsapp: { in: candidatos } }, { celular: { in: candidatos } }] };
  const fidel = await buscarClienteFidelizacion(candidatos);
  const casoEnviado = await prisma.caso.findFirst({
    where: { eliminadoEn: null, estadoContacto: EstadoContacto.ENVIADO, ...wherePorTelefono },
    orderBy: { createdAt: "desc" },
  });

  let caso: Awaited<ReturnType<typeof prisma.caso.findFirst>> = null;
  let clienteFidel: Awaited<ReturnType<typeof prisma.clienteFidelizacion.findFirst>> = null;

  if (esBotonAsesor && fidel) {
    // El botón "Agendar con asesor" solo existe en la plantilla de fidelización.
    clienteFidel = fidel;
  } else if (casoEnviado) {
    caso = casoEnviado;
  } else {
    // CUALQUIER Caso del teléfono le gana a Fidelización: un texto suelto
    // continúa el hilo del Caso. Si no, el 2º mensaje de una conversación de
    // Caso (que ya pasó de ENVIADO a RESPONDIDO) se desviaba a Fidelización.
    // Solo si NO hay ningún Caso del teléfono, la respuesta es de Fidelización.
    const anyCaso = await prisma.caso.findFirst({
      where: { eliminadoEn: null, ...wherePorTelefono },
      orderBy: { createdAt: "desc" },
    });
    if (anyCaso) caso = anyCaso;
    else if (fidel) clienteFidel = fidel;
  }

  if (!caso && !clienteFidel) {
    // No se descarta: queda para revisión manual (puede ser otra persona
    // respondiendo por el cliente desde su propio número).
    await prisma.mensajeHuerfano.create({
      data: {
        telefono: candidatos[0] ?? mensaje.from,
        waMessageId: mensaje.id,
        content: contenido,
        payload: mensaje as object,
      },
    });
    console.warn(`[webhook] mensaje huérfano de ${mensaje.from}: no matchea ningún caso ni fidelización`);
    return;
  }

  // Audio: se guarda el id del archivo en Meta para que el worker lo baje y
  // Gemini lo transcriba (solo se transcribe para Casos; el análisis corre async).
  const datosMedia = mensaje.audio?.id
    ? { mediaId: mensaje.audio.id, mediaMimeType: mensaje.audio.mime_type ?? null, mediaTipo: "audio" }
    : {};

  // ---- Caso (Contacto Posventa/Ventas): comportamiento de siempre ----
  if (caso) {
    await prisma.whatsappMessage.create({
      data: {
        casoId: caso.id,
        direction: MessageDirection.ENTRANTE,
        content: contenido,
        waMessageId: mensaje.id,
        status: "recibido",
        ...datosMedia,
      },
    });
    await prisma.caso.update({
      where: { id: caso.id },
      data: { estadoContacto: EstadoContacto.RESPONDIDO },
    });
    // Opt-out (BAJA/STOP): se marca el caso; el agradecimiento lo respeta.
    await marcarOptOutSiCorresponde(caso.id, contenido);
    // El análisis se programa (debounce) para analizar la tanda completa junta.
    await programarAnalisis(caso.id);
    console.log(`[webhook] respuesta de ${mensaje.from} asociada al caso ${caso.numeroOrden} (${caso.id})`);
    return;
  }

  // ---- Fidelización: se registra la respuesta, SIN análisis de sentimiento ----
  await prisma.whatsappMessage.create({
    data: {
      clienteFidelizacionId: clienteFidel!.id,
      direction: MessageDirection.ENTRANTE,
      content: contenido,
      waMessageId: mensaje.id,
      status: "recibido",
      ...datosMedia,
    },
  });

  // Opt-out: no hay flag por caso (no es un Caso), así que va a la lista de
  // supresión global para que una re-importación tampoco lo vuelva a contactar.
  if (esMensajeOptOut(contenido)) {
    await agregarSupresion({ telefono: clienteFidel!.telefono, motivo: MotivoSupresion.OPT_OUT_WHATSAPP });
  }

  // 3er botón: marca "quiere asesor" (para Seguimiento) y manda el mensaje configurable.
  if (esBotonAsesor) {
    await responderBotonAsesorFidelizacion(clienteFidel!);
  }

  console.log(
    `[webhook] respuesta de ${mensaje.from} asociada a fidelización de ${clienteFidel!.nombre} (${clienteFidel!.id})`
  );
}

// El cliente apretó "Agendar mi Turno con un Asesor": queda marcado como
// pendiente de asesor (visible en Seguimiento) y, si está activada la respuesta
// automática, se le manda el mensaje configurable por el jefe de servicio.
async function responderBotonAsesorFidelizacion(cliente: {
  id: string;
  nombre: string;
  modelo: string | null;
  telefono: string;
  telefonosNorm: string[];
}) {
  // El flag va SIEMPRE, aunque la respuesta automática esté apagada o falle: así
  // nadie pierde el pedido de turno.
  await prisma.clienteFidelizacion.update({
    where: { id: cliente.id },
    data: { quiereAsesorEn: new Date() },
  });

  if ((await obtenerValor(CLAVES_CONFIG.FIDELIZACION_ENVIAR_RESPUESTA_BOTON)) !== "true") return;
  if (estaSuprimido(cliente.telefonosNorm, await telefonosSuprimidos())) return;

  const tel = cliente.telefono || cliente.telefonosNorm[0];
  if (!tel) return;

  const plantilla = await obtenerValor(CLAVES_CONFIG.FIDELIZACION_RESPUESTA_BOTON_ASESOR);
  const texto = reemplazarPlaceholders(plantilla, {
    nombrePropietario: cliente.nombre,
    emailPropietario: null,
    modelo: cliente.modelo ?? "",
  });

  try {
    const { waMessageId } = await sendTextMessage(tel, texto);
    await prisma.whatsappMessage.create({
      data: {
        clienteFidelizacionId: cliente.id,
        direction: MessageDirection.SALIENTE,
        content: texto,
        status: "enviado",
        waMessageId,
        esAgradecimiento: true, // es un mensaje automático, no una respuesta a mano
      },
    });
  } catch (err) {
    // Si la respuesta automática falla, el flag "quiere asesor" ya quedó: alguien
    // lo ve en Seguimiento y lo llama igual. No rompemos el webhook.
    console.error(
      `[webhook] no se pudo enviar la respuesta automática de asesor a ${cliente.nombre}:`,
      err instanceof Error ? err.message : err
    );
  }
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
