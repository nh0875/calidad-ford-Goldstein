// ---------------------------------------------------------------------------
// ¿Por qué no salió el segundo contacto?
// ---------------------------------------------------------------------------
//
// POR QUÉ EXISTE. El circuito de insistencia corre solo, cada hora, y cuando no
// hace nada no deja rastro: desde afuera "el cron no corrió" y "el cron corrió y
// no encontró a nadie" se ven exactamente igual. La primera vez que pasó hubo
// que leer todo el código para descartar hipótesis, y ninguna se podía confirmar
// sin mirar la base y Redis a la vez.
//
// Esto mira las dos cosas juntas y dice, caso por caso, por qué está o no está
// esperando el segundo contacto.
//
// CÓMO SE CORRE, en la PC donde vive el sistema:
//
//   docker compose -f docker-compose.prod.yml exec backend npx tsx src/scripts/diagnostico-circuito.ts
//
// No toca nada: solo lee.

import { EstadoContacto, MessageDirection } from "@prisma/client";
import { marca } from "../config/marca";
import { prisma } from "../config/prisma";
import { mantenimientoQueue, whatsappQueue } from "../jobs/queues";
import {
  HORAS_PARA_LLAMADA,
  HORAS_PARA_SEGUNDO_CONTACTO,
  jobIdSegundoContacto,
} from "../services/segundo-contacto.service";

const AR = "America/Argentina/Buenos_Aires";

function hora(fecha: Date | number | null | undefined): string {
  if (fecha === null || fecha === undefined) return "—";
  return new Date(fecha).toLocaleString("es-AR", { timeZone: AR });
}

function titulo(texto: string): void {
  console.log(`\n${"=".repeat(72)}\n${texto}\n${"=".repeat(72)}`);
}

async function main(): Promise<void> {
  console.log(`Diagnóstico del circuito de insistencia — ${hora(Date.now())} (hora de Argentina)`);
  console.log(`Marca: ${marca.nombre}. Circuito de insistencia: ${marca.segundoContacto ? "PRENDIDO" : "APAGADO"}`);

  if (!marca.segundoContacto) {
    console.log("\nEn esta marca el circuito está apagado a propósito: no hay nada que revisar.");
    return;
  }

  // ---------------------------------------------------------------- el cron
  titulo("1. EL CRON — ¿está registrado y cuándo vuelve a correr?");
  const repetibles = await mantenimientoQueue.getRepeatableJobs();
  if (repetibles.length === 0) {
    console.log("NO HAY NINGÚN TRABAJO REPETIBLE REGISTRADO. El circuito no va a correr solo.");
    console.log("Se registran al arrancar el backend: reiniciá el contenedor y volvé a mirar.");
  }
  for (const r of repetibles) {
    console.log(`· ${r.name.padEnd(22)} patrón "${r.pattern}"  próxima corrida: ${hora(r.next)}`);
  }
  const circuito = repetibles.find((r) => r.name === "circuito-contacto");
  if (!circuito) {
    console.log('\nOJO: falta "circuito-contacto". Sin eso, el segundo contacto SOLO sale con el botón a mano.');
  } else {
    console.log(
      `\nEl circuito corre EN PUNTO, cada hora. Un caso contactado 09:30 recibe la insistencia\n` +
        `a las 10:00 del día siguiente, no a las 09:30: las 24 h se cumplen a las 09:30 pero la\n` +
        `barrida más próxima es la de las 10:00.`
    );
  }

  // -------------------------------------------------- las últimas corridas
  titulo("2. LAS ÚLTIMAS CORRIDAS — ¿corrió de verdad?");
  const hechos = await mantenimientoQueue.getJobs(["completed", "failed"], 0, 30);
  const delCircuito = hechos.filter((j) => j?.name === "circuito-contacto");
  if (delCircuito.length === 0) {
    console.log("No hay ninguna corrida registrada en Redis.");
    console.log("Puede ser que nunca haya corrido, o que Redis se haya vaciado (se reinició el stack).");
  }
  for (const j of delCircuito.slice(0, 10)) {
    const estado = j.finishedOn ? (j.failedReason ? "FALLÓ" : "ok") : "en curso";
    console.log(
      `· ${hora(j.finishedOn ?? j.timestamp)}  ${estado.padEnd(8)} ${JSON.stringify(j.returnvalue ?? {})}` +
        (j.failedReason ? `  ← ${j.failedReason}` : "")
    );
  }

  // --------------------------------------------------------- los candidatos
  titulo("3. LOS CASOS — ¿quién debería recibir el segundo contacto AHORA?");
  const corte = new Date(Date.now() - HORAS_PARA_SEGUNDO_CONTACTO * 60 * 60 * 1000);
  console.log(`Se busca: estado ENVIADO, sin segundo contacto, sin respuesta, primer envío antes de ${hora(corte)}.`);

  const enviados = await prisma.caso.count({ where: { estadoContacto: EstadoContacto.ENVIADO } });
  const conSegundo = await prisma.caso.count({ where: { segundoContactoEn: { not: null } } });
  const aLlamar = await prisma.caso.count({ where: { estadoContacto: EstadoContacto.LLAMADA_PENDIENTE } });
  console.log(`\nEn ENVIADO: ${enviados} · ya con segundo contacto: ${conSegundo} · en LLAMADA_PENDIENTE: ${aLlamar}`);

  const candidatos = await prisma.caso.findMany({
    where: {
      estadoContacto: EstadoContacto.ENVIADO,
      segundoContactoEn: null,
      whatsappOptOut: false,
      mensajes: { none: { direction: MessageDirection.ENTRANTE } },
      AND: [{ mensajes: { some: { direction: MessageDirection.SALIENTE, createdAt: { lte: corte } } } }],
    },
    select: { id: true, numeroOrden: true, nombrePropietario: true },
    orderBy: { createdAt: "asc" },
    take: 30,
  });

  console.log(`\nCumplen las ${HORAS_PARA_SEGUNDO_CONTACTO} h y todavía no se les insistió: ${candidatos.length}`);
  for (const c of candidatos) {
    // Lo que hay en Redis para ESE caso. Un job que quedó "failed" bloquea los
    // encolados siguientes: BullMQ descarta un add con un jobId que ya existe,
    // sin avisar. Es la forma silenciosa en que un caso se queda esperando.
    const job = await whatsappQueue.getJob(jobIdSegundoContacto(c.id));
    const estado = job ? await job.getState().catch(() => "?") : null;
    console.log(
      `· orden ${String(c.numeroOrden).padEnd(10)} ${c.nombrePropietario.slice(0, 28).padEnd(28)} ` +
        (job ? `YA TIENE UN ENVÍO EN REDIS (${estado})` : "listo para encolar")
    );
    if (job?.failedReason) console.log(`    ↳ falló: ${job.failedReason.slice(0, 160)}`);
  }

  // --------------------------------------- los que están por pasar a llamada
  titulo("4. LOS QUE ESTÁN POR PASAR A LLAMADA");
  const corteLlamada = new Date(Date.now() - HORAS_PARA_LLAMADA * 60 * 60 * 1000);
  const paraLlamar = await prisma.caso.count({
    where: {
      estadoContacto: EstadoContacto.ENVIADO,
      segundoContactoEn: { lte: corteLlamada },
      mensajes: { none: { direction: MessageDirection.ENTRANTE } },
    },
  });
  const esperando = await prisma.caso.count({
    where: {
      estadoContacto: EstadoContacto.ENVIADO,
      segundoContactoEn: { gt: corteLlamada },
      mensajes: { none: { direction: MessageDirection.ENTRANTE } },
    },
  });
  console.log(`Ya cumplieron las ${HORAS_PARA_LLAMADA} h y pasarían a llamada en la próxima barrida: ${paraLlamar}`);
  console.log(`Recibieron el segundo contacto pero todavía no cumplen las ${HORAS_PARA_LLAMADA} h: ${esperando}`);

  console.log("\nListo. Nada de esto modificó nada.\n");
}

main()
  .catch((err) => {
    console.error("El diagnóstico falló:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await whatsappQueue.close();
    await mantenimientoQueue.close();
  });
