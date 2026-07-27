import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";
import { EstadoContacto, MessageDirection } from "@prisma/client";
import { z } from "zod";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { programarAnalisis } from "../services/analisis.service";
import { marcarOptOutSiCorresponde } from "../services/agradecimiento.service";

// Middleware: todo lo de /demo solo existe si MODO_DEMO=true. Si no, 404 (como
// si la ruta no existiera), para que en producción no quede expuesto nada.
export function soloModoDemo(_req: Request, res: Response, next: NextFunction) {
  if (!env.modoDemo) {
    return res.status(404).json({ message: "Ruta no encontrada" });
  }
  next();
}

// GET /api/demo/estado — para que el frontend sepa si el modo demo está activo.
export function estadoDemo(_req: Request, res: Response) {
  res.json({ modoDemo: env.modoDemo });
}

// ---------- POST /api/demo/simular-respuesta ----------
// Recorre EXACTAMENTE el mismo camino que una respuesta real entrante por el
// webhook de WhatsApp: crea el WhatsappMessage ENTRANTE, pasa el caso a
// RESPONDIDO y encola el análisis de sentimiento (que puede abrir un RQR).

const schema = z.object({
  casoId: z.string().trim().min(1, "Indicá el caso."),
  texto: z.string().trim().min(1, "Escribí el mensaje que simula la respuesta del cliente."),
});

export async function simularRespuesta(req: Request, res: Response) {
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      message: parsed.error.errors[0]?.message ?? "Datos inválidos.",
    });
  }
  const { casoId, texto } = parsed.data;

  const caso = await prisma.caso.findUnique({ where: { id: casoId } });
  if (!caso || caso.eliminadoEn) {
    return res.status(404).json({ message: "No se encontró ese caso." });
  }

  // Mismo efecto que procesarMensajeEntrante() del webhook real
  await prisma.whatsappMessage.create({
    data: {
      casoId: caso.id,
      direction: MessageDirection.ENTRANTE,
      content: texto,
      waMessageId: `demo-in-${randomUUID()}`,
      status: "recibido",
    },
  });

  await prisma.caso.update({
    where: { id: caso.id },
    data: { estadoContacto: EstadoContacto.RESPONDIDO },
  });

  // Mismo comportamiento que el webhook real: detectar opt-out (BAJA/STOP)
  await marcarOptOutSiCorresponde(caso.id, texto);

  // Igual que el webhook real: se programa el análisis de la tanda completa.
  // Si se simulan varios mensajes seguidos, se consolidan en un solo análisis.
  await programarAnalisis(caso.id);

  const segundos = Math.round(env.delayAnalisisMs / 1000);
  res.status(202).json({
    message:
      `Respuesta simulada para ${caso.nombrePropietario}. El sistema espera ${segundos} segundos por si el cliente sigue escribiendo ` +
      `y después analiza todo junto; ahí vas a ver el semáforo y, si corresponde, el RQR generado.`,
  });
}
