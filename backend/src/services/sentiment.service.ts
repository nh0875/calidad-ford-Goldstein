import Anthropic from "@anthropic-ai/sdk";
import { Semaforo, Severidad } from "@prisma/client";
import { z } from "zod";
import { env } from "../config/env";
import { marca, usaEstrellas } from "../config/marca";
import { tieneEmojiNegativo } from "./analisis.service";
import { ITEMS_POSVENTA } from "../config/posventa-vw";
import { PuntajeItem } from "./encuesta-posventa.service";
import { esquemaItemsIA, leerPuntajesDeLista, normalizarPuntajes, promptItemsPosventa } from "./posventa-items.service";

/**
 * Confianza MÍNIMA para dar por bueno un caso positivo (VERDE / 5 estrellas).
 *
 * Por debajo de esto el caso NO se clasifica: queda para que lo mire una persona
 * en Seguimiento y no se le manda ningún mensaje automático.
 *
 * Existe porque a un cliente "conforme" el sistema le pide que puntúe la
 * encuesta de fábrica con 5, y ese pedido no se puede mandar sobre una
 * corazonada. Pasó de verdad: un cliente contestó "cuando vaya lo charlamos,
 * gracias", la IA lo leyó como conforme, le llegó el pedido de 5 puntos, y al
 * día siguiente mandó un reclamo largo.
 *
 * Aplica SOLO a lo positivo. Una queja con poca confianza se deja clasificada
 * igual: escalar de más se corrige en un minuto, pedirle 5 puntos a alguien
 * enojado no se corrige nunca.
 */
export const CONFIANZA_MINIMA_POSITIVO = 0.8;

/**
 * Aplica la barrera: si la IA dio un resultado POSITIVO sin llegar a la
 * confianza mínima, el caso se devuelve SIN CLASIFICAR y marcado para que lo
 * mire una persona.
 *
 * No se pisa lo que entendió la IA: su lectura queda dentro del resumen, para
 * que quien lo revise en Seguimiento vea de dónde venía la duda.
 *
 * Devuelve el mismo objeto cuando no hay nada que bajar, así el flujo normal no
 * paga nada.
 */
export function aplicarBarreraDeConfianza(
  resultado: ResultadoAnalisis,
  textoCliente?: string
): ResultadoAnalisis {
  if (resultado.semaforo !== Semaforo.VERDE) return resultado;

  const sinConfianza = resultado.confianza < CONFIANZA_MINIMA_POSITIVO;
  // Freno de mano: si el cliente puso un pulgar para abajo (o 😡, 😭…), el caso
  // no puede quedar en verde por más que la IA lea bien el resto del mensaje.
  const conEmojiNegativo = textoCliente ? tieneEmojiNegativo(textoCliente) : false;
  if (!sinConfianza && !conEmojiNegativo) return resultado;

  const pct = Math.round(resultado.confianza * 100);
  const minimo = Math.round(CONFIANZA_MINIMA_POSITIVO * 100);
  const motivo = conEmojiNegativo
    ? "La IA lo leyó como cliente conforme, pero el mensaje trae un emoji negativo " +
      "(un pulgar para abajo o similar), así que no se clasificó ni se le mandó nada."
    : `La IA lo leyó como cliente conforme pero con solo ${pct}% de confianza ` +
      `(hace falta ${minimo}%), así que no se clasificó ni se le mandó nada.`;
  return {
    ...resultado,
    semaforo: null,
    severidad: null,
    estrellas: null,
    requiereRQR: false,
    requiereRevisionManual: true,
    resumen: `${motivo} Lo que entendió: ${resultado.resumen}`,
  };
}

// ---------- Categorías de causa raíz (lista cerrada, editable acá) ----------

export const CATEGORIAS_CAUSA_RAIZ = [
  "DEMORA_SERVICIO",
  "MAL_TRATO_PERSONAL",
  "PRECIO_FACTURACION",
  "CALIDAD_TRABAJO",
  "FALTA_COMUNICACION",
  "REPUESTOS",
  "OTRO",
] as const;

// ---------- Tipos ----------

export interface ContextoCaso {
  nombreCliente: string;
  modelo: string;
  asesor: string;
  fechaServicio: string; // ya formateada dd/mm/aaaa o "-"
  comentarioAsesor: string | null;
}

export interface ResultadoAnalisis {
  semaforo: Semaforo | null; // null solo cuando la IA no devolvió nada interpretable
  severidad: Severidad | null; // gravedad del malestar (independiente de la confianza)
  // Puntaje 1-5 en las marcas que miden por estrellas (Volkswagen); null en Ford.
  // Cuando hay estrellas, el semáforo y la severidad de arriba se DERIVAN de
  // ellas: son el mismo hecho expresado en dos escalas, no dos opiniones.
  estrellas: number | null;
  confianza: number;
  categoriaCausaRaiz: string | null;
  resumen: string;
  requiereRQR: boolean;
  requiereRevisionManual: boolean;
  respuestaCruda: unknown; // lo que devolvió el modelo (o el mock), para auditoría
}

// ---------- Estrellas (Volkswagen) ----------

/**
 * Traduce un puntaje de estrellas al semáforo y la severidad equivalentes.
 *
 * POR QUÉ: el sistema entero está construido sobre el semáforo — los avisos en
 * pantalla, qué mensaje de agradecimiento se manda, los filtros de Seguimiento,
 * los reportes y la apertura automática de RQR. Si en Volkswagen guardáramos
 * SOLO estrellas, todo eso quedaría vacío y habría que reescribirlo.
 *
 * Guardando las dos escalas, VW muestra estrellas y el resto del sistema sigue
 * funcionando sin tocar una línea. El mapeo se eligió para que coincida con la
 * regla de negocio de VW ("todo lo que no sea 5 abre RQR"): 5 es el único que
 * cae en VERDE, y como cualquier AMARILLO o ROJO ya abre RQR (aplicarReglaRQR),
 * la regla sale sola sin un caso especial.
 */
export function derivarDeEstrellas(estrellas: number): {
  semaforo: Semaforo;
  severidad: Severidad | null;
} {
  switch (estrellas) {
    case 5:
      return { semaforo: Semaforo.VERDE, severidad: null };
    case 4:
      return { semaforo: Semaforo.AMARILLO, severidad: Severidad.LEVE };
    case 3:
      return { semaforo: Semaforo.AMARILLO, severidad: Severidad.MODERADA };
    case 2:
      return { semaforo: Semaforo.ROJO, severidad: Severidad.MODERADA };
    default: // 1 (y cualquier valor fuera de rango que se haya colado)
      return { semaforo: Semaforo.ROJO, severidad: Severidad.GRAVE };
  }
}

/**
 * Inverso de derivarDeEstrellas: de semáforo+severidad al puntaje equivalente.
 * Solo lo usa el modo mock (que razona en semáforo) para poder probar el
 * circuito de Volkswagen sin gastar API. Devuelve null si la marca no usa
 * estrellas o si no hubo clasificación.
 */
function estrellasDesde(semaforo: Semaforo | null, severidad: Severidad | null): number | null {
  if (!usaEstrellas() || semaforo === null) return null;
  if (semaforo === Semaforo.VERDE) return 5;
  if (semaforo === Semaforo.AMARILLO) return severidad === Severidad.LEVE ? 4 : 3;
  return severidad === Severidad.GRAVE ? 1 : 2;
}

// El modelo sugiere semáforo y severidad, pero la REGLA DE NEGOCIO manda (en
// código, no delegada al modelo): CUALQUIER objeción abre RQR. ROJO y AMARILLO
// (con cualquier severidad, incluso LEVE) escalan a RQR automático; solo VERDE o
// "sin clasificar" (null) no abren. Decisión del área de Calidad: preferimos
// revisar de más antes que dejar pasar una queja porque el cliente también elogió
// algo. La severidad se sigue usando para priorizar/reportar, no para decidir la apertura.
export function aplicarReglaRQR(semaforo: Semaforo | null, _severidad: Severidad | null): boolean {
  return semaforo === Semaforo.ROJO || semaforo === Semaforo.AMARILLO;
}

// ---------- Validación de la respuesta del modelo ----------

const esquemaRespuestaIA = z.object({
  // Nullable: el modelo necesita poder decir "esto no es una opinión" (un saludo
  // suelto). Sin esta opción respondía con un color igual, y un "buen día"
  // terminaba contado como cliente conforme.
  semaforo: z.enum(["VERDE", "AMARILLO", "ROJO"]).nullable(),
  // Puede venir null/omitido: el parseo aplica un default defensivo por semáforo
  severidad: z.enum(["LEVE", "MODERADA", "GRAVE"]).nullish(),
  confianza: z.number().min(0).max(1),
  categoriaCausaRaiz: z.enum(CATEGORIAS_CAUSA_RAIZ).nullable(),
  resumen: z.string().min(1),
  // El modelo ya no decide el RQR (lo hace la regla en código); si lo manda igual, se ignora
  requiereRQR: z.boolean().nullish(),
  requiereRevisionManual: z.boolean(),
});

type RespuestaIA = z.infer<typeof esquemaRespuestaIA>;

// Volkswagen puntúa de 1 a 5 estrellas en vez de semáforo. El resto de los
// campos (causa raíz, resumen, confianza, revisión manual) son idénticos: lo
// único que cambia es la escala con la que se mide la satisfacción.
const esquemaRespuestaEstrellas = z.object({
  // Nullable por el mismo motivo que el semáforo: un saludo no tiene puntaje, y
  // forzar uno ensucia el promedio de la marca.
  estrellas: z.number().int().min(1).max(5).nullable(),
  confianza: z.number().min(0).max(1),
  categoriaCausaRaiz: z.enum(CATEGORIAS_CAUSA_RAIZ).nullable(),
  resumen: z.string().min(1),
  requiereRevisionManual: z.boolean(),
});

type RespuestaEstrellasIA = z.infer<typeof esquemaRespuestaEstrellas>;

function parsearJsonSeguro(texto: string): RespuestaIA | null {
  // El prompt pide JSON puro, pero por las dudas se tolera un bloque ```json ... ```
  const limpio = texto
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    const objeto = JSON.parse(limpio);
    const validado = esquemaRespuestaIA.safeParse(objeto);
    return validado.success ? validado.data : null;
  } catch {
    return null;
  }
}

function parsearJsonEstrellas(texto: string): RespuestaEstrellasIA | null {
  const limpio = texto
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    const validado = esquemaRespuestaEstrellas.safeParse(JSON.parse(limpio));
    return validado.success ? validado.data : null;
  } catch {
    return null;
  }
}

// El analisis parseado, en la escala que use la marca.
type ParseadoAnalisis =
  | { tipo: "semaforo"; datos: RespuestaIA }
  | { tipo: "estrellas"; datos: RespuestaEstrellasIA };

/** Parsea la respuesta del modelo con el esquema que corresponde a la marca. */
function parsearSegunMarca(texto: string): ParseadoAnalisis | null {
  if (usaEstrellas()) {
    const datos = parsearJsonEstrellas(texto);
    return datos ? { tipo: "estrellas", datos } : null;
  }
  const datos = parsearJsonSeguro(texto);
  return datos ? { tipo: "semaforo", datos } : null;
}

// ---------- Prompts ----------

const SYSTEM_PROMPT = `Sos el analista de calidad de una concesionaria Ford. Analizás respuestas de WhatsApp de clientes que pasaron por el taller de posventa y las clasificás para el área de Calidad.

CRITERIOS DE SEMÁFORO:
- VERDE: cliente satisfecho, SIN ninguna queja ni objeción. Solo elogios o conformidad.
- AMARILLO: alguna objeción, duda o satisfacción parcial (ej: "todo bien pero tardaron", "conforme aunque el precio me pareció alto").
- ROJO: insatisfacción clara, reclamo o problema serio: trato descortés, trabajo mal hecho, problema sin resolver, cobro que el cliente siente indebido o abusivo, o indignación.

REGLA CLAVE — MENSAJES MIXTOS (elogio + queja):
Cuando el mensaje mezcla cosas buenas y malas, GANA LA QUEJA. Calidad busca detectar problemas, no promediar.
- Un elogio a una persona puntual ("Eugenia 10 puntos", "el de repuestos un genio") NO hace VERDE al caso si el cliente TAMBIÉN se queja del precio, del servicio o del trabajo.
- Clasificá según la queja MÁS grave del mensaje, no según la parte positiva. Elogiar al personal no compensa un reclamo sobre el precio, la demora o la calidad del trabajo.
- Si hay una queja REAL sobre algo (no una observación trivial mencionada al pasar), la severidad es AL MENOS MODERADA (nunca LEVE), para que se abra el RQR y Calidad lo revise. Solo queda LEVE una objeción menor dentro de un mensaje por lo demás positivo (ej: "todo excelente, tardaron 5 minutos de más nomás").

TONO / PALABRAS QUE ELEVAN LA GRAVEDAD:
- "un robo", "una estafa", "un abuso", "una vergüenza", "me estafaron", "chorros" → indignación → ROJO.
- Queja de precio percibido como excesivo o injusto → mínimo AMARILLO MODERADA (categoría PRECIO_FACTURACION); con indignación ("robo"/"estafa") → ROJO.
- Que digan que NO le hicieron algo que correspondía y le cobraron igual → ROJO o AMARILLO GRAVE (según el enojo).

CATEGORÍAS DE CAUSA RAÍZ (usá exclusivamente una de estas, o null si el semáforo es VERDE o no hay causa identificable):
- DEMORA_SERVICIO: demoras en la entrega o en los turnos.
- MAL_TRATO_PERSONAL: trato descortés o mala atención de una persona.
- PRECIO_FACTURACION: quejas por precios, cobros o facturación.
- CALIDAD_TRABAJO: el trabajo quedó mal hecho o el problema persiste.
- FALTA_COMUNICACION: no avisaron, no informaron el estado, no devolvieron llamados.
- REPUESTOS: faltantes o demoras de repuestos.
- OTRO: causa identificable que no encaja en las anteriores.

SEVERIDAD DEL MALESTAR (campo "severidad": "LEVE" | "MODERADA" | "GRAVE"):
Mide qué tan grave es el malestar del cliente, INDEPENDIENTE de qué tan seguro estás de la clasificación. Es distinto de "confianza": podés estar 100% seguro de que algo es AMARILLO y aun así ser un malestar LEVE.
- LEVE: objeción menor, mencionada al pasar, sin enojo ni perjuicio real. Ej: "más o menos, tardaron un poco pero bueno" → AMARILLO, severidad LEVE.
- MODERADA: molestia concreta, el cliente se queja con intención aunque no haya sido grave. Ej: "me molestó bastante, tardaron mucho más de lo prometido aunque el trabajo quedó bien" → AMARILLO, severidad MODERADA.
- GRAVE: enojo claro, perjuicio concreto, o pérdida de confianza en la marca (esto normalmente ya es ROJO).
Para VERDE, severidad es null. Ante duda entre LEVE y MODERADA en un AMARILLO, elegí MODERADA.

EL VERDE SE GANA, NO SE REGALA (regla dura, la más importante):
VERDE significa que el cliente DIJO ALGO EXPLÍCITAMENTE BUENO sobre el servicio, la atención o el trabajo. Si no lo dijo, NO es VERDE, por más amable que suene el mensaje.
Poné "semaforo": null y "requiereRevisionManual": true —NUNCA VERDE— cuando el mensaje sea:
- Un saludo o una cortesía sola: "buen día", "hola", "gracias", "ok", "listo", "dale".
- Una respuesta que PATEA la conversación para después: "cuando vaya lo charlamos", "después te cuento", "lo hablamos en persona", "ahora no puedo", "te aviso".
- Coordinación o logística: "¿a qué hora abren?", "necesito un turno", "mañana paso".
- Un acuse de recibo sin opinión: "recibido", "me llegó", "ya está".
- Cualquier cosa que no se pueda leer como una opinión sobre cómo lo atendieron.
El motivo: al VERDE le sigue un mensaje automático que le pide al cliente que puntúe la encuesta de fábrica con 5. Pedirle 5 puntos a alguien que no dijo nada bueno —o que está a punto de quejarse— es peor que no escribirle nada. Ante CUALQUIER duda entre VERDE y dejarlo sin clasificar, dejalo sin clasificar: una persona lo mira y contesta.
Distinto es un saludo QUE ADEMÁS trae contenido ("buen día, me atendieron excelente"): eso sí se clasifica por lo que dice del servicio.
Y ojo: esto NO aplica a las quejas. Si el cliente se queja, clasificá AMARILLO o ROJO como corresponda; no lo dejes sin clasificar por las dudas.

REGLAS:
- "confianza" es tu certeza en la clasificación, de 0 a 1 (NO es la gravedad; para eso está "severidad").
- "requiereRevisionManual" es true si la respuesta es ambigua, muy corta (ej: "ok", "👍"), un saludo sin contenido, irónica sin certeza, o no es interpretable como opinión sobre el servicio.
- "resumen": 1 o 2 frases en español rioplatense neutro, para que una persona de Calidad entienda el caso de un vistazo. Si el mensaje era mixto, mencioná TANTO la queja como el elogio.

EJEMPLOS (muestran el formato de salida exacto):
Cliente: "Excelente atención, el auto quedó impecable. Muchas gracias!"
Salida: {"semaforo":"VERDE","severidad":null,"confianza":0.97,"categoriaCausaRaiz":null,"resumen":"Cliente muy conforme con la atención y el trabajo.","requiereRevisionManual":false}

Cliente: "Todo bien, pero tardaron más de lo que me habían dicho."
Salida: {"semaforo":"AMARILLO","severidad":"LEVE","confianza":0.85,"categoriaCausaRaiz":"DEMORA_SERVICIO","resumen":"Conforme en general, con una objeción por demora respecto a lo prometido.","requiereRevisionManual":false}

Cliente: "Me parece un robo que cobren casi $500.000 y ni siquiera cambiaron el filtro de aire y combustible. Igual Eugenia de recepción y el de repuestos, 10 puntos ambos."
Salida: {"semaforo":"ROJO","severidad":"GRAVE","confianza":0.9,"categoriaCausaRaiz":"PRECIO_FACTURACION","resumen":"Indignado por el precio (lo llama un robo) y porque no le habrían cambiado filtros que esperaba. Elogia al personal de recepción y repuestos, pero la queja de precio/trabajo es la que define el caso.","requiereRevisionManual":false}

Cliente: "Un desastre. Llevé el auto por un ruido y me lo devolvieron igual, no lo solucionó nadie."
Salida: {"semaforo":"ROJO","severidad":"GRAVE","confianza":0.95,"categoriaCausaRaiz":"CALIDAD_TRABAJO","resumen":"Problema sin resolver: llevó el auto por un ruido y se lo devolvieron igual.","requiereRevisionManual":false}

Cliente: "Buen día"
Salida: {"semaforo":null,"severidad":null,"confianza":0.2,"categoriaCausaRaiz":null,"resumen":"El cliente solo saludó, todavía no dio una opinión sobre el servicio.","requiereRevisionManual":true}

Cliente: "Cuando vaya, lo charlamos, gracias!"
Salida: {"semaforo":null,"severidad":null,"confianza":0.25,"categoriaCausaRaiz":null,"resumen":"El cliente deja la conversación para cuando vaya al taller; todavía no dijo nada sobre el servicio.","requiereRevisionManual":true}

Cliente: "Ok, gracias, cualquier cosa te aviso"
Salida: {"semaforo":null,"severidad":null,"confianza":0.2,"categoriaCausaRaiz":null,"resumen":"Acuse de recibo amable, sin opinión sobre la atención.","requiereRevisionManual":true}

Respondé ÚNICAMENTE con un objeto JSON válido con esta forma exacta, sin texto adicional antes ni después:
{"semaforo": "VERDE" | "AMARILLO" | "ROJO" | null, "severidad": "LEVE" | "MODERADA" | "GRAVE" | null, "confianza": number, "categoriaCausaRaiz": string | null, "resumen": string, "requiereRevisionManual": boolean}`;

const PROMPT_ESTRELLAS = `Sos el analista de calidad de una concesionaria ${marca.nombre}. Analizás respuestas de WhatsApp de clientes y las puntuás para el área de Calidad.

ESCALA DE ESTRELLAS (1 a 5, donde 5 es lo mejor):
- 5: cliente plenamente conforme, SIN ninguna queja ni objeción. Solo elogios o conformidad.
- 4: conforme, pero con una objeción MENOR mencionada al pasar (ej: "todo bien, tardaron 5 minutos de más nomás").
- 3: satisfacción parcial o molestia concreta: se queja con intención aunque el resultado no haya sido grave (ej: "tardaron mucho más de lo prometido, aunque el trabajo quedó bien").
- 2: insatisfecho, reclamo claro: trato descortés, trabajo mal hecho, cobro que siente indebido.
- 1: muy insatisfecho: indignación, problema sin resolver, pérdida de confianza en la marca.

REGLA CLAVE — MENSAJES MIXTOS (elogio + queja):
Cuando el mensaje mezcla cosas buenas y malas, GANA LA QUEJA. Calidad busca detectar problemas, no promediar.
- Un elogio a una persona puntual ("Eugenia 10 puntos", "el de repuestos un genio") NO sube a 5 el caso si el cliente TAMBIÉN se queja del precio, del servicio o del trabajo.
- Puntuá según la queja MÁS grave del mensaje, no según la parte positiva.
- El 5 se reserva para quien no planteó NINGUNA objeción. Ante la duda entre 5 y 4, elegí 4.

TONO / PALABRAS QUE BAJAN EL PUNTAJE:
- "un robo", "una estafa", "un abuso", "una vergüenza", "me estafaron", "chorros" → indignación → 1.
- Queja de precio percibido como excesivo o injusto → 3 o menos (categoría PRECIO_FACTURACION); con indignación → 1.
- Que digan que NO le hicieron algo que correspondía y le cobraron igual → 1 o 2.

CATEGORÍAS DE CAUSA RAÍZ (usá exclusivamente una de estas, o null si son 5 estrellas o no hay causa identificable):
- DEMORA_SERVICIO: demoras en la entrega o en los turnos.
- MAL_TRATO_PERSONAL: trato descortés o mala atención de una persona.
- PRECIO_FACTURACION: quejas por precios, cobros o facturación.
- CALIDAD_TRABAJO: el trabajo quedó mal hecho o el problema persiste.
- FALTA_COMUNICACION: no avisaron, no informaron el estado, no devolvieron llamados.
- REPUESTOS: faltantes o demoras de repuestos.
- OTRO: causa identificable que no encaja en las anteriores.

LAS 5 ESTRELLAS SE GANAN, NO SE REGALAN (regla dura, la más importante):
5 estrellas significa que el cliente DIJO ALGO EXPLÍCITAMENTE BUENO sobre el servicio, la atención o el trabajo. Si no lo dijo, NO son 5, por más amable que suene el mensaje.
Poné "estrellas": null y "requiereRevisionManual": true —NUNCA 5— cuando el mensaje sea:
- Un saludo o una cortesía sola: "buen día", "hola", "gracias", "ok", "listo", "dale".
- Una respuesta que PATEA la conversación para después: "cuando vaya lo charlamos", "después te cuento", "lo hablamos en persona", "ahora no puedo", "te aviso".
- Coordinación o logística: "¿a qué hora abren?", "necesito un turno", "mañana paso".
- Un acuse de recibo sin opinión: "recibido", "me llegó", "ya está".
- Cualquier cosa que no se pueda leer como una opinión sobre cómo lo atendieron.
El motivo: a las 5 estrellas les sigue un mensaje automático que le pide al cliente que puntúe la encuesta de fábrica con 5. Pedirle 5 puntos a alguien que no dijo nada bueno —o que está a punto de quejarse— es peor que no escribirle nada. Ante CUALQUIER duda entre 5 y dejarlo sin puntuar, dejalo sin puntuar: una persona lo mira y contesta.
Distinto es un saludo QUE ADEMÁS trae contenido ("buen día, me atendieron excelente"): eso sí se puntúa por lo que dice del servicio.
Y ojo: esto NO aplica a las quejas. Si el cliente se queja, puntuá 1, 2 o 3 como corresponda; no lo dejes sin puntuar por las dudas.

REGLAS:
- "confianza" es tu certeza en la puntuación, de 0 a 1. NO es el puntaje: podés estar 100% seguro de que algo merece 2 estrellas.
- "requiereRevisionManual" es true si la respuesta es ambigua, muy corta (ej: "ok", "👍"), un saludo sin contenido, irónica sin certeza, o no es interpretable como opinión sobre el servicio.
- "resumen": 1 o 2 frases en español rioplatense neutro, para que una persona de Calidad entienda el caso de un vistazo. Si el mensaje era mixto, mencioná TANTO la queja como el elogio.

EJEMPLOS (muestran el formato de salida exacto):
Cliente: "Excelente atención, el auto quedó impecable. Muchas gracias!"
Salida: {"estrellas":5,"confianza":0.97,"categoriaCausaRaiz":null,"resumen":"Cliente muy conforme con la atención y el trabajo.","requiereRevisionManual":false}

Cliente: "Todo bien, pero tardaron más de lo que me habían dicho."
Salida: {"estrellas":4,"confianza":0.85,"categoriaCausaRaiz":"DEMORA_SERVICIO","resumen":"Conforme en general, con una objeción por demora respecto a lo prometido.","requiereRevisionManual":false}

Cliente: "Me parece un robo que cobren casi $500.000 y ni siquiera cambiaron el filtro de aire. Igual Eugenia de recepción, 10 puntos."
Salida: {"estrellas":1,"confianza":0.9,"categoriaCausaRaiz":"PRECIO_FACTURACION","resumen":"Indignado por el precio (lo llama un robo) y porque no le habrían cambiado un filtro que esperaba. Elogia a la recepcionista, pero la queja de precio define el caso.","requiereRevisionManual":false}

Cliente: "Un desastre. Llevé el auto por un ruido y me lo devolvieron igual, no lo solucionó nadie."
Salida: {"estrellas":1,"confianza":0.95,"categoriaCausaRaiz":"CALIDAD_TRABAJO","resumen":"Problema sin resolver: llevó el auto por un ruido y se lo devolvieron igual.","requiereRevisionManual":false}

Cliente: "Buen día"
Salida: {"estrellas":null,"confianza":0.2,"categoriaCausaRaiz":null,"resumen":"El cliente solo saludó, todavía no dio una opinión sobre el servicio.","requiereRevisionManual":true}

Cliente: "Cuando vaya, lo charlamos, gracias!"
Salida: {"estrellas":null,"confianza":0.25,"categoriaCausaRaiz":null,"resumen":"El cliente deja la conversación para cuando vaya; todavía no dijo nada sobre el servicio.","requiereRevisionManual":true}

Cliente: "Ok, gracias, cualquier cosa te aviso"
Salida: {"estrellas":null,"confianza":0.2,"categoriaCausaRaiz":null,"resumen":"Acuse de recibo amable, sin opinión sobre la atención.","requiereRevisionManual":true}

Respondé ÚNICAMENTE con un objeto JSON válido con esta forma exacta, sin texto adicional antes ni después:
{"estrellas": 1 | 2 | 3 | 4 | 5 | null, "confianza": number, "categoriaCausaRaiz": string | null, "resumen": string, "requiereRevisionManual": boolean}`;

/**
 * Prompt del sistema segun la marca de esta instancia. Ford clasifica por
 * semaforo y Volkswagen puntua de 1 a 5 estrellas; el resto del analisis
 * (causa raiz, resumen, revision manual) es igual en las dos.
 */
function promptDelSistema(): string {
  return usaEstrellas() ? PROMPT_ESTRELLAS : SYSTEM_PROMPT;
}

const RECORDATORIO_ESTRICTO =
  "Tu respuesta anterior no fue JSON válido. Respondé EXCLUSIVAMENTE el objeto JSON pedido, sin explicaciones, sin markdown, sin ```.";

function construirMensajeUsuario(texto: string, contexto: ContextoCaso): string {
  return `CONTEXTO DEL CASO:
- Cliente: ${contexto.nombreCliente}
- Vehículo: ${contexto.modelo}
- Asesor de servicio: ${contexto.asesor}
- Fecha de salida del servicio: ${contexto.fechaServicio}
- Comentario del asesor: ${contexto.comentarioAsesor || "(sin comentario)"}

RESPUESTA DEL CLIENTE POR WHATSAPP:
"""
${texto}
"""`;
}

// ---------- Proveedores de IA ----------
// Mensaje simple (rol + texto), común a ambos proveedores.
interface MensajeIA {
  role: "user" | "assistant";
  content: string;
}

type Proveedor = "anthropic" | "gemini";

// --- Anthropic ---

const anthropic = new Anthropic({ apiKey: env.anthropicApiKey || "sin-configurar" });

async function llamarAnthropic(mensajes: MensajeIA[], sistema?: string): Promise<string> {
  const respuesta = await anthropic.messages.create({
    model: env.anthropicModel,
    max_tokens: 1024,
    system: sistema ?? promptDelSistema(),
    messages: mensajes,
  });
  const bloqueTexto = respuesta.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text"
  );
  return bloqueTexto?.text ?? "";
}

// --- Gemini (vía REST, sin dependencia extra) ---

export class GeminiApiError extends Error {
  status: number;
  reintenable: boolean;
  constructor(message: string, status: number, reintenable: boolean) {
    super(message);
    this.status = status;
    this.reintenable = reintenable;
  }
}

async function llamarGemini(mensajes: MensajeIA[], sistema?: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent?key=${env.geminiApiKey}`;
  const contents = mensajes.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  // Los modelos "thinking" (Gemini 2.5 / 3.x) razonan antes de responder y ese
  // razonamiento consume tokens del output: con poco presupuesto, el JSON sale
  // truncado. Para una tarea de extracción de JSON no queremos que "piense":
  // se desactiva el thinking en esos modelos y se deja margen de tokens.
  const soportaThinking = /2\.5|gemini-3|flash-latest/.test(env.geminiModel);
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: 2048,
    temperature: 0.2,
    ...(soportaThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sistema ?? promptDelSistema() }] },
        contents,
        generationConfig,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new GeminiApiError(
      `No se pudo conectar con Gemini: ${err instanceof Error ? err.message : String(err)}`,
      0,
      true
    );
  }

  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    // 429 (rate limit) y 5xx son transitorios; el resto, definitivos
    const reintenable = res.status === 429 || res.status >= 500;
    throw new GeminiApiError(`Gemini respondió ${res.status}: ${detalle.slice(0, 200)}`, res.status, reintenable);
  }

  const body: any = await res.json().catch(() => null);
  // Log de consumo de tokens (para monitorear costo del tier pago de Gemini)
  const u = body?.usageMetadata;
  if (u) {
    console.log(
      `[gemini] tokens: prompt=${u.promptTokenCount ?? "?"} salida=${u.candidatesTokenCount ?? 0} total=${u.totalTokenCount ?? "?"}`
    );
  }
  const partes = body?.candidates?.[0]?.content?.parts ?? [];
  return partes.map((p: { text?: string }) => p.text ?? "").join("");
}

// --- Transcripción de audios (notas de voz) con Gemini ---
// Gemini 2.5-flash acepta audio/ogg (opus, el formato de WhatsApp) directo por
// inlineData; probado que transcribe bien en español. SIEMPRE usa Gemini (Claude
// no acepta audio): si no hay GEMINI_API_KEY, tira error definitivo y el worker
// deja el audio en revisión manual (no lo pierde).
export async function transcribirAudio(bytes: Buffer, mimeType: string): Promise<string> {
  if (env.analisisModoMock) return "el servicio estuvo muy bien, gracias"; // mock para pruebas sin API

  if (!env.geminiApiKey) {
    throw new GeminiApiError("No hay GEMINI_API_KEY configurada para transcribir el audio.", 0, false);
  }
  // Gemini quiere el mime base ("audio/ogg"), sin el "; codecs=opus" que manda Meta.
  const mime = (mimeType || "audio/ogg").split(";")[0].trim() || "audio/ogg";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent?key=${env.geminiApiKey}`;
  const soportaThinking = /2\.5|gemini-3|flash-latest/.test(env.geminiModel);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text:
                  "Transcribí textualmente esta nota de voz de un cliente (está en español). Devolvé SOLO la " +
                  "transcripción, sin comillas ni comentarios. Si no se entiende ninguna palabra, devolvé exactamente: (sin audio reconocible).",
              },
              { inline_data: { mime_type: mime, data: bytes.toString("base64") } },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 1024,
          temperature: 0,
          ...(soportaThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new GeminiApiError(
      `No se pudo conectar con Gemini para transcribir: ${err instanceof Error ? err.message : String(err)}`,
      0,
      true
    );
  }

  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    const reintenable = res.status === 429 || res.status >= 500;
    throw new GeminiApiError(`Gemini (audio) respondió ${res.status}: ${detalle.slice(0, 200)}`, res.status, reintenable);
  }

  const body: any = await res.json().catch(() => null);
  const u = body?.usageMetadata;
  if (u) {
    console.log(
      `[gemini-audio] tokens: prompt=${u.promptTokenCount ?? "?"} salida=${u.candidatesTokenCount ?? 0} total=${u.totalTokenCount ?? "?"}`
    );
  }
  const partes = body?.candidates?.[0]?.content?.parts ?? [];
  return partes
    .map((p: { text?: string }) => p.text ?? "")
    .join("")
    .trim();
}

async function analizarConIA(
  texto: string,
  contexto: ContextoCaso,
  proveedor: Proveedor
): Promise<ResultadoAnalisis> {
  const llamarModelo = proveedor === "gemini" ? llamarGemini : llamarAnthropic;
  const mensajes: MensajeIA[] = [
    { role: "user", content: construirMensajeUsuario(texto, contexto) },
  ];

  // Primer intento
  const primerTexto = await llamarModelo(mensajes);
  let parseado = parsearSegunMarca(primerTexto);
  let crudo: unknown = primerTexto;

  // Si no devolvió JSON válido, un reintento con instrucción más estricta
  if (!parseado) {
    console.warn("[sentiment] la IA no devolvió JSON válido, reintentando con prompt estricto");
    const segundoTexto = await llamarModelo([
      ...mensajes,
      { role: "assistant", content: primerTexto || "(respuesta vacía)" },
      { role: "user", content: RECORDATORIO_ESTRICTO },
    ]);
    parseado = parsearSegunMarca(segundoTexto);
    crudo = { primerIntento: primerTexto, segundoIntento: segundoTexto };
  }

  // Doble fallo: queda para revisión manual, sin clasificar
  if (!parseado) {
    return {
      semaforo: null,
      severidad: null,
      estrellas: null,
      confianza: 0,
      categoriaCausaRaiz: null,
      resumen:
        "La IA no pudo clasificar esta respuesta (no devolvió un resultado interpretable). Requiere revisión manual de Calidad.",
      requiereRQR: false,
      requiereRevisionManual: true,
      respuestaCruda: crudo,
    };
  }

  // Volkswagen: el modelo devolvio estrellas. El semaforo y la severidad se
  // DERIVAN de ese puntaje para que el resto del sistema (avisos, agradecimientos,
  // filtros, apertura de RQR, reportes) siga funcionando sin cambios.
  if (parseado.tipo === "estrellas") {
    const { estrellas, confianza, categoriaCausaRaiz, resumen, requiereRevisionManual } = parseado.datos;
    // Sin puntaje = el modelo dijo que no es una opinión (un saludo suelto).
    // Queda sin clasificar y para revisión manual: no suma al promedio ni abre RQR.
    if (estrellas === null) {
      return {
        semaforo: null,
        severidad: null,
        estrellas: null,
        confianza,
        categoriaCausaRaiz,
        resumen,
        requiereRQR: false,
        requiereRevisionManual: true,
        respuestaCruda: crudo,
      };
    }
    const { semaforo, severidad } = derivarDeEstrellas(estrellas);
    return {
      semaforo,
      severidad,
      estrellas,
      confianza,
      categoriaCausaRaiz,
      resumen,
      // Con el mapeo de derivarDeEstrellas, "todo lo que no sea 5" cae en
      // AMARILLO o ROJO, asi que la regla de VW sale de la regla general.
      requiereRQR: aplicarReglaRQR(semaforo, severidad),
      requiereRevisionManual,
      respuestaCruda: crudo,
    };
  }

  const datos = parseado.datos;
  // Sin semáforo = el modelo dijo que no es una opinión (un saludo suelto).
  if (datos.semaforo === null) {
    return {
      semaforo: null,
      severidad: null,
      estrellas: null,
      confianza: datos.confianza,
      categoriaCausaRaiz: datos.categoriaCausaRaiz,
      resumen: datos.resumen,
      requiereRQR: false,
      requiereRevisionManual: true,
      respuestaCruda: crudo,
    };
  }
  const semaforo = Semaforo[datos.semaforo];
  // Default defensivo: si el modelo omite severidad en un AMARILLO, asumimos
  // MODERADA (preferimos un RQR de más antes que perder un reclamo real).
  const severidad: Severidad | null = datos.severidad
    ? Severidad[datos.severidad]
    : semaforo === Semaforo.AMARILLO
      ? Severidad.MODERADA
      : null;
  return {
    semaforo,
    severidad,
    estrellas: null,
    confianza: datos.confianza,
    categoriaCausaRaiz: datos.categoriaCausaRaiz,
    resumen: datos.resumen,
    requiereRQR: aplicarReglaRQR(semaforo, severidad),
    requiereRevisionManual: datos.requiereRevisionManual,
    respuestaCruda: crudo,
  };
}

// ---------- Modo mock (ANALISIS_MODO_MOCK=true) ----------
// Clasificación por palabras clave para probar todo el flujo sin gastar API.

function analizarMock(texto: string): ResultadoAnalisis {
  const t = texto.toLowerCase();

  const armar = (
    semaforo: Semaforo | null,
    severidad: Severidad | null,
    confianza: number,
    categoria: string | null,
    resumen: string,
    revisionManual = false
  ): ResultadoAnalisis => ({
    semaforo,
    severidad,
    estrellas: estrellasDesde(semaforo, severidad),
    confianza,
    categoriaCausaRaiz: categoria,
    resumen: `[MOCK] ${resumen}`,
    requiereRQR: aplicarReglaRQR(semaforo, severidad),
    requiereRevisionManual: revisionManual,
    respuestaCruda: { mock: true, texto },
  });

  // Ambiguo / demasiado corto -> revisión manual
  if (t.trim().length < 5 || ["ok", "si", "sí", "no", "👍"].includes(t.trim())) {
    return armar(null, null, 0, null, "Respuesta demasiado corta o ambigua para clasificar.", true);
  }

  // Negativo claro -> ROJO (severidad GRAVE)
  if (/(pésim|pesim|queja|reclamo|desastre|nunca más|mal trato|sin resolver|sucio|roto)/.test(t)) {
    let categoria = "CALIDAD_TRABAJO";
    if (/(cobr|precio|factur|caro)/.test(t)) categoria = "PRECIO_FACTURACION";
    else if (/(trato|atendieron mal|mala atención)/.test(t)) categoria = "MAL_TRATO_PERSONAL";
    else if (/(demora|tard|esper)/.test(t)) categoria = "DEMORA_SERVICIO";
    else if (/(repuesto)/.test(t)) categoria = "REPUESTOS";
    else if (/(no me avisaron|no informaron|no me llamaron)/.test(t)) categoria = "FALTA_COMUNICACION";
    return armar(Semaforo.ROJO, Severidad.GRAVE, 0.9, categoria, "Cliente claramente insatisfecho, corresponde reclamo formal.");
  }

  // Objeción -> AMARILLO. Severidad MODERADA si la objeción es marcada, LEVE si es al pasar.
  if (/(pero|aunque|demora|tard|esper)/.test(t)) {
    const marcada = /(bastante|mucho|demasiado|molest)/.test(t);
    return armar(
      Semaforo.AMARILLO,
      marcada ? Severidad.MODERADA : Severidad.LEVE,
      marcada ? 0.8 : 0.5,
      "DEMORA_SERVICIO",
      marcada
        ? "Objeción clara por demoras aunque el servicio se completó."
        : "Satisfacción parcial con una objeción menor por tiempos."
    );
  }

  // Positivo -> VERDE
  if (/(excelente|perfecto|muy bien|conforme|gracias|10 puntos|impecable)/.test(t)) {
    return armar(Semaforo.VERDE, null, 0.95, null, "Cliente satisfecho con el servicio, sin objeciones.");
  }

  // Sin señales claras -> AMARILLO leve con revisión manual (no escala a RQR)
  return armar(Semaforo.AMARILLO, Severidad.LEVE, 0.3, null, "No hay señales claras de satisfacción o queja.", true);
}

// ---------- Punto de entrada ----------

// ¿Hay alguna key de IA real cargada (Anthropic o Gemini)?
function hayIaReal(): boolean {
  return Boolean(env.anthropicApiKey) || Boolean(env.geminiApiKey);
}

// Elige el proveedor real a usar cuando SÍ hay al menos una key.
// Respeta AI_PROVIDER si está seteado y su key existe; si no, automático:
// el que tenga key (prefiriendo Anthropic por compatibilidad histórica).
function elegirProveedor(): Proveedor {
  if (env.aiProvider === "gemini" && env.geminiApiKey) return "gemini";
  if (env.aiProvider === "anthropic" && env.anthropicApiKey) return "anthropic";
  if (env.anthropicApiKey) return "anthropic";
  if (env.geminiApiKey) return "gemini";
  return "anthropic";
}

export async function analizarRespuesta(
  texto: string,
  contexto: ContextoCaso
): Promise<ResultadoAnalisis> {
  // Override explícito de siempre: mock por palabras clave (comportamiento actual).
  if (env.analisisModoMock) {
    return analizarMock(texto);
  }
  // PRIORIDAD: si hay CUALQUIER key de IA real, se usa de verdad — incluso con
  // MODO_DEMO=true. El mock de análisis solo entra cuando NO hay ninguna key.
  if (hayIaReal()) {
    return analizarConIA(texto, contexto, elegirProveedor());
  }
  // Sin ninguna key: en modo demo se simula (para poder mostrar el flujo); fuera
  // de demo se intenta Anthropic y falla como hasta hoy (comportamiento actual).
  if (env.modoDemo) {
    return analizarMock(texto);
  }
  return analizarConIA(texto, contexto, "anthropic");
}

/**
 * Describe qué motor de análisis quedó activo con la configuración actual, para
 * loguearlo al arrancar y que nunca haya un "mock silencioso": si se esperaba
 * IA real y no hay key, se ve en los logs.
 */
export function modoAnalisisActivo(): { modo: "mock" | "anthropic" | "gemini"; motivo: string } {
  if (env.analisisModoMock) return { modo: "mock", motivo: "ANALISIS_MODO_MOCK=true" };
  if (hayIaReal()) {
    const p = elegirProveedor();
    return { modo: p, motivo: `key de ${p} presente${env.aiProvider ? ` (AI_PROVIDER=${env.aiProvider})` : ""}` };
  }
  if (env.modoDemo) return { modo: "mock", motivo: "MODO_DEMO sin ninguna API key de IA cargada" };
  return { modo: "anthropic", motivo: "sin API key (fallará al llamar)" };
}

/** true si conviene reintentar el job (rate limit, error transitorio de la IA o de red) */
export function esErrorReintenable(err: unknown): boolean {
  if (err instanceof GeminiApiError) return err.reintenable;
  if (err instanceof Anthropic.RateLimitError) return true;
  if (err instanceof Anthropic.InternalServerError) return true;
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (err instanceof Anthropic.APIError) return false; // 4xx definitivos (auth, request inválida)
  return false;
}

/**
 * true si el error es un 429 de cuota por minuto (Gemini free tier o Anthropic
 * rate limit). Reintentar rápido no sirve: hay que esperar a que se reabra la
 * ventana, así que el job usa un backoff largo (60-90s) para estos.
 */
export function esErrorCuota(err: unknown): boolean {
  if (err instanceof GeminiApiError) return err.status === 429;
  if (err instanceof Anthropic.RateLimitError) return true;
  return false;
}


// ---------------------------------------------------------------------------
// Encuesta de Posventa por ítems (Volkswagen)
// ---------------------------------------------------------------------------

/**
 * Lee la respuesta del cliente y devuelve un puntaje por ítem.
 *
 * Primero prueba el parser sin IA: la mayoría contesta "5 4 5 3 4" y eso es
 * inequívoco, no tiene sentido gastar una llamada ni arriesgar que el modelo se
 * equivoque en algo que es literalmente una lista de números.
 *
 * Devuelve null si no se pudo leer nada: el caso queda para revisión manual en
 * vez de inventar puntajes, porque un puntaje inventado ensucia el promedio del
 * área y ahí ya nadie lo puede distinguir de uno real.
 */
export async function analizarItemsPosventa(
  texto: string
): Promise<{ puntajes: PuntajeItem[]; confianza: number; resumen: string; crudo: unknown } | null> {
  // 1) Sin IA, cuando es una lista de números.
  const deLista = leerPuntajesDeLista(texto);
  if (deLista) {
    return {
      puntajes: deLista,
      confianza: 1,
      resumen: "El cliente puntuó los 5 ítems.",
      crudo: { motivo: "lista-de-numeros", texto },
    };
  }

  // 2) Con IA.
  if (env.analisisModoMock || (!hayIaReal() && env.modoDemo)) {
    return analizarItemsMock(texto);
  }
  const proveedor = hayIaReal() ? elegirProveedor() : "anthropic";
  const llamarModelo = proveedor === "gemini" ? llamarGemini : llamarAnthropic;
  const sistema = promptItemsPosventa();

  let crudo = "";
  try {
    crudo = await llamarModelo([{ role: "user", content: `Respuesta del cliente:
"""${texto}"""` }], sistema);
  } catch (err) {
    console.error("[posventa-items] falló la llamada a la IA:", err instanceof Error ? err.message : err);
    return null;
  }

  const limpio = crudo.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let objeto: unknown;
  try {
    objeto = JSON.parse(limpio);
  } catch {
    console.warn("[posventa-items] la IA no devolvió JSON válido");
    return null;
  }
  const validado = esquemaItemsIA.safeParse(objeto);
  if (!validado.success) {
    console.warn("[posventa-items] el JSON de la IA no tiene la forma esperada");
    return null;
  }

  return {
    puntajes: normalizarPuntajes(validado.data.puntajes),
    confianza: validado.data.confianza,
    resumen: validado.data.resumen,
    crudo,
  };
}

/** Modo simulado: puntúa por palabras clave, para probar el circuito sin API. */
function analizarItemsMock(texto: string) {
  const t = texto.toLowerCase();
  const malo = /(desastre|pesim|sucio|mal|nunca|queja|tarde|demor)/.test(t);
  const bueno = /(excelente|impecable|perfecto|muy bien|de diez|barbaro)/.test(t);
  const base = malo ? 2 : bueno ? 5 : 4;
  return {
    puntajes: normalizarPuntajes(
      ITEMS_POSVENTA.map((item) => ({
        item,
        // El mock solo puntúa el general: inventar los otros 4 daría una idea
        // falsa de que el circuito por ítems anda cuando en realidad no se probó.
        estrellas: item === "GENERAL" ? base : null,
        comentario: null,
      }))
    ),
    confianza: 0.5,
    resumen: `[MOCK] Lectura simulada (${base} estrellas en general).`,
    crudo: { mock: true, texto },
  };
}
