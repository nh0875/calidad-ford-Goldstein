import { AreaTrabajo, EstadoContacto, OrigenAgendamiento, Prisma } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { whatsappQueue } from "../jobs/queues";
import { telefonosSuprimidos } from "./supresion.service";

// REGLA CRÍTICA: las campañas operan SOLO sobre casos PENDIENTE.
// Eso excluye internos (INTERNO), históricos ya clasificados
// (RESPONDIDO / NO_RESPONDIO), ya enviados (ENVIADO) y fallidos (ERROR).

export interface FiltrosCampana {
  uploadId?: string;
  sucursal?: string;
  periodo?: string;
  asesor?: string;
  origenAgendamiento?: OrigenAgendamiento;
  // Área efectiva del usuario que dispara la campaña (la fija el controller a
  // partir de la sesión; el cliente NO la puede setear). Un usuario de VENTAS
  // jamás alcanza casos de POSVENTA, ni siquiera pasando casoIds a mano.
  area?: AreaTrabajo | null;
  casoIds?: string[]; // selección manual desde la tabla (igual se exige PENDIENTE)
  // "contacto" (default): campaña de contacto, SOLO casos PENDIENTE.
  // "respuesta_no_recibida": envío masivo de "pedir que repitan el mensaje", a
  // clientes ya contactados en cualquier estado (para respuestas que se perdieron).
  plantilla?: "contacto" | "respuesta_no_recibida";
}

export async function construirWhereCampana(filtros: FiltrosCampana): Promise<Prisma.CasoWhereInput> {
  // Lista de supresión por teléfono: se excluye cualquier caso cuyo whatsapp o
  // celular normalizado esté suprimido. Esto aplica SIEMPRE, incluso cuando se
  // pasan casoIds a mano (no se puede saltear pasando IDs en la request).
  const suprimidos = await telefonosSuprimidos();
  const esRecuperacion = filtros.plantilla === "respuesta_no_recibida";

  return {
    // CONTACTO: solo PENDIENTE (regla de siempre). RECUPERACIÓN ("pedir que
    // repitan"): clientes YA contactados en cualquier estado, salvo INTERNO, y
    // con un teléfono válido (E.164).
    ...(esRecuperacion
      ? {
          estadoContacto: { not: EstadoContacto.INTERNO },
          OR: [{ whatsapp: { startsWith: "+" } }, { celular: { startsWith: "+" } }],
        }
      : { estadoContacto: EstadoContacto.PENDIENTE }),
    eliminadoEn: null, // un caso borrado no recibe campañas de WhatsApp
    whatsappOptOut: false, // el cliente que pidió la baja (BAJA/STOP) nunca recibe campañas
    ...(suprimidos.size > 0
      ? { NOT: { telefonosNorm: { hasSome: [...suprimidos] } } } // teléfono en la lista de supresión
      : {}),
    ...(filtros.area ? { area: filtros.area } : {}), // restricción por área (aplica aun con casoIds)
    ...(filtros.uploadId ? { uploadId: filtros.uploadId } : {}),
    ...(filtros.sucursal ? { sucursal: { equals: filtros.sucursal, mode: "insensitive" } } : {}),
    ...(filtros.periodo ? { upload: { periodo: filtros.periodo } } : {}),
    ...(filtros.asesor ? { asesor: { contains: filtros.asesor, mode: "insensitive" } } : {}),
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
  const prefijo = plantilla === "respuesta_no_recibida" ? "recup" : "envio";

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
