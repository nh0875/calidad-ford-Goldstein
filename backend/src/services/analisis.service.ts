import { MessageDirection, Semaforo } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { analisisQueue } from "../jobs/queues";

// ---------- Consolidación de la respuesta del cliente ----------
//
// Un cliente casi nunca contesta con un solo mensaje. Lo normal es:
//
//   [nosotros]  ¿Cómo fue tu experiencia?
//   [cliente]   Hola
//   [cliente]   la verdad muy bien la atención
//   [cliente]   pero tardaron 3 días más de lo que me dijeron
//
// Analizando mensaje por mensaje eso daba TRES análisis: "Hola" (sin sentido),
// "muy bien la atención" (VERDE) y "tardaron 3 días" (AMARILLO/ROJO). Resultado:
// tres llamadas a la IA, el cliente contando como tres respuestas en el reporte
// y en el ranking del asesor, y el último fragmento decidiendo el semáforo del
// caso.
//
// La solución es esperar a que el cliente termine de escribir: cada mensaje que
// llega reprograma el análisis unos segundos más adelante, y cuando finalmente
// corre, se analiza TODA la tanda junta en una sola llamada.

/**
 * Programa (o reprograma) el análisis del caso. El jobId es fijo por caso, así
 * que cada mensaje nuevo pisa el pendiente y reinicia la cuenta: el análisis
 * corre recién cuando el cliente estuvo `DELAY_ANALISIS_MS` sin escribir.
 */
export async function programarAnalisis(casoId: string): Promise<void> {
  const jobId = `analisis-${casoId}`;

  // Se quita el pendiente para reprogramarlo. Si el job ya está corriendo no se
  // puede sacar (BullMQ lo tiene tomado): en ese caso el que corre analiza lo
  // que haya hasta ese momento y el mensaje nuevo queda sin analizar, así que
  // igual se encola de nuevo abajo y lo levanta la próxima corrida.
  try {
    await analisisQueue.remove(jobId);
  } catch {
    // no existía o estaba activo: está bien
  }

  await analisisQueue.add(
    "analizar-respuesta",
    { casoId },
    {
      jobId,
      delay: env.delayAnalisisMs,
      attempts: 5, // el 429 de cuota se reintenta con backoff largo; no queremos jobs muertos
      backoff: { type: "custom" }, // ver backoffStrategy del worker (60-90s ante 429)
      removeOnComplete: { age: 3600, count: 5000 },
      removeOnFail: { age: 24 * 3600 },
    }
  );
}

/** Mensajes entrantes del caso que todavía no fueron cubiertos por ningún análisis. */
export async function mensajesSinAnalizar(casoId: string) {
  return prisma.whatsappMessage.findMany({
    where: { casoId, direction: MessageDirection.ENTRANTE, analizadoEn: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      content: true,
      createdAt: true,
      mediaId: true,
      mediaMimeType: true,
      mediaTipo: true,
    },
  });
}

/**
 * Une la tanda en un solo texto para la IA. Si son varios, se numeran para que
 * el modelo entienda que es una sola persona escribiendo seguido y no mezcle
 * voces; si es uno solo, va tal cual (que es el caso más común).
 */
export function consolidarTexto(mensajes: { content: string }[]): string {
  const limpios = mensajes.map((m) => m.content.trim()).filter(Boolean);
  if (limpios.length <= 1) return limpios[0] ?? "";
  return limpios.map((t, i) => `(${i + 1}) ${t}`).join("\n");
}

// ---------- Mensajes de cortesía ----------
// "ok", "gracias", "👍" no son una opinión sobre el servicio. Cuando llegan
// DESPUÉS de que el caso ya tiene su clasificación (típicamente contestando
// nuestro propio mensaje de agradecimiento) no aportan nada: gastan cuota de
// IA y meten ruido. Se registran igual, pero no se analizan.
//
// OJO: esto NO se aplica a la primera respuesta del cliente. Un "gracias" como
// única respuesta sí hay que mirarlo (puede ser cortesía o alivio), así que va
// a revisión manual, que decide una persona.

// Se compara PALABRA POR PALABRA, no la frase entera: así "muchas gracias",
// "ok gracias" o "gracias, saludos" caen igual sin tener que enumerar todas las
// combinaciones. La lista es a propósito corta y sin palabras con carga: "bien",
// "muy", "excelente", "perfecto", "joya" NO están, porque "todo bien" o "muy
// bueno" sí son una opinión sobre el servicio y hay que analizarlas.
const PALABRAS_CORTESIA = new Set([
  "ok", "oka", "okey", "okay", "oki", "dale", "listo", "hola", "holis", "buenas", "buen",
  "dia", "dias", "tarde", "tardes", "noche", "noches", "gracias", "muchas", "mucha", "mil",
  "de", "nada", "igualmente", "saludos", "saludo", "abrazo", "chau", "adios", "hasta", "luego",
  "si", "no", "y", "!", "👍", "👌", "🙏", "😊", "🙂", "😃", "😀", "🤝", "✅", "❤", "❤️", "🙌",
]);

const MAX_PALABRAS_CORTESIA = 6; // más que eso ya es un mensaje con contenido

/** true = el texto es puro saludo/cortesía, sin nada que decir sobre el servicio. */
export function esSoloCortesia(texto: string): boolean {
  const limpio = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // saca tildes: "adiós" -> "adios"
    .replace(/[.,;:!¡¿?…"'()\-–—]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!limpio) return true;

  const palabras = limpio.split(" ").filter(Boolean);
  if (palabras.length > MAX_PALABRAS_CORTESIA) return false;
  return palabras.every((p) => PALABRAS_CORTESIA.has(p));
}

// ---------- Reacciones / respuestas de solo emoji ----------
//
// Un cliente que reacciona con 👍 (o responde solo con emojis) está diciendo
// algo, pero no es texto que la IA pueda leer bien: "👍" a secas se clasificaba
// como "no textual" y terminaba en revisión manual, sin semáforo. Peor: la IA
// devuelve resultados poco confiables ante un emoji suelto. Por eso los emojis
// se clasifican de forma DETERMINISTA (sin IA, sin costo): un pulgar arriba es
// verde, siempre.

// Se comparan por INCLUSIÓN (substring), no por igualdad, para tolerar los
// modificadores: "👍🏽" (tono de piel) y "👍️" (variation selector) contienen "👍".
const EMOJI_POSITIVOS = [
  "👍", "👌", "🙏", "🙌", "👏", "💪", "🤝", "✅", "☑️", "✔️", "💯", "🔥", "⭐", "🌟", "✨",
  "❤️", "❤", "🧡", "💛", "💚", "💙", "💜", "🤍", "🖤", "💖", "💕", "💗", "💓", "💞", "😍",
  "🥰", "😘", "🤩", "😊", "🙂", "😀", "😃", "😄", "😁", "😆", "😎", "🥳", "🎉", "🫶",
];

const EMOJI_NEGATIVOS = [
  "👎", "😡", "😠", "🤬", "💩", "😤", "😒", "🙄", "😞", "😔", "😩", "😫", "😖", "😣",
  "😢", "😭", "💔", "👿", "😾", "🤮", "🤢",
];

/** true = el texto es SOLO emojis/símbolos, sin ninguna letra ni número. */
export function esSoloEmoji(texto: string): boolean {
  // Se sacan espacios, ZWJ (une emojis compuestos) y variation selectors
  // (dan la forma emoji a un símbolo): U+200D, U+FE0E, U+FE0F.
  const sinEspacios = texto.replace(/[\s\u200d\ufe0e\ufe0f]/g, "").trim();
  if (!sinEspacios) return false;
  // Si al quitar todos los pictogramas y símbolos no queda NADA, era solo emoji.
  const sinPictogramas = sinEspacios.replace(
    /[\p{Extended_Pictographic}\p{Emoji_Component}\p{Emoji_Modifier}]/gu,
    ""
  );
  return sinPictogramas.length === 0;
}

/**
 * Clasifica una respuesta compuesta SOLO por emojis. Devuelve:
 *  - VERDE si hay al menos un emoji positivo y ninguno negativo
 *  - null  si tiene texto (no aplica), o si es ambigua (😮 😢) o mezcla
 *          positivo y negativo → que decida la IA / una persona
 * Nunca devuelve ROJO: un emoji negativo suelto (👎, 😡) es demasiado ambiguo
 * para abrir un reclamo solo; va a revisión manual.
 */
export function sentimientoSoloEmoji(contenidos: string[]): Semaforo | null {
  const textos = contenidos.map((c) => c.trim()).filter(Boolean);
  if (textos.length === 0) return null;
  if (!textos.every(esSoloEmoji)) return null; // hay texto: que lo lea la IA
  const junto = textos.join("");
  const tieneNegativo = EMOJI_NEGATIVOS.some((e) => junto.includes(e));
  const tienePositivo = EMOJI_POSITIVOS.some((e) => junto.includes(e));
  if (tienePositivo && !tieneNegativo) return Semaforo.VERDE;
  return null; // negativo, ambiguo o mezclado → sin decisión determinista
}

// ---------- Qué hacer con una tanda de mensajes ----------
//
// Antes esta decisión vivía suelta en el worker, como tres banderas encadenadas
// en un `if`. Se rompió DOS VECES por el orden entre ellas (la última: un 👍
// caía en "solo cortesía" y el cliente se quedaba sin el agradecimiento, porque
// 👍 está en la lista de cortesías para otro uso). Vive acá y se prueba sola.

export type MotivoRevisionManual =
  | "no-textual" // audio/imagen que no se pudo leer
  | "reaccion-ambigua" // emoji solo, sin sentimiento claro (👎, 😮)
  | "solo-cortesia"; // primera respuesta que es puro saludo ("buen día")

export interface DecisionClasificacion {
  /** Motivo por el que va a revisión manual, o null si se puede clasificar. */
  revisionManual: MotivoRevisionManual | null;
  /** VERDE si los emojis alcanzan para clasificar sin IA; null si decide la IA. */
  semaforoEmoji: Semaforo | null;
}

/**
 * Decide si una tanda de mensajes se clasifica sola, la analiza la IA, o va a
 * revisión manual.
 *
 * `contenidos` son los textos ORIGINALES, uno por mensaje: el consolidado los
 * numera ("(1) buen día") y no matchearía contra la lista de cortesías.
 */
export function decidirClasificacion(opciones: {
  contenidos: string[];
  textoConsolidado: string;
  esSeguimiento: boolean;
}): DecisionClasificacion {
  const { contenidos, textoConsolidado, esSeguimiento } = opciones;

  // Lo que no se pudo pasar a texto: media sin soportar o audio ilegible.
  if (/^\[(mensaje de tipo .+|audio.*)\]$/.test(textoConsolidado.trim())) {
    return { revisionManual: "no-textual", semaforoEmoji: null };
  }

  // SOLO emojis: los deciden las reglas de emoji y NADIE MÁS. Es importante que
  // corten acá: 👍 también figura en la lista de cortesías (para poder ignorar
  // el 👍 con el que el cliente contesta nuestro agradecimiento), y si la regla
  // de cortesía llegara a mirarlo, un pulgar arriba terminaría en revisión
  // manual en vez de VERDE.
  const soloEmoji = contenidos.length > 0 && contenidos.every((c) => esSoloEmoji(c));
  if (soloEmoji) {
    const semaforoEmoji = sentimientoSoloEmoji(contenidos);
    return semaforoEmoji === null
      ? { revisionManual: "reaccion-ambigua", semaforoEmoji: null }
      : { revisionManual: null, semaforoEmoji };
  }

  // PRIMERA respuesta que es puro saludo. No es una opinión y no se puede
  // puntuar: mandada a la IA vuelve como positiva (pasó de verdad, un "Buen día"
  // quedó VERDE) y el cliente queda contado como conforme sin haber dicho nada.
  if (!esSeguimiento && contenidos.length > 0 && contenidos.every((c) => esSoloCortesia(c))) {
    return { revisionManual: "solo-cortesia", semaforoEmoji: null };
  }

  return { revisionManual: null, semaforoEmoji: null };
}

// ---------- ¿Le mandamos un mensaje automático? ----------
//
// Es la decisión más delicada del sistema: lo que sale de acá le llega a un
// cliente real, y una de las variantes le pide que puntúe la encuesta de fábrica
// con 5. Por eso vive en una función sola y se prueba aparte.

export type TonoAgradecimiento =
  | "PROMOTOR" // cliente conforme: agradecimiento + recordatorio de puntuar con 5
  | "EMPATICO"; // cliente con alguna objeción: se le ofrece que Calidad lo contacte

export type DecisionAgradecimiento =
  | { enviar: false; motivo: string }
  | { enviar: true; tono: TonoAgradecimiento };

/**
 * Qué mensaje automático corresponde según cómo quedó clasificado el caso.
 *
 * REGLA DE FONDO: sin una clasificación explícita NO sale nada. Antes, un caso
 * "sin clasificar" caía en la misma rama que un cliente conforme y se llevaba el
 * pedido de 5 puntos igual. Le llegó a alguien que solo había escrito "cuando
 * vaya lo charlamos, gracias", y al día siguiente mandó un reclamo largo.
 *
 * El silencio es la opción segura: el caso queda en Seguimiento con su cartel de
 * aviso y una persona le contesta lo que corresponda.
 */
export function decidirAgradecimiento(analisis: {
  semaforo: Semaforo | null;
  requiereRevisionManual: boolean;
}): DecisionAgradecimiento {
  if (analisis.semaforo === null) {
    return { enviar: false, motivo: "el caso quedó sin clasificar: lo revisa una persona" };
  }
  // Un positivo que la IA no terminó de confirmar tampoco alcanza para pedir 5
  // puntos. Los negativos sí se mandan aunque estén marcados para revisar: ese
  // mensaje no pide nada, solo ofrece que Calidad lo contacte.
  if (analisis.semaforo === Semaforo.VERDE && analisis.requiereRevisionManual) {
    return { enviar: false, motivo: "cliente conforme sin confirmar: lo revisa una persona" };
  }
  if (analisis.semaforo === Semaforo.VERDE) return { enviar: true, tono: "PROMOTOR" };
  return { enviar: true, tono: "EMPATICO" };
}

// ---------- Gravedad comparable ----------
// Para decidir si una respuesta posterior EMPEORA lo que ya sabíamos del caso.

export function rangoSemaforo(s: Semaforo | null): number {
  if (s === Semaforo.ROJO) return 3;
  if (s === Semaforo.AMARILLO) return 2;
  if (s === Semaforo.VERDE) return 1;
  return 0; // sin clasificar
}

/** El análisis que "cuenta" del caso (el que ven reportes, rankings y pantallas). */
export async function analisisPrincipal(casoId: string) {
  return prisma.sentimentAnalysis.findFirst({
    where: { casoId, esSeguimiento: false },
    orderBy: { analyzedAt: "desc" },
  });
}
