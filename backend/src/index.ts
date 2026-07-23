import { createApp } from "./app";
import { env } from "./config/env";
import { registrarJobsRepetibles } from "./jobs/queues";
import { startWorkers } from "./jobs/workers";
import { modoAnalisisActivo } from "./services/sentiment.service";
import { seedAdmin } from "./scripts/seedAdmin";

const app = createApp();

app.listen(env.port, () => {
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

startWorkers();

registrarJobsRepetibles()
  .then(() => console.log("Cron diario de NO_RESPONDIO registrado (08:00 AR)"))
  .catch((err) => console.error("No se pudo registrar el cron de mantenimiento:", err));

seedAdmin().catch((err) => console.error("[seed] Error creando el admin inicial:", err));
