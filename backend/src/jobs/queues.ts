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

const TZ_AR = "America/Argentina/Buenos_Aires";

/**
 * Los trabajos que corren solos.
 *
 *   marcar-no-respondio  · una vez por día. Cierra como NO_RESPONDIO lo que
 *                          quedó sin respuesta (solo en las marcas SIN circuito
 *                          de insistencia; ver mantenimiento.service.ts).
 *   circuito-contacto    · UNA VEZ POR HORA. Manda el segundo contacto a los que
 *                          cumplieron 24 h y pasa a llamada a los que cumplieron
 *                          otras 24 h.
 *
 * POR QUÉ POR HORA Y NO UNA VEZ POR DÍA. Las 24 h de un caso se cumplen a
 * cualquier hora. Con una corrida diaria, un caso contactado a las 18:00 recién
 * se atendería al otro día a las 08:00: catorce horas de más, y encima el
 * mensaje saldría todo junto en una ráfaga a la mañana. Por hora, cada caso
 * recibe la insistencia apenas le toca, y si le toca de madrugada la ventana de
 * envío lo retiene hasta las 09:00.
 *
 * OJO CON LOS REPETIBLES DE BULLMQ. Se identifican por nombre + patrón, así que
 * cambiarle el horario a uno que ya existe NO lo reemplaza: quedan los dos
 * registrados y el viejo sigue disparando para siempre. Por eso antes de
 * registrar se borra todo lo que haya, y recién ahí se agrega lo de esta versión.
 */
export async function registrarJobsRepetibles() {
  const deseados = [
    { nombre: "marcar-no-respondio", patron: "0 8 * * *" },
    { nombre: "circuito-contacto", patron: "0 * * * *" },
  ];

  // Se borra lo que no coincida EXACTAMENTE con lo que esta versión quiere. Sin
  // esto, cada cambio de horario dejaría un cron fantasma corriendo con la
  // configuración vieja, imposible de ver desde el código.
  const existentes = await mantenimientoQueue.getRepeatableJobs();
  for (const viejo of existentes) {
    const sigueVigente = deseados.some((d) => d.nombre === viejo.name && d.patron === viejo.pattern);
    if (sigueVigente) continue;
    await mantenimientoQueue.removeRepeatableByKey(viejo.key);
    console.log(`[cron] se quitó el repetible viejo "${viejo.name}" (${viejo.pattern})`);
  }

  for (const d of deseados) {
    await mantenimientoQueue.add(d.nombre, {}, { repeat: { pattern: d.patron, tz: TZ_AR } });
  }
}
