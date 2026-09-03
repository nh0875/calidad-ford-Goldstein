// ---------------------------------------------------------------------------
// Latido del sistema: saber cuándo estuvo caído, y a quién pudo costarle
// ---------------------------------------------------------------------------
//
// EL PROBLEMA. Los mensajes entrantes de WhatsApp llegan SOLO por webhook. Si la
// PC de la agencia está apagada, Meta no puede entregar. La buena noticia es que
// Meta reintenta; la mala es que su propia documentación se contradice sobre
// cuánto tiempo:
//
//   - Cloud API (la página específica de WhatsApp): reintenta hasta 7 DÍAS.
//   - Graph API Webhooks (la genérica): 36 HORAS, y después los descarta.
//
// Hay que diseñar para el peor caso: 36 horas. Y ahí el riesgo real no es la
// noche (unas 15 h, entra holgado) sino el FIN DE SEMANA: de viernes a la tarde
// a lunes a la mañana son ~63 horas, que se pasan.
//
// Y no hay red: no existe ningún endpoint para pedirle a Meta los mensajes que
// no pudo entregar. Su propia doc lo dice: "You will not be able to query
// historical webhook event notification data". Si se pierde, se perdió, y —lo
// peor— NADIE SE ENTERA.
//
// QUÉ HACE ESTO. Deja un latido mientras el sistema está vivo. Al arrancar
// compara contra el último latido: la diferencia es exactamente cuánto estuvo
// caído. Con eso se puede avisar, y se puede listar a qué clientes había que
// escucharles una respuesta en esa franja para pedirles que la repitan con la
// plantilla de recuperación que el sistema ya tiene.
//
// POR QUÉ EN LA TABLA Configuracion Y NO EN UNA TABLA PROPIA. Para no meter una
// migración: esto se despliega en DOS PCs de producción (Ford y Volkswagen) que
// se actualizan solas al mediodía, sin nadie mirando. Una clave-valor alcanza de
// sobra para un timestamp y una lista corta.

import { EstadoContacto, MessageDirection } from "@prisma/client";
import { prisma } from "../config/prisma";

const CLAVE_LATIDO = "sistema.ultimoLatido";
const CLAVE_CAIDAS = "sistema.caidas";

// Cada cuánto se deja el latido. Un minuto es barato (un UPDATE de una fila) y
// deja la medición con un error máximo de un minuto, que para esto sobra.
const CADA_MS = 60_000;

// Debajo de esto no se considera una caída: es un reinicio normal (la
// actualización del mediodía tarda entre 1 y 5 minutos, y un `compose up`
// menos). Registrarlos ensuciaría la lista y taparía lo que importa.
const MINIMO_MINUTOS = 10;

// El peor caso creíble de la ventana de reintentos de Meta. Pasado esto hay que
// asumir que se perdieron mensajes.
export const VENTANA_SEGURA_HORAS = 36;

// Cuántas caídas se conservan. Es para mirar hacia atrás un par de meses, no
// para hacer estadística.
const MAX_CAIDAS = 50;

export interface Caida {
  /** Último latido antes del apagón: desde acá el sistema no respondía más. */
  desde: string;
  /** Momento en que volvió a arrancar. */
  hasta: string;
  minutos: number;
  /** true si superó la ventana de reintentos de Meta: pudo perderse algo. */
  riesgosa: boolean;
}

async function leer(clave: string): Promise<string> {
  const fila = await prisma.configuracion.findUnique({ where: { clave } });
  return fila?.valor ?? "";
}

async function escribir(clave: string, valor: string): Promise<void> {
  await prisma.configuracion.upsert({
    where: { clave },
    create: { clave, valor },
    update: { valor },
  });
}

export async function caidasRegistradas(): Promise<Caida[]> {
  const crudo = await leer(CLAVE_CAIDAS);
  if (!crudo) return [];
  try {
    const datos = JSON.parse(crudo);
    return Array.isArray(datos) ? (datos as Caida[]) : [];
  } catch {
    // Un valor corrupto no puede tumbar el arranque del backend.
    return [];
  }
}

/**
 * Compara el arranque contra el último latido y, si hubo un hueco, lo registra.
 * Devuelve la caída detectada, o null si el sistema venía andando.
 */
async function detectarCaida(): Promise<Caida | null> {
  const anterior = await leer(CLAVE_LATIDO);
  if (!anterior) return null; // primer arranque de esta instalación

  const desde = new Date(anterior);
  if (Number.isNaN(desde.getTime())) return null;

  const ahora = new Date();
  const minutos = Math.round((ahora.getTime() - desde.getTime()) / 60_000);
  if (minutos < MINIMO_MINUTOS) return null;

  const caida: Caida = {
    desde: desde.toISOString(),
    hasta: ahora.toISOString(),
    minutos,
    riesgosa: minutos > VENTANA_SEGURA_HORAS * 60,
  };

  const lista = await caidasRegistradas();
  lista.unshift(caida);
  await escribir(CLAVE_CAIDAS, JSON.stringify(lista.slice(0, MAX_CAIDAS)));
  return caida;
}

/**
 * Casos que estaban esperando una respuesta durante la franja de la caída: se
 * les había mandado la plantilla ANTES de que terminara el apagón y, al día de
 * hoy, siguen sin contestar.
 *
 * No prueba que hayan escrito —eso es indemostrable, justamente porque el
 * mensaje nunca llegó— pero es exactamente la lista de gente a la que conviene
 * pedirle que repita.
 */
export async function casosEnRiesgo(caida: Caida) {
  const finCaida = new Date(caida.hasta);

  return prisma.caso.findMany({
    where: {
      eliminadoEn: null,
      estadoContacto: EstadoContacto.ENVIADO,
      mensajes: {
        some: {
          direction: MessageDirection.SALIENTE,
          createdAt: { lte: finCaida },
        },
      },
    },
    select: {
      id: true,
      numeroOrden: true,
      nombrePropietario: true,
      whatsapp: true,
      celular: true,
      area: true,
      sucursal: true,
      estadoContacto: true,
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
}

let cronometro: NodeJS.Timeout | null = null;

/**
 * Arranca el latido. Primero mide el hueco contra el latido anterior (tiene que
 * ser ANTES de escribir el nuevo, si no se pisa la evidencia) y después deja el
 * temporizador corriendo.
 */
export async function iniciarLatido(): Promise<void> {
  try {
    const caida = await detectarCaida();
    if (caida) {
      const horas = (caida.minutos / 60).toFixed(1);
      if (caida.riesgosa) {
        console.warn(
          `[latido] EL SISTEMA ESTUVO CAIDO ${horas} h (desde ${caida.desde}). ` +
            `Supera las ${VENTANA_SEGURA_HORAS} h que Meta garantiza de reintentos: ` +
            `PUEDE HABERSE PERDIDO ALGUNA RESPUESTA DE CLIENTE. ` +
            `Mirá /api/sistema/caidas para ver a quiénes pedirles que repitan.`
        );
      } else {
        console.log(
          `[latido] el sistema estuvo caído ${horas} h. Entra en la ventana de ` +
            `reintentos de Meta: los mensajes de esa franja deberían entrar solos.`
        );
      }
    }
  } catch (err) {
    // Que no arranque el latido no puede impedir que arranque el sistema.
    console.error("[latido] no pude comprobar el arranque:", err);
  }

  const latir = async () => {
    try {
      await escribir(CLAVE_LATIDO, new Date().toISOString());
    } catch (err) {
      console.error("[latido] no pude escribir el latido:", err);
    }
  };

  await latir();
  cronometro = setInterval(() => void latir(), CADA_MS);
  // Que un temporizador de fondo no mantenga vivo el proceso al apagarse.
  cronometro.unref();
}

export function detenerLatido(): void {
  if (cronometro) {
    clearInterval(cronometro);
    cronometro = null;
  }
}
