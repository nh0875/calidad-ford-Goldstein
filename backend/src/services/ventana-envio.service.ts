import { MessageDirection } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../config/prisma";

// Ventana horaria y tope diario de envíos de campañas de WhatsApp. Protege a
// los clientes (no recibir mensajes de madrugada) y a la cuenta de Meta (no
// pasar un volumen diario). Aplica SOLO a los envíos de campaña (template),
// no a los agradecimientos conversacionales.

const TZ = "America/Argentina/Buenos_Aires";

function parseHhMm(hhmm: string): { h: number; m: number } {
  const [h, m] = hhmm.split(":").map((x) => Number(x));
  return { h: isNaN(h) ? 0 : h, m: isNaN(m) ? 0 : m };
}

// "Ahora" en hora de Argentina, sin depender de la TZ del servidor (UTC en Docker).
function ahoraAR(): { hora: number; minuto: number; fecha: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  // en-CA da hour "24" a la medianoche en algunos runtimes; normalizamos
  const hora = Number(p.hour) % 24;
  return { hora, minuto: Number(p.minute), fecha: `${p.year}-${p.month}-${p.day}` };
}

export function dentroDeVentana(): boolean {
  const { hora, minuto } = ahoraAR();
  const ini = parseHhMm(env.horaInicioEnvio);
  const fin = parseHhMm(env.horaFinEnvio);
  const ahora = hora * 60 + minuto;
  const desde = ini.h * 60 + ini.m;
  const hasta = fin.h * 60 + fin.m;
  return ahora >= desde && ahora < hasta;
}

// ms hasta la próxima apertura de la ventana (hoy si aún no abrió, o mañana).
export function msHastaProximaApertura(): number {
  const ini = parseHhMm(env.horaInicioEnvio);
  const { hora, minuto } = ahoraAR();
  const ahoraMin = hora * 60 + minuto;
  const aperturaMin = ini.h * 60 + ini.m;
  const faltanMin = ahoraMin < aperturaMin ? aperturaMin - ahoraMin : 24 * 60 - ahoraMin + aperturaMin;
  return Math.max(60_000, faltanMin * 60_000); // al menos 1 min para evitar spin
}

// Instante UTC de la medianoche de HOY en AR (AR = UTC-3, sin horario de verano).
function inicioDelDiaAR_UTC(): Date {
  return new Date(`${ahoraAR().fecha}T03:00:00Z`);
}

// Envíos de CAMPAÑA (template) ya salidos hoy (no cuenta los agradecimientos).
export async function enviosHoy(): Promise<number> {
  return prisma.whatsappMessage.count({
    where: {
      direction: MessageDirection.SALIENTE,
      esAgradecimiento: false,
      createdAt: { gte: inicioDelDiaAR_UTC() },
    },
  });
}

export async function cupoDisponibleHoy(): Promise<number> {
  return Math.max(0, env.maxEnviosDiarios - (await enviosHoy()));
}

export function motivoFueraDeVentana(): string {
  return `Los envíos de WhatsApp solo salen entre las ${env.horaInicioEnvio} y las ${env.horaFinEnvio} (hora de Argentina). Volvé a intentar dentro de ese horario; los mensajes ya encolados salen solos cuando abre la ventana.`;
}
