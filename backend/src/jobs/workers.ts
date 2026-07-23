import { EstadoContacto, MessageDirection, Prisma, Semaforo } from "@prisma/client";
import { DelayedError, Job, UnrecoverableError, Worker } from "bullmq";
import { env } from "../config/env";
import { cupoDisponibleHoy, dentroDeVentana, msHastaProximaApertura } from "../services/ventana-envio.service";
import { prisma } from "../config/prisma";
import { redisConnection } from "../config/redis";
import { marcarNoRespondidos } from "../services/mantenimiento.service";
import { crearRqrAutomatico } from "../services/rqr.service";
import { analizarRespuesta, esErrorCuota, esErrorReintenable } from "../services/sentiment.service";
import { WhatsappApiError, sendTemplateMessage, sendTextMessage } from "../services/whatsapp.service";
import { programarAgradecimiento, reemplazarPlaceholders } from "../services/agradecimiento.service";
import { CLAVES_CONFIG, obtenerConfiguracion } from "../services/configuracion.service";
import { QUEUE_NAMES } from "./queues";

// ---------- Worker de envío de WhatsApp ----------

interface DatosEnvio {
  casoId: string;
}

function formatearFecha(fecha: Date | null): string {
  if (!fecha) return "-";
  const d = String(fecha.getDate()).padStart(2, "0");
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  return `${d}/${m}/${fecha.getFullYear()}`;
}

async function procesarEnvioWhatsapp(job: Job<DatosEnvio>, token?: string) {
  const caso = await prisma.caso.findUnique({ where: { id: job.data.casoId } });
  if (!caso) {
    throw new UnrecoverableError("El caso ya no existe en la base.");
  }

  // Idempotencia: si el estado cambió entre el encolado y ahora
  // (respondió, otro envío, marcado interno), no se envía nada.
  if (caso.estadoContacto !== EstadoContacto.PENDIENTE) {
    return { omitido: true, motivo: `estado ${caso.estadoContacto}` };
  }

  // Ventana horaria y tope diario: si estamos fuera de horario o ya se llegó al
  // tope del día, se re-agenda el job para la próxima apertura (NO cuenta como
  // intento ni fallo; el mensaje sale solo cuando abre la ventana / al día
  // siguiente). Así una campaña grande "gotea" respetando horario y tope.
  if (!dentroDeVentana()) {
    await job.moveToDelayed(Date.now() + msHastaProximaApertura(), token);
    throw new DelayedError();
  }
  if ((await cupoDisponibleHoy()) <= 0) {
    await job.moveToDelayed(Date.now() + msHastaProximaApertura(), token);
    throw new DelayedError();
  }

  // whatsapp normalizado en la importación, celular como respaldo
  const telefono = caso.whatsapp?.trim() || caso.celular?.trim() || "";
  if (!telefono.startsWith("+")) {
    throw new UnrecoverableError(
      "El caso no tiene ningún teléfono válido para WhatsApp (ni en la columna Whatsapp ni en Celular)."
    );
  }

  // Variables del template: nombre, modelo, fecha de salida del servicio
  const variables = [
    caso.nombrePropietario || "cliente",
    caso.modelo || "su vehículo",
    formatearFecha(caso.fechaSalida),
  ];

  let waMessageId: string;
  let templateName: string;
  try {
    ({ waMessageId, templateName } = await sendTemplateMessage(telefono, variables));
  } catch (err) {
    // Número inválido / template mal / credenciales: no tiene sentido reintentar
    if (err instanceof WhatsappApiError && !err.reintenable) {
      throw new UnrecoverableError(err.message);
    }
    // Rate limit, timeout, 5xx: BullMQ reintenta con backoff exponencial
    throw err;
  }

  // A partir de acá el mensaje YA SALIÓ: un fallo de base no debe reintentar
  // el job, porque el reintento le mandaría el WhatsApp de nuevo al cliente.
  try {
    await prisma.$transaction([
      prisma.whatsappMessage.create({
        data: {
          casoId: caso.id,
          direction: MessageDirection.SALIENTE,
          content: `Template "${templateName}" → ${variables.join(" | ")}`,
          templateName,
          waMessageId,
          status: "enviado",
        },
      }),
      prisma.caso.update({
        where: { id: caso.id },
        data: { estadoContacto: EstadoContacto.ENVIADO, ultimoErrorEnvio: null },
      }),
    ]);
  } catch (err) {
    throw new UnrecoverableError(
      `El mensaje se envió (id ${waMessageId}) pero no se pudo registrar en la base: ${
        err instanceof Error ? err.message.slice(0, 300) : String(err)
      }`
    );
  }

  return { enviado: true, waMessageId };
}

// ---------- Worker de análisis de sentimiento ----------

interface DatosAnalisis {
  casoId: string;
  messageId: string;
}

async function procesarAnalisisSentimiento(job: Job<DatosAnalisis>) {
  const { casoId, messageId } = job.data;

  const caso = await prisma.caso.findUnique({ where: { id: casoId } });
  const mensaje = await prisma.whatsappMessage.findUnique({ where: { id: messageId } });
  if (!caso || !mensaje) {
    throw new UnrecoverableError("El caso o el mensaje ya no existen en la base.");
  }

  // Idempotencia: si este mensaje ya fue analizado (reintento, doble encolado), no repetir
  const yaAnalizado = await prisma.sentimentAnalysis.findFirst({ where: { messageId } });
  if (yaAnalizado) {
    return { omitido: true, motivo: "mensaje ya analizado" };
  }

  // El webhook guarda las respuestas no textuales como "[mensaje de tipo audio]" etc.
  // En esos casos no se llama a la IA: va directo a revisión manual.
  const esNoTextual = /^\[mensaje de tipo .+\]$/.test(mensaje.content.trim());
  if (esNoTextual) {
    await prisma.sentimentAnalysis.create({
      data: {
        casoId,
        messageId,
        semaforo: null,
        confianza: 0,
        resumenIA: "Respuesta no textual, requiere revisión manual",
        respuestaCrudaIA: { motivo: "no-textual", contenido: mensaje.content } as Prisma.InputJsonValue,
        requiereRQR: false,
        requiereRevisionManual: true,
      },
    });
    console.log(`[analisis-sentimiento] caso ${caso.numeroOrden}: respuesta no textual, marcada para revisión manual`);
    // Edge: respuesta no textual → igual se programa el agradecimiento (variante VERDE/AMARILLO)
    await programarAgradecimiento(casoId);
    return { revisionManual: true };
  }

  let resultado;
  try {
    resultado = await analizarRespuesta(mensaje.content, {
      nombreCliente: caso.nombrePropietario,
      modelo: caso.modelo,
      asesor: caso.asesor,
      fechaServicio: formatearFecha(caso.fechaSalida),
      comentarioAsesor: caso.comentarioAsesor,
    });
  } catch (err) {
    if (esErrorReintenable(err)) {
      throw err; // BullMQ reintenta con backoff
    }
    throw new UnrecoverableError(
      `Error definitivo llamando a la IA: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const analisis = await prisma.sentimentAnalysis.create({
    data: {
      casoId,
      messageId,
      semaforo: resultado.semaforo,
      severidad: resultado.severidad,
      confianza: resultado.confianza,
      categoriaCausaRaiz: resultado.categoriaCausaRaiz,
      resumenIA: resultado.resumen,
      respuestaCrudaIA: (resultado.respuestaCruda ?? {}) as Prisma.InputJsonValue,
      requiereRQR: resultado.requiereRQR,
      requiereRevisionManual: resultado.requiereRevisionManual,
    },
  });

  let numeroRQR: string | null = null;
  if (resultado.requiereRQR) {
    const { rqr, accion } = await crearRqrAutomatico({ caso, analisis, textoCliente: mensaje.content });
    numeroRQR = rqr.numeroRQR;
    console.log(
      accion === "creado"
        ? `[analisis-sentimiento] caso ${caso.numeroOrden}: semáforo ${resultado.semaforo} → se abrió automáticamente el ${numeroRQR}`
        : `[analisis-sentimiento] caso ${caso.numeroOrden}: ya tenía un RQR abierto (${numeroRQR}) → se agregó la nueva respuesta a su bitácora`
    );
  } else {
    console.log(
      `[analisis-sentimiento] caso ${caso.numeroOrden}: semáforo ${resultado.semaforo ?? "SIN CLASIFICAR"} (confianza ${resultado.confianza})`
    );
  }

  // Parte A: programar el agradecimiento (respeta opt-out, una-sola-vez, etc.)
  await programarAgradecimiento(casoId);

  return { semaforo: resultado.semaforo, requiereRQR: resultado.requiereRQR, numeroRQR };
}

// ---------- Worker de agradecimiento (Parte A) ----------

interface DatosAgradecimiento {
  casoId: string;
}

async function procesarAgradecimiento(job: Job<DatosAgradecimiento>) {
  const { casoId } = job.data;
  const caso = await prisma.caso.findUnique({ where: { id: casoId } });
  if (!caso || caso.eliminadoEn) return { omitido: "caso inexistente o eliminado" };
  if (caso.agradecimientoEnviadoEn) return { omitido: "ya se envió" }; // una sola vez
  if (caso.whatsappOptOut) return { omitido: "opt-out" }; // el opt-out gana

  // Semáforo del último análisis (null = no textual / sin clasificar → variante VERDE/AMARILLO)
  const analisis = await prisma.sentimentAnalysis.findFirst({
    where: { casoId },
    orderBy: { analyzedAt: "desc" },
    select: { semaforo: true },
  });
  const semaforo = analisis?.semaforo ?? null;
  const config = await obtenerConfiguracion();

  let plantilla: string;
  if (semaforo === Semaforo.ROJO) {
    // A los rojos: variante empática SIN recordatorio de encuesta, o ningún mensaje (toggle)
    if (config[CLAVES_CONFIG.AGRADECIMIENTO_ENVIAR_A_ROJOS] !== "true") {
      return { omitido: "rojo, config indica no enviar mensaje automático" };
    }
    plantilla = config[CLAVES_CONFIG.AGRADECIMIENTO_ROJO];
  } else {
    plantilla = config[CLAVES_CONFIG.AGRADECIMIENTO_VERDE_AMARILLO];
  }

  const mensaje = reemplazarPlaceholders(plantilla, caso);
  const telefono = caso.whatsapp?.trim() || caso.celular?.trim() || "";
  if (!telefono.startsWith("+")) {
    throw new UnrecoverableError("El caso no tiene teléfono válido para el agradecimiento.");
  }

  // Texto libre dentro de la ventana de 24hs (el cliente recién escribió). En
  // MODO_DEMO el envío se simula (sendTextMessage → mock). NUNCA se usa template
  // como fallback: si la ventana está cerrada, se marca fallido y no se reintenta.
  let waMessageId: string;
  try {
    ({ waMessageId } = await sendTextMessage(telefono, mensaje));
  } catch (err) {
    if (err instanceof WhatsappApiError && !err.reintenable) {
      console.error(
        `[agradecimiento] fallo definitivo para caso ${caso.numeroOrden} (ej. ventana de 24hs cerrada): ${err.message}`
      );
      throw new UnrecoverableError(err.message);
    }
    throw err; // rate limit / 5xx / timeout → BullMQ reintenta con backoff
  }

  await prisma.$transaction([
    prisma.whatsappMessage.create({
      data: {
        casoId: caso.id,
        direction: MessageDirection.SALIENTE,
        content: mensaje,
        waMessageId,
        status: "enviado",
        esAgradecimiento: true, // lo distingue del template inicial
      },
    }),
    prisma.caso.update({
      where: { id: caso.id },
      data: { agradecimientoEnviadoEn: new Date() },
    }),
  ]);

  console.log(`[agradecimiento] enviado a caso ${caso.numeroOrden} (semáforo ${semaforo ?? "s/c"})`);
  return { enviado: true, semaforo };
}

// ---------- Arranque de todos los workers ----------

export function startWorkers() {
  const whatsappWorker = new Worker<DatosEnvio>(QUEUE_NAMES.WHATSAPP_ENVIO, procesarEnvioWhatsapp, {
    connection: redisConnection,
    concurrency: 1, // los mensajes salen de a uno, ya espaciados por el delay del encolado
  });

  // Marca ERROR cuando el job falla definitivamente (sin reintentos pendientes)
  whatsappWorker.on("failed", async (job, err) => {
    if (!job?.data?.casoId) return;
    if (err instanceof DelayedError) return; // re-agendado por ventana/tope, no es un fallo
    const sinReintentosPendientes =
      err instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
    if (!sinReintentosPendientes) {
      console.warn(
        `[whatsapp-envio] intento ${job.attemptsMade} falló para caso ${job.data.casoId}, se reintenta: ${err.message}`
      );
      return;
    }
    console.error(
      `[whatsapp-envio] envío definitivamente fallido para caso ${job.data.casoId}: ${err.message}`
    );
    try {
      await prisma.caso.update({
        where: { id: job.data.casoId },
        data: {
          estadoContacto: EstadoContacto.ERROR,
          ultimoErrorEnvio: err.message.slice(0, 500),
        },
      });
    } catch (updateErr) {
      console.error(`[whatsapp-envio] no se pudo marcar ERROR el caso ${job.data.casoId}:`, updateErr);
    }
  });

  const analisisWorker = new Worker<DatosAnalisis>(
    QUEUE_NAMES.ANALISIS_SENTIMIENTO,
    procesarAnalisisSentimiento,
    {
      connection: redisConnection,
      concurrency: 2,
      // Rate limiter nativo: no más de N análisis por minuto (RPM del free tier
      // de Gemini). Los que exceden ESPERAN en cola, no fallan.
      limiter: { max: env.analisisMaxPorMinuto, duration: 60_000 },
      // Backoff por tipo de error: el 429 de cuota espera 60-90s (reintentar
      // rápido no reabre la ventana); el resto, exponencial arrancando en 10s.
      settings: {
        backoffStrategy: (attemptsMade: number, _type?: string, err?: Error) => {
          if (err && esErrorCuota(err)) return 60_000 + Math.floor(Math.random() * 30_000);
          return Math.min(60_000, 10_000 * 2 ** Math.max(0, attemptsMade - 1));
        },
      },
    }
  );

  const agradecimientoWorker = new Worker<DatosAgradecimiento>(
    QUEUE_NAMES.AGRADECIMIENTO,
    procesarAgradecimiento,
    { connection: redisConnection, concurrency: 2 }
  );

  const excelWorker = new Worker(
    QUEUE_NAMES.PROCESAR_EXCEL,
    async (job) => {
      console.log(`[procesar-excel] job ${job.id} recibido`, job.data);
    },
    { connection: redisConnection }
  );

  const mantenimientoWorker = new Worker(
    QUEUE_NAMES.MANTENIMIENTO,
    async () => {
      const marcados = await marcarNoRespondidos();
      console.log(
        `[mantenimiento] ${marcados} caso(s) ENVIADO sin respuesta hace más de ${env.diasSinRespuestaParaNC} días pasaron a NO_RESPONDIO`
      );
      return { marcados };
    },
    { connection: redisConnection }
  );

  for (const worker of [analisisWorker, agradecimientoWorker, excelWorker, mantenimientoWorker]) {
    worker.on("failed", (job, err) => {
      console.error(`[${worker.name}] job ${job?.id} falló:`, err.message);
    });
  }

  console.log("Workers de BullMQ iniciados");
  return [whatsappWorker, analisisWorker, agradecimientoWorker, excelWorker, mantenimientoWorker];
}
