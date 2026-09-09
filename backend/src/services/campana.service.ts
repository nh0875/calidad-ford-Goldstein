import { AreaTrabajo, EstadoContacto, MessageDirection, OrigenAgendamiento, Prisma } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { whatsappQueue } from "../jobs/queues";
import { telefonosSuprimidos } from "./supresion.service";

// Tres envíos distintos salen por acá, y cada uno tiene su propia regla de a
// quién alcanza:
//
//   contacto              -> SOLO casos PENDIENTE. Excluye internos, históricos ya
//                            clasificados, los ya enviados y los fallidos.
//   respuesta_no_recibida -> clientes YA contactados en cualquier estado (salvo
//                            interno) con un teléfono válido: se les pide que
//                            repitan un mensaje que se perdió.
//   segundo_contacto      -> la insistencia: solo ENVIADO, sin respuesta y sin
//                            haber insistido antes. A nadie se le insiste dos veces.

export interface FiltrosCampana {
  uploadId?: string;
  // Búsqueda por número de orden (o "S/N" para los casos sin número).
  busqueda?: string;
  sucursal?: string;
  periodo?: string;
  asesor?: string;
  // Rango por fecha de programación (mismo campo y semántica que el filtro del
  // listado /casos): AAAA-MM-DD. Sirve para reenviar "pedir que repitan" a los
  // clientes de las fechas en las que se perdieron respuestas.
  fechaDesde?: string;
  fechaHasta?: string;
  origenAgendamiento?: OrigenAgendamiento;
  // Área efectiva del usuario que dispara la campaña (la fija el controller a
  // partir de la sesión; el cliente NO la puede setear). Un usuario de VENTAS
  // jamás alcanza casos de POSVENTA, ni siquiera pasando casoIds a mano.
  area?: AreaTrabajo | null;
  casoIds?: string[]; // selección manual desde la tabla (igual se exige PENDIENTE)
  // "contacto" (default): campaña de contacto, SOLO casos PENDIENTE.
  // "respuesta_no_recibida": envío masivo de "pedir que repitan el mensaje", a
  // clientes ya contactados en cualquier estado (para respuestas que se perdieron).
  plantilla?: "contacto" | "respuesta_no_recibida" | "segundo_contacto";
}

export async function construirWhereCampana(filtros: FiltrosCampana): Promise<Prisma.CasoWhereInput> {
  // Lista de supresión por teléfono: se excluye cualquier caso cuyo whatsapp o
  // celular normalizado esté suprimido. Esto aplica SIEMPRE, incluso cuando se
  // pasan casoIds a mano (no se puede saltear pasando IDs en la request).
  const suprimidos = await telefonosSuprimidos();
  const esRecuperacion = filtros.plantilla === "respuesta_no_recibida";
  const esInsistencia = filtros.plantilla === "segundo_contacto";

  return {
    // CONTACTO: solo PENDIENTE (regla de siempre). RECUPERACIÓN ("pedir que
    // repitan"): clientes YA contactados en cualquier estado, salvo INTERNO, y
    // con un teléfono válido (E.164).
    ...(esRecuperacion
      ? {
          estadoContacto: { not: EstadoContacto.INTERNO },
          OR: [{ whatsapp: { startsWith: "+" } }, { celular: { startsWith: "+" } }],
        }
      : esInsistencia
        ? {
            // INSISTENCIA: solo a quien ya recibió el primer WhatsApp y sigue sin
            // contestar. Las tres condiciones son candados distintos y ninguno
            // sobra:
            //   - ENVIADO: no se insiste a quien nunca recibió el primero, ni a
            //     quien ya contestó, ni a los casos internos.
            //   - segundoContactoEn en null: A NADIE SE LE INSISTE DOS VECES. Es
            //     la regla que pidió Calidad y la que más caro sale romper: el
            //     mensaje le llega a una persona real y no hay como deshacerlo.
            //   - sin ningún mensaje ENTRANTE: se mira si el cliente escribió, y
            //     no solo el estado, porque un caso puede seguir en ENVIADO un
            //     rato después de que el cliente contestó. Volver a escribirle a
            //     alguien que acaba de responder es de las cosas que más molestan.
            estadoContacto: EstadoContacto.ENVIADO,
            segundoContactoEn: null,
            mensajes: { none: { direction: MessageDirection.ENTRANTE } },
          }
        : { estadoContacto: EstadoContacto.PENDIENTE }),
    eliminadoEn: null, // un caso borrado no recibe campañas de WhatsApp
    whatsappOptOut: false, // el cliente que pidió la baja (BAJA/STOP) nunca recibe campañas
    ...(suprimidos.size > 0
      ? { NOT: { telefonosNorm: { hasSome: [...suprimidos] } } } // teléfono en la lista de supresión
      : {}),
    ...(filtros.area ? { area: filtros.area } : {}), // restricción por área (aplica aun con casoIds)
    ...(filtros.busqueda ? { numeroOrden: { contains: filtros.busqueda, mode: "insensitive" } } : {}),
    ...(filtros.uploadId ? { uploadId: filtros.uploadId } : {}),
    ...(filtros.sucursal ? { sucursal: { equals: filtros.sucursal, mode: "insensitive" } } : {}),
    ...(filtros.periodo ? { upload: { periodo: filtros.periodo } } : {}),
    ...(filtros.asesor ? { asesor: { contains: filtros.asesor, mode: "insensitive" } } : {}),
    ...(filtros.fechaDesde || filtros.fechaHasta
      ? {
          fechaProgramacion: {
            ...(filtros.fechaDesde ? { gte: new Date(`${filtros.fechaDesde}T00:00:00`) } : {}),
            ...(filtros.fechaHasta ? { lte: new Date(`${filtros.fechaHasta}T23:59:59.999`) } : {}),
          },
        }
      : {}),
    ...(filtros.origenAgendamiento ? { origenAgendamiento: filtros.origenAgendamiento } : {}),
    ...(filtros.casoIds && filtros.casoIds.length > 0 ? { id: { in: filtros.casoIds } } : {}),
  };
}

export async function contarDestinatarios(filtros: FiltrosCampana): Promise<number> {
  return prisma.caso.count({ where: await construirWhereCampana(filtros) });
}

export async function encolarCampana(filtros: FiltrosCampana): Promise<number> {
  const casos = await prisma.caso.findMany({
    where: await construirWhereCampana(filtros),
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  const delayMs = env.whatsappEnvioDelayMs;
  const plantilla = filtros.plantilla ?? "contacto";
  // jobId con prefijo por plantilla: la recuperación NO debe pisar (deduplicar
  // contra) un envío de contacto pendiente del mismo caso, y viceversa.
  // Un prefijo por plantilla: los tres envios del mismo caso son cosas
  // distintas y no se tienen que deduplicar entre si.
  const prefijo =
    plantilla === "respuesta_no_recibida" ? "recup" : plantilla === "segundo_contacto" ? "segundo-contacto" : "envio";

  // El jobId es fijo por caso, y BullMQ conserva los jobs YA TERMINADOS un rato
  // (fallidos, 24 hs). Mientras esa clave siga en Redis, volver a encolar el
  // mismo caso se ignora en silencio: la API contesta "encolado" y no sale
  // nada. Por eso se borran acá los jobs terminados antes de encolar de nuevo.
  // Los que siguen esperando o enviándose NO se tocan: ahí el dedupe es
  // justamente lo que queremos (evita mandar dos veces por doble click).
  await Promise.all(
    casos.map(async (caso) => {
      try {
        const job = await whatsappQueue.getJob(`${prefijo}-${caso.id}`);
        if (!job) return;
        const estado = await job.getState();
        if (estado === "failed" || estado === "completed") await job.remove();
      } catch {
        // si no se puede limpiar (job bloqueado), se sigue: peor caso, este
        // caso no se reencola y queda para el próximo intento
      }
    })
  );

  await whatsappQueue.addBulk(
    casos.map((caso, i) => ({
      name: "enviar-template",
      data: { casoId: caso.id, plantilla },
      opts: {
        // jobId por caso: si se dispara la campaña dos veces seguidas,
        // el segundo encolado del mismo caso se ignora
        jobId: `${prefijo}-${caso.id}`,
        delay: i * delayMs, // espaciado entre mensajes por rate limit de Meta
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { age: 3600, count: 5000 },
        removeOnFail: { age: 24 * 3600 },
      },
    }))
  );

  return casos.length;
}

export async function progresoCola() {
  const conteos = await whatsappQueue.getJobCounts("waiting", "delayed", "active", "completed", "failed");
  return {
    enCola: (conteos.waiting ?? 0) + (conteos.delayed ?? 0),
    enviando: conteos.active ?? 0,
    completados: conteos.completed ?? 0,
    fallidos: conteos.failed ?? 0,
  };
}
