import { EstadoContacto } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../config/prisma";

/**
 * Marca NO_RESPONDIO los casos que siguen en ENVIADO sin actividad hace
 * más de N días (si hubieran respondido, el webhook ya los habría pasado
 * a RESPONDIDO). Lo dispara el cron diario de la cola `mantenimiento`.
 */
export async function marcarNoRespondidos(): Promise<number> {
  const cutoff = new Date(Date.now() - env.diasSinRespuestaParaNC * 24 * 60 * 60 * 1000);

  const resultado = await prisma.caso.updateMany({
    where: {
      estadoContacto: EstadoContacto.ENVIADO,
      // sin ningún mensaje (saliente ni entrante) posterior al corte
      mensajes: { none: { createdAt: { gte: cutoff } } },
    },
    data: { estadoContacto: EstadoContacto.NO_RESPONDIO },
  });

  return resultado.count;
}
