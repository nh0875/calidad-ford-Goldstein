// ---------------------------------------------------------------------------
// El circuito de insistencia (Volkswagen)
// ---------------------------------------------------------------------------
//
// Hasta ahora un cliente que no contestaba el primer WhatsApp se quedaba en
// ENVIADO hasta que la barrida diaria lo daba por NO_RESPONDIO, y ahí terminaba
// todo. Se perdía gente que simplemente no vio el mensaje.
//
// Ahora se insiste, en dos escalones:
//
//   1. A las 24 h sin respuesta sale la plantilla "segundo_contacto".
//   2. A las 24 h de ESA, si sigue sin contestar, el caso pasa a
//      LLAMADA_PENDIENTE y lo llama Calidad por teléfono.
//
// LAS DOS COSAS QUE NO PUEDEN FALLAR:
//
//   - Que al cliente le llegue el WhatsApp DOS VECES. Le llega a una persona
//     real y no hay forma de deshacerlo. Por eso hay tres candados: acá se
//     buscan solo los casos con segundoContactoEn en null, el encolado usa un
//     jobId derivado del caso (BullMQ descarta el duplicado), y el worker vuelve
//     a mirar la base justo antes de mandar.
//   - Que un caso quede esperando para siempre. Por eso el escalón 2 no depende
//     de que el 1 haya salido bien: mira la fecha del segundo contacto, y si
//     nunca salió, el caso sigue en la primera barrida hasta que salga.
//
// Todo esto corre SOLO si marca.segundoContacto está prendido (Volkswagen). En
// Ford las dos funciones devuelven cero sin tocar nada.

import { EstadoContacto, MessageDirection } from "@prisma/client";
import { marca } from "../config/marca";
import { prisma } from "../config/prisma";
import { whatsappQueue } from "../jobs/queues";
import { env } from "../config/env";

/** Horas sin respuesta antes de insistir con el segundo WhatsApp. */
export const HORAS_PARA_SEGUNDO_CONTACTO = 24;
/** Horas después del segundo WhatsApp antes de mandarlo a llamar. */
export const HORAS_PARA_LLAMADA = 24;

/**
 * Cuántos casos toma cada barrida.
 *
 * Hay un tope a propósito. La primera vez que esto corra puede encontrarse con
 * meses de casos viejos acumulados en ENVIADO, y sin límite les mandaría un
 * WhatsApp a todos de una. Con el tope, la ventana de envío y el cupo diario, la
 * cola gotea: salen los más viejos primero y el resto espera a la hora siguiente.
 */
const MAX_POR_BARRIDA = 100;

function haceHoras(horas: number): Date {
  return new Date(Date.now() - horas * 60 * 60 * 1000);
}

/**
 * El jobId que identifica al segundo contacto de un caso.
 *
 * Es DETERMINÍSTICO por caso: si la barrida corre dos veces seguidas (o dos
 * procesos la corren a la vez), BullMQ descarta el segundo add en vez de encolar
 * dos envíos. Es el candado más barato contra el mensaje duplicado.
 *
 * EL PRECIO DE ESE CANDADO: BullMQ descarta un add cuyo jobId ya existe, sin
 * avisar y sin error, y los envíos fallidos se conservan a propósito
 * (removeOnFail: false). O sea que un caso cuyo segundo contacto falló una vez
 * queda con ese job en Redis para siempre, y todas las barridas siguientes lo
 * saltean calladas. Por eso la barrida ahora mira si ya hay un job y lo informa
 * (ver encolarSegundosContactos) en vez de dar por hecho que encoló.
 *
 * Se exporta para que el diagnóstico pueda mirar el mismo job desde afuera.
 */
export function jobIdSegundoContacto(casoId: string): string {
  return `segundo-contacto:${casoId}`;
}

export interface ResultadoBarrida {
  encolados: number;
  /** Casos que cumplían el tiempo pero no se pudieron encolar. */
  omitidos: number;
  /**
   * Casos que cumplían el tiempo pero YA tenían un envío en Redis (normalmente
   * uno que falló y quedó guardado). No se encolan de nuevo —el candado contra
   * el mensaje duplicado está antes que la comodidad— pero se cuentan, porque si
   * no un caso se queda esperando para siempre sin que nada lo diga.
   */
  yaEnCola: number;
}

/**
 * Escalón 1: encola el segundo contacto para los casos que hace 24 h que no
 * contestan.
 *
 * NO manda nada por su cuenta: encola en la cola de WhatsApp de siempre, que ya
 * sabe respetar la ventana de 09:00 a 19:00, el cupo diario, el opt-out y la
 * lista de supresión. Si las 24 h se cumplen a la madrugada, el job queda
 * esperando y sale solo cuando abre la ventana; no hay que hacer nada especial.
 */
export async function encolarSegundosContactos(): Promise<ResultadoBarrida> {
  if (!marca.segundoContacto) return { encolados: 0, omitidos: 0, yaEnCola: 0 };

  const corte = haceHoras(HORAS_PARA_SEGUNDO_CONTACTO);

  const candidatos = await prisma.caso.findMany({
    where: {
      estadoContacto: EstadoContacto.ENVIADO,
      // Todavía no se le insistió.
      segundoContactoEn: null,
      // Nadie pidió la baja.
      whatsappOptOut: false,
      // Y no contestó NADA desde que se le escribió. Se mira si hay algún
      // mensaje ENTRANTE, y no el estado: un caso puede seguir en ENVIADO por un
      // rato aunque el cliente ya haya escrito, y volver a escribirle a alguien
      // que acaba de contestar es de las cosas que más molestan.
      mensajes: { none: { direction: MessageDirection.ENTRANTE } },
      // El primer contacto salió hace 24 h o más. Se cuenta desde el mensaje
      // SALIENTE más viejo del caso y no desde createdAt: un caso puede estar
      // cargado hace una semana y haberse contactado recién ayer.
      AND: [{ mensajes: { some: { direction: MessageDirection.SALIENTE, createdAt: { lte: corte } } } }],
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: MAX_POR_BARRIDA,
  });

  let encolados = 0;
  let omitidos = 0;
  let yaEnCola = 0;
  for (const caso of candidatos) {
    try {
      // ¿Ya hay algo en Redis para este caso? Un add con un jobId existente se
      // descarta sin error, así que sin esto la barrida contaría como encolado
      // algo que nunca va a salir.
      const previo = await whatsappQueue.getJob(jobIdSegundoContacto(caso.id));
      if (previo) {
        const estado = await previo.getState().catch(() => "desconocido");
        yaEnCola++;
        console.warn(
          `[segundo-contacto] el caso ${caso.id} ya tiene un envío en Redis (${estado}): no se vuelve a encolar.` +
            (previo.failedReason ? ` Falló con: ${previo.failedReason.slice(0, 200)}` : "")
        );
        continue;
      }

      await whatsappQueue.add(
        "segundo-contacto",
        { casoId: caso.id, plantilla: "segundo_contacto" as const },
        {
          jobId: jobIdSegundoContacto(caso.id),
          // El mismo espaciado que usa el envío normal: Meta no quiere ráfagas.
          delay: encolados * env.whatsappEnvioDelayMs,
          attempts: 3,
          backoff: { type: "exponential", delay: 10_000 },
          removeOnComplete: true,
          // El fallido se conserva: si un envío no salió, hay que poder verlo.
          removeOnFail: false,
        }
      );
      encolados++;
    } catch (err) {
      omitidos++;
      console.error(`[segundo-contacto] no se pudo encolar el caso ${caso.id}:`, err);
    }
  }

  return { encolados, omitidos, yaEnCola };
}

/**
 * Escalón 2: los que tampoco contestaron el segundo contacto pasan a
 * LLAMADA_PENDIENTE.
 *
 * Se apoya en segundoContactoEn, que lo escribe el worker DESPUÉS de que el
 * mensaje salió de verdad. Así un caso al que el segundo WhatsApp nunca le llegó
 * (número inválido, error de Meta) no pasa a "hay que llamarlo" por un mensaje
 * que nunca existió: se queda en la barrida anterior hasta que salga o hasta que
 * el envío falle definitivamente y el caso quede en ERROR.
 */
export async function marcarLlamadasPendientes(): Promise<number> {
  if (!marca.segundoContacto) return 0;

  const corte = haceHoras(HORAS_PARA_LLAMADA);

  const { count } = await prisma.caso.updateMany({
    where: {
      estadoContacto: EstadoContacto.ENVIADO,
      segundoContactoEn: { lte: corte },
      // Sigue sin contestar nada.
      mensajes: { none: { direction: MessageDirection.ENTRANTE } },
    },
    data: { estadoContacto: EstadoContacto.LLAMADA_PENDIENTE },
  });

  return count;
}

/**
 * El envío a mano, desde el botón de la pantalla del caso.
 *
 * Devuelve un motivo en vez de tirar una excepción cuando no corresponde: la
 * pantalla necesita explicarle a la persona POR QUÉ no se mandó, y "ya se le
 * mandó" o "el cliente ya contestó" no son errores, son respuestas.
 */
export async function encolarSegundoContactoManual(
  casoId: string
): Promise<{ encolado: boolean; motivo?: string }> {
  if (!marca.segundoContacto) {
    return { encolado: false, motivo: `El segundo contacto no está habilitado en ${marca.nombre}.` };
  }

  const caso = await prisma.caso.findUnique({
    where: { id: casoId },
    select: {
      id: true,
      estadoContacto: true,
      segundoContactoEn: true,
      whatsappOptOut: true,
      mensajes: { where: { direction: MessageDirection.ENTRANTE }, select: { id: true }, take: 1 },
    },
  });
  if (!caso) return { encolado: false, motivo: "No se encontró el caso." };

  if (caso.segundoContactoEn) {
    return { encolado: false, motivo: "A este cliente ya se le mandó el segundo contacto." };
  }
  if (caso.whatsappOptOut) {
    return { encolado: false, motivo: "El cliente pidió no recibir más mensajes." };
  }
  if (caso.mensajes.length > 0) {
    return { encolado: false, motivo: "El cliente ya respondió: no hace falta insistir." };
  }
  if (caso.estadoContacto !== EstadoContacto.ENVIADO) {
    return {
      encolado: false,
      motivo: `El segundo contacto solo se manda a casos ya contactados y sin respuesta (este está en ${caso.estadoContacto}).`,
    };
  }

  await whatsappQueue.add(
    "segundo-contacto",
    { casoId: caso.id, plantilla: "segundo_contacto" as const },
    {
      jobId: jobIdSegundoContacto(caso.id),
      attempts: 3,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: true,
      removeOnFail: false,
    }
  );

  return { encolado: true };
}
