import { createApp } from "./app";
import { env } from "./config/env";
import { registrarJobsRepetibles } from "./jobs/queues";
import { startWorkers } from "./jobs/workers";
import { modoAnalisisActivo } from "./services/sentiment.service";
import { seedAdmin } from "./scripts/seedAdmin";
import { detenerLatido, iniciarLatido } from "./services/latido.service";
import { limpiarCausasRaizFueraDeLista } from "./services/causa-raiz.service";
import { completarDatosDePersonas, corregirSucursalesPorCodigo } from "./services/importacion-encuesta-vw.service";
import { cierreAutomaticoDePeriodos, listasHabilitadas } from "./services/cierre-periodo.service";
import { sembrarHistoricoCem } from "./services/indicadores-cem.service";

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
  .then(() => console.log("Trabajos automaticos registrados: cierre diario (08:00 AR) y circuito de contacto (cada hora)"))
  .catch((err) => console.error("No se pudo registrar el cron de mantenimiento:", err));

seedAdmin().catch((err) => console.error("[seed] Error creando el admin inicial:", err));

// Deja sin causa raíz lo que haya quedado clasificado con una lista anterior.
// Corre siempre y normalmente no hace nada: ver el porqué en su propio archivo.
limpiarCausasRaizFueraDeLista().catch((err) =>
  console.error("[causa-raiz] no se pudieron limpiar las causas viejas:", err)
);

// Encuestas de fábrica (VW): la sucursal de vendedores y clientes sale del código
// (1035 = Mendoza, 1036 = San Juan). Corrige lo cargado con la regla vieja; en
// Ford no hace nada.
corregirSucursalesPorCodigo()
  .then(({ vendedores, clientes, internosSinSucursalDeVenta }) => {
    if (vendedores || clientes) {
      console.log(`[encuesta-vw] sucursal corregida por código: ${vendedores} vendedor(es), ${clientes} cliente(s)`);
    }
    if (internosSinSucursalDeVenta) {
      console.warn(
        `[encuesta-vw] ${internosSinSucursalDeVenta} cliente(s) del Excel interno quedaron en la sucursal de su ` +
          `vendedor: si alguno se vendió en la otra sucursal, volver a subir el último Excel interno lo ubica bien.`
      );
    }
    // El nombre y el correo son de la persona: se completan en el código que no los tiene.
    return completarDatosDePersonas();
  })
  .then((r) => {
    if (r?.completados) console.log(`[encuesta-vw] ${r.completados} dato(s) de vendedor completados con su otro código`);
    if (r?.distintos.length) console.warn(`[encuesta-vw] vendedores con datos distintos en sus dos códigos: ${r.distintos.join("; ")}`);
  })
  .catch((err) => console.error("[encuesta-vw] no se pudieron corregir las sucursales:", err))
  // Recién con las sucursales corregidas se cierran meses: el cierre es por provincia.
  .then(() => correrCierreAutomatico());

// Cierre automático de meses de las encuestas de fábrica (VW): el día 19 se cierra el
// mes anterior. Corre al arrancar (si el 19 la PC estaba apagada, lo hace ahora) y
// una vez por hora. Casi siempre no hace nada. En Ford no hay listas: ni se agenda.
async function correrCierreAutomatico(): Promise<void> {
  try {
    for (const c of await cierreAutomaticoDePeriodos()) {
      // Los meses que se cierran sin clientes no ensucian el log.
      if (c.cerrados > 0) console.log(`[cierre] ${c.lista} ${c.periodo} ${c.sucursal}: cerrado solo, ${c.cerrados} cliente(s)`);
    }
  } catch (err) {
    console.error("[cierre] el cierre automático de meses falló:", err);
  }
}
const relojCierre = listasHabilitadas().length ? setInterval(() => void correrCierreAutomatico(), 60 * 60 * 1000) : null;
relojCierre?.unref();

// Indicadores CEM (VW): la primera vez, se carga lo que tenía la planilla "Q 2026".
sembrarHistoricoCem()
  .then((sembrado) => {
    if (sembrado) console.log("[indicadores-cem] cargado el histórico de la planilla Q 2026");
  })
  .catch((err) => console.error("[indicadores-cem] no se pudo cargar el histórico:", err));

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
