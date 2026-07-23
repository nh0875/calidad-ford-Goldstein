import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";
import { EstadoContacto, MessageDirection } from "@prisma/client";
import { z } from "zod";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { analisisQueue } from "../jobs/queues";
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
  const guardado = await prisma.whatsappMessage.create({
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

  await analisisQueue.add(
    "analizar-respuesta",
    { casoId: caso.id, messageId: guardado.id },
    {
      attempts: 5,
      backoff: { type: "custom" }, // ver backoffStrategy del worker (60-90s ante 429)
      removeOnComplete: { age: 3600, count: 5000 },
      removeOnFail: { age: 24 * 3600 },
    }
  );

  res.status(202).json({
    message: `Respuesta simulada para ${caso.nombrePropietario}. El análisis se está procesando; en unos segundos vas a ver el semáforo y, si corresponde, el RQR generado.`,
  });
}
