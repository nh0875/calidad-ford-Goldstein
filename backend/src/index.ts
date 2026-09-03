import { createApp } from "./app";
import { env } from "./config/env";
import { registrarJobsRepetibles } from "./jobs/queues";
import { startWorkers } from "./jobs/workers";
import { modoAnalisisActivo } from "./services/sentiment.service";
import { seedAdmin } from "./scripts/seedAdmin";
import { detenerLatido, iniciarLatido } from "./services/latido.service";

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`Backend escuchando en http://localhost:${env.port} (env: ${env.nodeEnv})`);
});

// Deja claro en el arranque qué motor de análisis quedó activo (sin mock silencioso)
{
  const { modo, motivo } = modoAnalisisActivo();
  const etiqueta = modo === "mock" ? "MOCK (no IA real)" : `IA REAL vía ${modo}`;
  const linea = `[IA] Análisis de sentimiento: ${etiqueta} — ${motivo}.`;
  if (env.modoDemo && modo === "mock") {
    console.warn(`${linea} MODO_DEMO está activo pero no hay API key: cargá GEMINI_API_KEY para clasificar con Gemini de verdad.`);
  } else {
    console.log(`${linea}${env.modoDemo ? " (MODO_DEMO activo: WhatsApp simulado)" : ""}`);
  }
}

const workers = startWorkers();

registrarJobsRepetibles()
  .then(() => console.log("Cron diario de NO_RESPONDIO registrado (08:00 AR)"))
  .catch((err) => console.error("No se pudo registrar el cron de mantenimiento:", err));

seedAdmin().catch((err) => console.error("[seed] Error creando el admin inicial:", err));

// Latido: deja constancia de que el sistema esta vivo, y al arrancar mide cuanto
// estuvo caido. Importa porque los mensajes entrantes de WhatsApp llegan SOLO
// por webhook: con la PC apagada Meta reintenta, pero no para siempre, y no hay
// forma de pedirle despues lo que no pudo entregar.
iniciarLatido().catch((err) => console.error("[latido] no pudo arrancar:", err));

// ---------------------------------------------------------------------------
// Apagado ordenado
// ---------------------------------------------------------------------------
// Sin esto, un `docker compose up -d` mata a los workers a mitad de un job. El
// caso feo es el envío de WhatsApp: si el proceso muere justo entre que Meta
// acepta el mensaje y que se registra en la base, BullMQ lo da por colgado y lo
// reintenta, y el cliente RECIBE EL MENSAJE DOS VECES.
//
// `worker.close()` deja de tomar jobs nuevos y espera a que termine el que está
// en curso. Importa desde que el sistema se actualiza solo al mediodía, con
// gente usándolo y la ventana de envío abierta.
//
// Para que la señal llegue hasta acá hacen falta dos cosas más, fuera de este
// archivo: que el CMD del Dockerfile haga `exec node` (si no, PID 1 es `sh` y se
// come el SIGTERM) y que compose dé tiempo suficiente (stop_grace_period).
let apagando = false;

async function apagarOrdenado(senal: string): Promise<void> {
  if (apagando) return;
  apagando = true;
  console.log(`[apagado] ${senal} recibido: se termina el trabajo en curso y se cierra.`);

  const plazo = setTimeout(() => {
    console.error("[apagado] tardó demasiado: se cierra a la fuerza.");
    process.exit(1);
  }, 25_000);
  plazo.unref();

  detenerLatido();

  try {
    await Promise.all(workers.map((w) => w.close()));
    console.log("[apagado] workers cerrados sin dejar jobs a medias.");
  } catch (err) {
    console.error("[apagado] error cerrando los workers:", err);
  }

  server.close(() => {
    clearTimeout(plazo);
    console.log("[apagado] listo.");
    process.exit(0);
  });
}

process.on("SIGTERM", () => void apagarOrdenado("SIGTERM"));
process.on("SIGINT", () => void apagarOrdenado("SIGINT"));
