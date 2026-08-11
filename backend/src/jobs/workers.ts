import { EstadoContacto, EstadoFidelizacion, MessageDirection, Prisma, Semaforo, TipoAviso } from "@prisma/client";
import { DelayedError, Job, UnrecoverableError, Worker } from "bullmq";
import { env } from "../config/env";
import { cupoDisponibleHoy, dentroDeVentana, msHastaProximaApertura } from "../services/ventana-envio.service";
import { prisma } from "../config/prisma";
import { redisConnection } from "../config/redis";
import { marcarNoRespondidos } from "../services/mantenimiento.service";
import { crearRqrAutomatico } from "../services/rqr.service";
import { analizarRespuesta, esErrorCuota, esErrorReintenable, transcribirAudio } from "../services/sentiment.service";
import { WhatsappApiError, descargarMedia, sendTemplateMessage, sendTextMessage } from "../services/whatsapp.service";
import { programarAgradecimiento, reemplazarPlaceholders } from "../services/agradecimiento.service";
import {
  analisisPrincipal,
  consolidarTexto,
  esSoloCortesia,
  esSoloEmoji,
  mensajesSinAnalizar,
  programarAnalisis,
  rangoSemaforo,
  sentimientoSoloEmoji,
} from "../services/analisis.service";
import { crearAviso } from "../services/aviso.service";
import { etiquetaFidelizacion } from "../services/fidelizacion.service";
import { estaSuprimido, telefonosSuprimidos } from "../services/supresion.service";
import {
  CLAVES_CONFIG,
  obtenerConfiguracion,
  obtenerCredencialesMeta,
  plantillaContactoPara,
} from "../services/configuracion.service";
import { QUEUE_NAMES } from "./queues";

// ---------- Worker de envío de WhatsApp ----------

interface DatosEnvio {
  casoId: string;
  // "contacto" (default): plantilla de contacto del área, SOLO casos PENDIENTE.
  // "respuesta_no_recibida": pedir que el cliente repita su mensaje (envío
  // masivo de recuperación), a clientes ya contactados en CUALQUIER estado.
  plantilla?: "contacto" | "respuesta_no_recibida";
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

  const esRecuperacion = job.data.plantilla === "respuesta_no_recibida";

  // Idempotencia de la campaña de CONTACTO: solo se envía a PENDIENTE (si cambió
  // entre el encolado y ahora —respondió, otro envío, interno— no se manda). La
  // RECUPERACIÓN ("pedir que repitan") NO exige PENDIENTE: va a clientes ya
  // contactados en cualquier estado.
  if (!esRecuperacion && caso.estadoContacto !== EstadoContacto.PENDIENTE) {
    return { omitido: true, motivo: `estado ${caso.estadoContacto}` };
  }

  // Revalidar consentimiento AL MOMENTO DE ENVIAR (no solo al encolar): con el
  // goteo por tope/ventana un job puede quedar demorado horas o días, y en ese
  // lapso el cliente puede haber pedido la baja (opt-out) o el teléfono puede
  // haber entrado a la lista de supresión. No se le manda nada.
  if (caso.whatsappOptOut) {
    return { omitido: true, motivo: "opt-out" };
  }
  if (estaSuprimido(caso.telefonosNorm, await telefonosSuprimidos())) {
    return { omitido: true, motivo: "teléfono suprimido" };
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

  // Variables del template, en el orden de los placeholders {{1}}, {{2}}, ...
  //
  // La plantilla aprobada hoy en Meta ("contacto_posventa", idioma "es") tiene
  // el TEXTO FIJO, sin placeholders: por eso va vacío. La cantidad debe coincidir
  // EXACTAMENTE con la aprobada; mandar de más hace fallar todo envío (error
  // 132000 de Meta). Si algún día se aprueba una plantilla con variables,
  // agregarlas acá en el mismo orden, por ejemplo:
  //   [caso.nombrePropietario || "cliente", caso.modelo || "su vehículo", formatearFecha(caso.fechaSalida)]
  const variables: string[] = [];

  // Plantilla: la de CONTACTO según el área del caso (Posventa/Ventas), o la de
  // "no nos llegó tu mensaje" (recuperación). Ambas de texto fijo, sin variables.
  let plantillaMeta: { name?: string; lang?: string };
  if (esRecuperacion) {
    const creds = await obtenerCredencialesMeta();
    plantillaMeta = { name: creds.respuestaNoRecibidaName, lang: creds.respuestaNoRecibidaLang };
  } else {
    plantillaMeta = await plantillaContactoPara(caso.area);
  }

  let waMessageId: string;
  let templateName: string;
  try {
    ({ waMessageId, templateName } = await sendTemplateMessage(telefono, variables, plantillaMeta));
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
          content: esRecuperacion
            ? `Plantilla "${templateName}" (pedir que repita el mensaje)`
            : `Template "${templateName}" → ${variables.join(" | ")}`,
          templateName,
          waMessageId,
          status: "enviado",
        },
      }),
      // La recuperación NO cambia el estado del caso (solo registra el mensaje,
      // que aparece en Seguimiento). La campaña de contacto sí lo pasa a ENVIADO.
      ...(esRecuperacion
        ? []
        : [
            prisma.caso.update({
              where: { id: caso.id },
              data: { estadoContacto: EstadoContacto.ENVIADO, ultimoErrorEnvio: null },
            }),
          ]),
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
  // Compat: los jobs viejos encolados antes del cambio traían messageId. Ya no
  // se usa (se analiza la tanda completa del caso), pero se acepta para que un
  // job que quedó en Redis durante el despliegue no muera con error.
  messageId?: string;
}

/** Marca la tanda como cubierta, para que la próxima corrida no la vuelva a analizar. */
async function marcarAnalizados(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.whatsappMessage.updateMany({
    where: { id: { in: ids } },
    data: { analizadoEn: new Date() },
  });
}

async function procesarAnalisisSentimiento(job: Job<DatosAnalisis>) {
  const { casoId } = job.data;

  const caso = await prisma.caso.findUnique({ where: { id: casoId } });
  if (!caso) {
    throw new UnrecoverableError("El caso ya no existe en la base.");
  }

  // Se analiza TODA la tanda pendiente del cliente, no un mensaje suelto: el
  // job se fue reprogramando con cada mensaje nuevo, así que acá ya está la
  // respuesta completa. Ver analisis.service.ts para el porqué.
  const mensajes = await mensajesSinAnalizar(casoId);
  if (mensajes.length === 0) {
    return { omitido: true, motivo: "no hay mensajes nuevos para analizar" };
  }
  const idsTanda = mensajes.map((m) => m.id);
  const ultimoId = idsTanda[idsTanda.length - 1];

  // AUDIOS (notas de voz): se bajan de Meta y Gemini los transcribe, para
  // clasificarlos como cualquier respuesta de texto. La transcripción reemplaza
  // el placeholder "[audio]" (en la base y en memoria) y sigue el flujo normal.
  // Si falla definitivamente (sin key de Gemini, media vencida, etc.), se deja
  // "[audio]" y el caso cae a revisión manual: nunca se pierde el mensaje.
  for (const m of mensajes) {
    if (m.mediaTipo === "audio" && m.mediaId && m.content === "[audio]") {
      try {
        const { bytes, mimeType } = await descargarMedia(m.mediaId);
        const transcripcion = (await transcribirAudio(bytes, mimeType)).trim();
        const contenido =
          transcripcion && transcripcion.toLowerCase() !== "(sin audio reconocible)"
            ? transcripcion
            : "[audio sin voz reconocible]";
        await prisma.whatsappMessage.update({ where: { id: m.id }, data: { content: contenido } });
        m.content = contenido;
        console.log(`[analisis-sentimiento] caso ${caso.numeroOrden}: audio transcripto (${contenido.length} chars)`);
      } catch (err) {
        // Transitorio (rate limit / red / 5xx de Meta o Gemini) → BullMQ reintenta.
        const reintentar = (err instanceof WhatsappApiError && err.reintenable) || esErrorReintenable(err);
        if (reintentar) throw err;
        console.warn(
          `[analisis-sentimiento] caso ${caso.numeroOrden}: no se pudo transcribir el audio, va a revisión manual: ${err instanceof Error ? err.message : String(err)}`
        );
        // Fallo definitivo: se deja "[audio]" → cae a revisión manual (esNoTextual)
      }
    }
  }

  const texto = consolidarTexto(mensajes);

  // ¿Es la primera vez que clasificamos este caso, o el cliente siguió
  // escribiendo después? Un seguimiento no suma a las estadísticas: solo puede
  // ESCALAR el caso si lo que dice es peor que lo que ya sabíamos.
  const principalPrevio = await analisisPrincipal(casoId);
  const esSeguimiento = principalPrevio !== null;

  // Cortesía posterior ("gracias", "ok", "👍"): se registra el mensaje pero no
  // se gasta una llamada a la IA ni se ensucian los números. Solo aplica a los
  // seguimientos: una primera respuesta corta sí hay que mirarla.
  // OJO: se evalúa mensaje por mensaje sobre el texto ORIGINAL, no sobre el
  // consolidado: cuando son varios, consolidarTexto() los numera ("(1) gracias")
  // y eso no matchearía nunca contra la lista de cortesías.
  if (esSeguimiento && mensajes.every((m) => esSoloCortesia(m.content))) {
    await marcarAnalizados(idsTanda);
    console.log(
      `[analisis-sentimiento] caso ${caso.numeroOrden}: ${mensajes.length} mensaje(s) de cortesía posteriores, no se analizan`
    );
    return { omitido: true, motivo: "cortesía posterior" };
  }

  // Respuestas de SOLO emojis (típicamente una reacción 👍 a nuestro mensaje):
  // se clasifican sin IA. Un pulgar arriba es VERDE; un emoji ambiguo/negativo
  // (👎, 😮) es demasiado poco para clasificar solo y va a revisión manual.
  const contenidos = mensajes.map((m) => m.content);
  const soloEmoji = contenidos.every((c) => esSoloEmoji(c));
  const semaforoEmoji = soloEmoji ? sentimientoSoloEmoji(contenidos) : null;

  // No textual = lo que no se pudo convertir a texto: media sin soportar
  // ("[mensaje de tipo image]"), o un audio que no se pudo transcribir ("[audio]"
  // / "[audio sin voz reconocible]"). Va a revisión manual.
  const esNoTextual = /^\[(mensaje de tipo .+|audio.*)\]$/.test(texto.trim());
  // Emoji-solo que no se pudo clasificar de forma clara (negativo o ambiguo).
  const emojiSinClasificar = soloEmoji && semaforoEmoji === null;

  if (esNoTextual || emojiSinClasificar) {
    const motivo = esNoTextual ? "no-textual" : "reaccion-ambigua";
    await prisma.sentimentAnalysis.create({
      data: {
        casoId,
        messageId: ultimoId,
        semaforo: null,
        confianza: 0,
        resumenIA: esNoTextual
          ? "Respuesta no textual, requiere revisión manual"
          : `El cliente reaccionó con ${texto.trim()} (sin sentimiento claro), requiere revisión manual`,
        respuestaCrudaIA: { motivo, contenido: texto } as Prisma.InputJsonValue,
        requiereRQR: false,
        requiereRevisionManual: true,
        esSeguimiento, // un audio/emoji posterior no pisa la clasificación que ya tenía el caso
        mensajesAnalizados: mensajes.length,
      },
    });
    await marcarAnalizados(idsTanda);
    console.log(`[analisis-sentimiento] caso ${caso.numeroOrden}: ${motivo}, marcada para revisión manual`);
    // Cartel de aviso: alguien tiene que mirar esta respuesta a mano antes de las 24 hs.
    await crearAviso({
      tipo: TipoAviso.REVISION_MANUAL,
      area: caso.area,
      casoId: caso.id,
      titulo: `${caso.nombrePropietario}: respuesta para clasificar a mano`,
      detalle:
        `El cliente respondió algo que la IA no pudo clasificar (${esNoTextual ? "audio/imagen que no se pudo leer" : "reacción ambigua"}). ` +
        `Miralo en Seguimiento antes de que pasen 24 hs.`,
    });
    // Edge: respuesta no clasificable → igual se programa el agradecimiento (variante VERDE/AMARILLO)
    await programarAgradecimiento(casoId);
    return { revisionManual: true };
  }

  let resultado;
  if (semaforoEmoji === Semaforo.VERDE) {
    // Reacción positiva (👍, ❤️, 🙏…): VERDE determinista, sin gastar una llamada
    // a la IA ni abrir ningún RQR. Se arma un resultado con la misma forma que
    // el de la IA para que el resto del flujo (escalada, agradecimiento) lo trate igual.
    resultado = {
      semaforo: Semaforo.VERDE,
      severidad: null,
      confianza: 1,
      categoriaCausaRaiz: null,
      resumen: `El cliente reaccionó de forma positiva (${texto.trim()}).`,
      respuestaCruda: { motivo: "reaccion-emoji-positiva", contenido: texto },
      requiereRQR: false,
      requiereRevisionManual: false,
    };
    console.log(`[analisis-sentimiento] caso ${caso.numeroOrden}: reacción positiva ${texto.trim()} → VERDE (sin IA)`);
  } else {
    try {
      resultado = await analizarRespuesta(texto, {
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
  }

  // Escalada: un seguimiento reemplaza a la clasificación vigente SOLO si es
  // peor (el cliente dijo que estaba todo bien y después se quejó). Al revés no:
  // un "gracias igual" después de una queja no borra la queja.
  // Escalada REAL: el análisis principal previo YA estaba clasificado (semáforo
  // no nulo) y ahora es peor. Si el previo estaba sin clasificar (null), esta es
  // la primera clasificación de verdad: pasa a principal pero NO es "empeoró".
  const previoClasificado = principalPrevio?.semaforo != null;
  const escala =
    esSeguimiento && previoClasificado && rangoSemaforo(resultado.semaforo) > rangoSemaforo(principalPrevio!.semaforo);
  // Si el previo no estaba clasificado y este sí, igual debe pasar a ser el
  // principal (que la clasificación real cuente en reportes).
  const reemplazaPrincipalSinClasificar =
    esSeguimiento && !previoClasificado && resultado.semaforo != null;
  // Este análisis pasa a ser el principal si escaló o si reemplaza a uno sin clasificar.
  const pasaAPrincipal = escala || reemplazaPrincipalSinClasificar;
  const quedaComoSeguimiento = esSeguimiento && !pasaAPrincipal;

  const analisis = await prisma.sentimentAnalysis.create({
    data: {
      casoId,
      messageId: ultimoId,
      semaforo: resultado.semaforo,
      severidad: resultado.severidad,
      confianza: resultado.confianza,
      categoriaCausaRaiz: resultado.categoriaCausaRaiz,
      resumenIA: resultado.resumen,
      respuestaCrudaIA: (resultado.respuestaCruda ?? {}) as Prisma.InputJsonValue,
      requiereRQR: resultado.requiereRQR,
      requiereRevisionManual: resultado.requiereRevisionManual,
      esSeguimiento: quedaComoSeguimiento,
      mensajesAnalizados: mensajes.length,
    },
  });
  await marcarAnalizados(idsTanda);

  // La IA a veces clasifica PERO pide confirmación humana (baja confianza / caso
  // borroso): también va al cartel de avisos, salvo que sea un seguimiento menor.
  if (resultado.requiereRevisionManual && !quedaComoSeguimiento) {
    await crearAviso({
      tipo: TipoAviso.REVISION_MANUAL,
      area: caso.area,
      casoId: caso.id,
      titulo: `${caso.nombrePropietario}: respuesta para revisar a mano`,
      detalle: `La IA marcó esta respuesta para que la confirme una persona. Miralo en Seguimiento antes de que pasen 24 hs.`,
    });
  }

  // Invariante: un solo análisis principal por caso. Si este pasa a principal
  // (escaló o reemplaza a uno sin clasificar), el anterior pasa a seguimiento.
  if (pasaAPrincipal) {
    await prisma.sentimentAnalysis.update({
      where: { id: principalPrevio!.id },
      data: { esSeguimiento: true },
    });
  }
  // El aviso "empeoró" SOLO cuando fue una escalada real (previo ya clasificado).
  if (escala) {
    await crearAviso({
      tipo: TipoAviso.ESCALADO,
      area: caso.area,
      casoId: caso.id,
      titulo: `${caso.nombrePropietario} empeoró: ${principalPrevio!.semaforo ?? "sin clasificar"} → ${resultado.semaforo ?? "sin clasificar"}`,
      detalle:
        `El cliente ya había respondido y el caso estaba clasificado como ${principalPrevio!.semaforo ?? "sin clasificar"}. ` +
        `Escribió de nuevo y ahora la clasificación es ${resultado.semaforo ?? "sin clasificar"}. ` +
        `Resumen: ${resultado.resumen}`,
    });
    console.log(
      `[analisis-sentimiento] caso ${caso.numeroOrden}: ESCALÓ de ${principalPrevio!.semaforo} a ${resultado.semaforo}`
    );
  }

  let numeroRQR: string | null = null;
  if (resultado.requiereRQR) {
    const { rqr, accion } = await crearRqrAutomatico({ caso, analisis, textoCliente: texto });
    numeroRQR = rqr.numeroRQR;
    console.log(
      accion === "creado"
        ? `[analisis-sentimiento] caso ${caso.numeroOrden}: semáforo ${resultado.semaforo} → se abrió automáticamente el ${numeroRQR}`
        : `[analisis-sentimiento] caso ${caso.numeroOrden}: ya tenía un RQR abierto (${numeroRQR}) → se agregó la nueva respuesta a su bitácora`
    );
    // Cartel rojo en pantalla: alguien tiene que agarrar este RQR.
    await crearAviso({
      tipo: TipoAviso.RQR_ABIERTO,
      area: caso.area,
      casoId: caso.id,
      rqrId: rqr.id,
      titulo:
        accion === "creado"
          ? `${rqr.numeroRQR} — se abrió un RQR de ${caso.nombrePropietario}`
          : `${rqr.numeroRQR} — ${caso.nombrePropietario} volvió a reclamar`,
      detalle: `${resultado.resumen} (asesor: ${caso.asesor}, sucursal: ${caso.sucursal})`,
    });
  } else {
    console.log(
      `[analisis-sentimiento] caso ${caso.numeroOrden}: semáforo ${resultado.semaforo ?? "SIN CLASIFICAR"} (confianza ${resultado.confianza}, ${mensajes.length} mensaje(s))`
    );
    // Amarillo sin RQR: no amerita reclamo formal, pero conviene que alguien lo
    // mire. Solo si es la clasificación que cuenta (no un seguimiento menor).
    if (resultado.semaforo === Semaforo.AMARILLO && !quedaComoSeguimiento) {
      await crearAviso({
        tipo: TipoAviso.AMARILLO_SIN_RQR,
        area: caso.area,
        casoId: caso.id,
        titulo: `${caso.nombrePropietario} quedó en amarillo (sin RQR)`,
        detalle: `${resultado.resumen} (asesor: ${caso.asesor}, sucursal: ${caso.sucursal})`,
      });
    }
  }

  // Parte A: programar el agradecimiento (respeta opt-out, una-sola-vez, etc.)
  await programarAgradecimiento(casoId);

  return {
    semaforo: resultado.semaforo,
    requiereRQR: resultado.requiereRQR,
    numeroRQR,
    mensajesConsolidados: mensajes.length,
    esSeguimiento: quedaComoSeguimiento,
    escalo: escala,
  };
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
  // La supresión global también bloquea el agradecimiento (un teléfono dado de
  // baja no recibe nada, aunque el flag por-caso esté en false por ser un caso nuevo).
  if (estaSuprimido(caso.telefonosNorm, await telefonosSuprimidos())) {
    return { omitido: "teléfono suprimido" };
  }

  // Semáforo del último análisis. AMARILLO y ROJO llevan el mensaje empático (sin
  // encuesta); VERDE y "sin clasificar" (null) llevan el recordatorio de la encuesta.
  const analisis = await prisma.sentimentAnalysis.findFirst({
    where: { casoId },
    orderBy: { analyzedAt: "desc" },
    select: { semaforo: true },
  });
  const semaforo = analisis?.semaforo ?? null;
  const config = await obtenerConfiguracion();

  let plantilla: string;
  if (semaforo === Semaforo.ROJO) {
    // A los ROJOS (detractores): variante empática SIN recordatorio de encuesta, o
    // ningún mensaje si el toggle "enviar a rojos" está en false (para manejarlos a mano).
    if (config[CLAVES_CONFIG.AGRADECIMIENTO_ENVIAR_A_ROJOS] !== "true") {
      return { omitido: "rojo, config indica no enviar mensaje automático" };
    }
    plantilla = config[CLAVES_CONFIG.AGRADECIMIENTO_ROJO];
  } else if (semaforo === Semaforo.AMARILLO) {
    // A los AMARILLOS (neutros): el MISMO mensaje empático que a los rojos, SIN el
    // recordatorio de la encuesta de Ford. Se manda SIEMPRE (el toggle de arriba
    // gobierna solo a los rojos): un cliente neutro no debe recibir el empujón a la
    // encuesta, porque puntuaría flojo.
    plantilla = config[CLAVES_CONFIG.AGRADECIMIENTO_ROJO];
  } else {
    // VERDE (promotor) o sin clasificar: recordatorio de la encuesta oficial de Ford.
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

  // El mensaje YA salió: si la escritura en base falla, NO se debe reintentar
  // el job (el reintento reenviaría el agradecimiento al cliente). Se lanza
  // UnrecoverableError, igual que el worker de template.
  try {
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
  } catch (err) {
    throw new UnrecoverableError(
      `El agradecimiento se envió (id ${waMessageId}) pero no se pudo registrar en la base: ${
        err instanceof Error ? err.message.slice(0, 300) : String(err)
      }`
    );
  }

  console.log(`[agradecimiento] enviado a caso ${caso.numeroOrden} (semáforo ${semaforo ?? "s/c"})`);
  return { enviado: true, semaforo };
}

// ---------- Worker de envío de Fidelización (Parte C) ----------
// Manda UN recordatorio con la plantilla "fidelizacion_posventa". NO clasifica
// la respuesta, NO agenda agradecimiento ni análisis: es solo un recordatorio.

interface DatosFidelizacion {
  clienteId: string;
}

async function procesarEnvioFidelizacion(job: Job<DatosFidelizacion>, token?: string) {
  const cliente = await prisma.clienteFidelizacion.findUnique({ where: { id: job.data.clienteId } });
  if (!cliente) {
    throw new UnrecoverableError("El cliente de fidelización ya no existe en la base.");
  }
  // Lo borraron (lógicamente) entre que se encoló y se procesó: no se le escribe.
  if (cliente.eliminadoEn) {
    return { omitido: "cliente eliminado" };
  }

  // Idempotencia: si ya no está PENDIENTE (ya se envió/omitió), no se reenvía.
  if (cliente.estado !== EstadoFidelizacion.PENDIENTE) {
    return { omitido: true, motivo: `estado ${cliente.estado}` };
  }

  // Teléfono contactable (E.164). Si no hay, se omite (no es un fallo).
  const telefono = cliente.telefonosNorm[0];
  if (!telefono) {
    await prisma.clienteFidelizacion.update({
      where: { id: cliente.id },
      data: { estado: EstadoFidelizacion.OMITIDO, error: "Sin teléfono válido (WhatsApp/celular)." },
    });
    return { omitido: true, motivo: "sin teléfono" };
  }

  // Lista de supresión (incluye a quien pidió la BAJA/STOP): no se lo molesta.
  if (estaSuprimido(cliente.telefonosNorm, await telefonosSuprimidos())) {
    await prisma.clienteFidelizacion.update({
      where: { id: cliente.id },
      data: { estado: EstadoFidelizacion.OMITIDO, error: "El cliente pidió no ser contactado (lista de supresión)." },
    });
    return { omitido: true, motivo: "teléfono suprimido" };
  }

  // Ventana horaria: fuera de hora, se re-agenda (no cuenta como intento ni fallo).
  if (!dentroDeVentana()) {
    await job.moveToDelayed(Date.now() + msHastaProximaApertura(), token);
    throw new DelayedError();
  }

  // Plantilla de fidelización (texto fijo, sin variables — igual que contacto).
  const creds = await obtenerCredencialesMeta();
  let waMessageId: string;
  try {
    ({ waMessageId } = await sendTemplateMessage(telefono, [], {
      name: creds.fidelizacionTemplateName,
      lang: creds.fidelizacionTemplateLang,
    }));
  } catch (err) {
    // Número inválido / plantilla no aprobada / credenciales: no se reintenta.
    if (err instanceof WhatsappApiError && !err.reintenable) {
      throw new UnrecoverableError(err.message);
    }
    // Rate limit, timeout, 5xx: BullMQ reintenta con backoff.
    throw err;
  }

  // El mensaje YA SALIÓ: un fallo de base acá NO debe reintentar el job (mandaría
  // el WhatsApp de nuevo). Se marca ENVIADO y se registra el saliente como
  // WhatsappMessage (para verlo en Seguimiento). Si el registro falla, es
  // irrecuperable (no se reintenta el envío).
  try {
    await prisma.$transaction([
      prisma.clienteFidelizacion.update({
        where: { id: cliente.id },
        data: { estado: EstadoFidelizacion.ENVIADO, waMessageId, enviadoEn: new Date(), error: null },
      }),
      prisma.whatsappMessage.create({
        data: {
          clienteFidelizacionId: cliente.id,
          direction: MessageDirection.SALIENTE,
          content: cliente.numeroServicio
            ? `Recordatorio de ${cliente.numeroServicio}° service de mantenimiento`
            : "Recordatorio de fidelización (cliente 0km)",
          templateName: creds.fidelizacionTemplateName,
          status: "enviado",
          waMessageId,
        },
      }),
    ]);
  } catch (err) {
    throw new UnrecoverableError(
      `El recordatorio se envió pero no se pudo registrar: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  console.log(
    `[fidelizacion-envio] recordatorio (${etiquetaFidelizacion(cliente)}) enviado a ${cliente.nombre} (${telefono})`
  );
  return { enviado: true, waMessageId };
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
    // La recuperación ("pedir que repitan") NO debe marcar ERROR el estado
    // principal del caso (no es su envío de contacto): solo se loguea.
    if (job.data.plantilla === "respuesta_no_recibida") {
      if (err instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1)) {
        console.error(`[whatsapp-recup] recuperación fallida para caso ${job.data.casoId}: ${err.message}`);
      }
      return;
    }
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

  const fidelizacionWorker = new Worker<DatosFidelizacion>(
    QUEUE_NAMES.FIDELIZACION_ENVIO,
    procesarEnvioFidelizacion,
    {
      connection: redisConnection,
      concurrency: 1, // salen de a uno, espaciados por el delay del encolado
    }
  );

  // Marca ERROR cuando el envío del recordatorio falla definitivamente.
  fidelizacionWorker.on("failed", async (job, err) => {
    if (!job?.data?.clienteId) return;
    if (err instanceof DelayedError) return; // re-agendado por ventana, no es fallo
    const sinReintentosPendientes =
      err instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
    if (!sinReintentosPendientes) {
      console.warn(
        `[fidelizacion-envio] intento ${job.attemptsMade} falló para ${job.data.clienteId}, se reintenta: ${err.message}`
      );
      return;
    }
    console.error(`[fidelizacion-envio] envío fallido para ${job.data.clienteId}: ${err.message}`);
    try {
      await prisma.clienteFidelizacion.update({
        where: { id: job.data.clienteId },
        data: { estado: EstadoFidelizacion.ERROR, error: err.message.slice(0, 500) },
      });
    } catch (updateErr) {
      console.error(`[fidelizacion-envio] no se pudo marcar ERROR ${job.data.clienteId}:`, updateErr);
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

  // Race: un mensaje que llega MIENTRAS el análisis está activo no se puede
  // re-encolar (BullMQ deduplica el add por jobId mientras el job está tomado).
  // Al terminar, con el lock ya liberado, se re-chequea: si quedaron mensajes
  // sin analizar, se reprograma. Así ningún mensaje queda sin clasificar.
  analisisWorker.on("completed", async (job) => {
    const casoId = job?.data?.casoId;
    if (!casoId) return;
    try {
      if ((await mensajesSinAnalizar(casoId)).length > 0) await programarAnalisis(casoId);
    } catch (err) {
      console.error(`[analisis-sentimiento] no se pudo reprogramar tras completar el caso ${casoId}:`, err);
    }
  });

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
  return [
    whatsappWorker,
    fidelizacionWorker,
    analisisWorker,
    agradecimientoWorker,
    excelWorker,
    mantenimientoWorker,
  ];
}
