import { EstadoContacto } from "@prisma/client";
import { env } from "../config/env";
import { marca } from "../config/marca";
import { prisma } from "../config/prisma";

/**
 * Marca NO_RESPONDIO los casos que siguen en ENVIADO sin actividad hace
 * más de N días (si hubieran respondido, el webhook ya los habría pasado
 * a RESPONDIDO). Lo dispara el cron de la cola `mantenimiento`.
 *
 * EN LAS MARCAS CON CIRCUITO DE INSISTENCIA NO TOCA NADA, y es a propósito.
 * Allá un caso en ENVIADO no está abandonado: está en la mitad del circuito
 * —esperando el segundo contacto, o esperando las 24 h para pasar a llamada— y
 * el circuito siempre termina sacándolo de ENVIADO. Si esta barrida siguiera
 * corriendo, con un DIAS_SIN_RESPUESTA_PARA_NC bajo le ganaría de mano y cerraría
 * como "no respondió" casos que nadie llegó a llamar.
 *
 * Que el caso se quede visible en ENVIADO si el circuito falla es preferible a
 * que se cierre solo: un caso trabado se ve, uno cerrado en silencio no.
 */
export async function marcarNoRespondidos(): Promise<number> {
  if (marca.segundoContacto) return 0;

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
