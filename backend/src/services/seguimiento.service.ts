import { MessageDirection } from "@prisma/client";
import { prisma } from "../config/prisma";

// ---------- Ventana de 24 horas de WhatsApp ----------
//
// La Cloud API solo deja mandar TEXTO LIBRE dentro de las 24 hs posteriores al
// ÚLTIMO mensaje que mandó el cliente. Pasado ese lapso, la única forma de
// escribirle es una PLANTILLA aprobada. Esta es la regla dura de la plataforma,
// no una decisión nuestra: por eso el chat interno bloquea el texto libre fuera
// de la ventana y ofrece reenviar la plantilla.

export const MS_VENTANA_24H = 24 * 60 * 60 * 1000;

export interface EstadoVentana {
  abierta: boolean;
  // Cuándo se cierra (o cerró) la ventana; null si el cliente nunca escribió.
  cierraEn: Date | null;
}

export function estadoVentana(ultimoEntranteAt: Date | null): EstadoVentana {
  if (!ultimoEntranteAt) return { abierta: false, cierraEn: null };
  const cierraEn = new Date(ultimoEntranteAt.getTime() + MS_VENTANA_24H);
  return { abierta: cierraEn.getTime() > Date.now(), cierraEn };
}

/** Fecha del último mensaje ENTRANTE del caso (para calcular la ventana). */
export async function ultimoEntranteAt(casoId: string): Promise<Date | null> {
  const m = await prisma.whatsappMessage.findFirst({
    where: { casoId, direction: MessageDirection.ENTRANTE },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return m?.createdAt ?? null;
}

/** El mejor teléfono para escribirle (E.164, empieza con "+"), o "" si no hay. */
export function telefonoContactable(caso: { whatsapp: string | null; celular: string | null }): string {
  const t = caso.whatsapp?.trim() || caso.celular?.trim() || "";
  return t.startsWith("+") ? t : "";
}
