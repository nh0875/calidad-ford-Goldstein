import { Queue } from "bullmq";
import { redisConnection } from "../config/redis";

export const QUEUE_NAMES = {
  WHATSAPP_ENVIO: "whatsapp-envio",
  FIDELIZACION_ENVIO: "fidelizacion-envio",
  ANALISIS_SENTIMIENTO: "analisis-sentimiento",
  AGRADECIMIENTO: "agradecimiento",
  PROCESAR_EXCEL: "procesar-excel",
  MANTENIMIENTO: "mantenimiento",
} as const;

export const whatsappQueue = new Queue(QUEUE_NAMES.WHATSAPP_ENVIO, {
  connection: redisConnection,
});

// Envío del recordatorio de Fidelización (Parte C). Cola aparte de la de
// contacto: usa otra plantilla y NO dispara agradecimiento ni análisis.
export const fidelizacionQueue = new Queue(QUEUE_NAMES.FIDELIZACION_ENVIO, {
  connection: redisConnection,
});

// Parte A: mensaje de agradecimiento demorado (con debounce por jobId por caso)
export const agradecimientoQueue = new Queue(QUEUE_NAMES.AGRADECIMIENTO, {
  connection: redisConnection,
});

export const analisisQueue = new Queue(QUEUE_NAMES.ANALISIS_SENTIMIENTO, {
  connection: redisConnection,
});

export const excelQueue = new Queue(QUEUE_NAMES.PROCESAR_EXCEL, {
  connection: redisConnection,
});

export const mantenimientoQueue = new Queue(QUEUE_NAMES.MANTENIMIENTO, {
  connection: redisConnection,
});

/**
 * Registra el job repetible que corre una vez por día y marca NO_RESPONDIO
 * los casos ENVIADO sin respuesta. BullMQ deduplica los repetibles por
 * nombre + patrón, así que llamarlo en cada arranque es seguro.
 */
export async function registrarJobsRepetibles() {
  await mantenimientoQueue.add(
    "marcar-no-respondio",
    {},
    { repeat: { pattern: "0 8 * * *", tz: "America/Argentina/Buenos_Aires" } }
  );
}
