import Anthropic from "@anthropic-ai/sdk";
import { Semaforo, Severidad } from "@prisma/client";
import { z } from "zod";
import { env } from "../config/env";

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
  confianza: number;
  categoriaCausaRaiz: string | null;
  resumen: string;
  requiereRQR: boolean;
  requiereRevisionManual: boolean;
  respuestaCruda: unknown; // lo que devolvió el modelo (o el mock), para auditoría
}

// El modelo sugiere semáforo y severidad, pero la REGLA DE NEGOCIO manda (en
// código, no delegada al modelo): ROJO siempre abre RQR; AMARILLO solo si la
// severidad es MODERADA o GRAVE (un AMARILLO LEVE no escala a RQR automático,
// aunque el modelo esté muy seguro de la clasificación). La confianza ya NO
// decide la apertura: mide certeza del análisis, no gravedad del reclamo.
export function aplicarReglaRQR(semaforo: Semaforo | null, severidad: Severidad | null): boolean {
  if (semaforo === Semaforo.ROJO) return true;
  if (semaforo === Semaforo.AMARILLO) {
    return severidad === Severidad.MODERADA || severidad === Severidad.GRAVE;
  }
  return false;
}

// ---------- Validación de la respuesta del modelo ----------

const esquemaRespuestaIA = z.object({
  semaforo: z.enum(["VERDE", "AMARILLO", "ROJO"]),
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

// ---------- Prompts ----------

const SYSTEM_PROMPT = `Sos el analista de calidad de una concesionaria Ford. Analizás respuestas de WhatsApp de clientes que pasaron por el taller de posventa y las clasificás para el área de Calidad.

CRITERIOS DE SEMÁFORO:
- VERDE: cliente satisfecho, sin problemas.
- AMARILLO: alguna objeción menor, duda, o satisfacción parcial (ej: "todo bien pero tardaron", "conforme aunque el precio me pareció alto").
- ROJO: insatisfacción clara, reclamo, o problema serio (ej: trato descortés, trabajo mal hecho, problema sin resolver, cobro indebido).

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

REGLAS:
- "confianza" es tu certeza en la clasificación, de 0 a 1 (NO es la gravedad; para eso está "severidad").
- "requiereRevisionManual" es true si la respuesta es ambigua, muy corta (ej: "ok", "👍"), irónica sin certeza, o no es interpretable como opinión sobre el servicio.
- "resumen": 1 o 2 frases en español rioplatense neutro, para que una persona de Calidad entienda el caso de un vistazo.

Respondé ÚNICAMENTE con un objeto JSON válido con esta forma exacta, sin texto adicional antes ni después:
{"semaforo": "VERDE" | "AMARILLO" | "ROJO", "severidad": "LEVE" | "MODERADA" | "GRAVE" | null, "confianza": number, "categoriaCausaRaiz": string | null, "resumen": string, "requiereRevisionManual": boolean}`;

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

async function llamarAnthropic(mensajes: MensajeIA[]): Promise<string> {
  const respuesta = await anthropic.messages.create({
    model: env.anthropicModel,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
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

async function llamarGemini(mensajes: MensajeIA[]): Promise<string> {
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
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
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
  let parseado = parsearJsonSeguro(primerTexto);
  let crudo: unknown = primerTexto;

  // Si no devolvió JSON válido, un reintento con instrucción más estricta
  if (!parseado) {
    console.warn("[sentiment] la IA no devolvió JSON válido, reintentando con prompt estricto");
    const segundoTexto = await llamarModelo([
      ...mensajes,
      { role: "assistant", content: primerTexto || "(respuesta vacía)" },
      { role: "user", content: RECORDATORIO_ESTRICTO },
    ]);
    parseado = parsearJsonSeguro(segundoTexto);
    crudo = { primerIntento: primerTexto, segundoIntento: segundoTexto };
  }

  // Doble fallo: queda para revisión manual, sin clasificar
  if (!parseado) {
    return {
      semaforo: null,
      severidad: null,
      confianza: 0,
      categoriaCausaRaiz: null,
      resumen:
        "La IA no pudo clasificar esta respuesta (no devolvió un resultado interpretable). Requiere revisión manual de Calidad.",
      requiereRQR: false,
      requiereRevisionManual: true,
      respuestaCruda: crudo,
    };
  }

  const semaforo = Semaforo[parseado.semaforo];
  // Default defensivo: si el modelo omite severidad en un AMARILLO, asumimos
  // MODERADA (preferimos un RQR de más antes que perder un reclamo real).
  const severidad: Severidad | null = parseado.severidad
    ? Severidad[parseado.severidad]
    : semaforo === Semaforo.AMARILLO
      ? Severidad.MODERADA
      : null;
  return {
    semaforo,
    severidad,
    confianza: parseado.confianza,
    categoriaCausaRaiz: parseado.categoriaCausaRaiz,
    resumen: parseado.resumen,
    requiereRQR: aplicarReglaRQR(semaforo, severidad),
    requiereRevisionManual: parseado.requiereRevisionManual,
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
