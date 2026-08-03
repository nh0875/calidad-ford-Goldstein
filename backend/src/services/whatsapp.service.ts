import { randomUUID } from "crypto";
import { env } from "../config/env";
import { CredencialesMeta, obtenerCredencialesMeta } from "./configuracion.service";

// Cliente de la Meta WhatsApp Cloud API (Graph API v20.0).
// La URL base es configurable por env para poder apuntar a un mock en pruebas.

export class WhatsappApiError extends Error {
  status: number;
  metaCode: number | null;
  /** true = conviene reintentar (rate limit, timeout, 5xx); false = error definitivo (número inválido, template mal, credenciales) */
  reintenable: boolean;

  constructor(message: string, status: number, metaCode: number | null, reintenable: boolean) {
    super(message);
    this.status = status;
    this.metaCode = metaCode;
    this.reintenable = reintenable;
  }
}

// Códigos de Meta que indican problemas transitorios (reintentar con backoff)
const CODIGOS_REINTENTABLES = new Set([
  130429, // Rate limit hit (throughput)
  131048, // Spam rate limit
  131056, // Pair rate limit
  80007, // Rate limit del app
  1, // API Unknown (suele ser transitorio)
  2, // API Service (caída temporal de Meta)
]);

interface RespuestaEnvio {
  waMessageId: string;
}

async function llamarGraphApi(
  creds: CredencialesMeta,
  payload: Record<string, unknown>
): Promise<RespuestaEnvio> {
  // MODO DEMO: se simula un envío exitoso sin tocar la red ni requerir
  // credenciales de Meta. El caso se marca ENVIADO igual que en producción.
  if (env.modoDemo) {
    const waMessageId = `demo-out-${randomUUID()}`;
    console.log(`[whatsapp][DEMO] envío simulado (${payload.type}) → ${waMessageId}`);
    return { waMessageId };
  }

  // Sin credenciales: error DEFINITIVO con mensaje claro (se cargan en /configuracion).
  if (!creds.token || !creds.phoneNumberId) {
    throw new WhatsappApiError(
      "Faltan configurar las credenciales de WhatsApp en Configuración (token y phone number ID de Meta). " +
        "Hasta que no se carguen, no se pueden enviar mensajes.",
      0,
      null,
      false
    );
  }

  const url = `${creds.graphBaseUrl}/${creds.phoneNumberId}/messages`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    // Error de red o timeout: siempre reintentable
    throw new WhatsappApiError(
      `No se pudo conectar con la API de WhatsApp: ${err instanceof Error ? err.message : String(err)}`,
      0,
      null,
      true
    );
  }

  let body: any = null;
  try {
    body = await res.json();
  } catch {
    // respuesta sin JSON
  }

  if (!res.ok) {
    const metaCode: number | null = body?.error?.code ?? null;
    const detalle = body?.error?.message ?? `HTTP ${res.status}`;
    const reintenable =
      res.status === 429 || res.status >= 500 || (metaCode !== null && CODIGOS_REINTENTABLES.has(metaCode));
    throw new WhatsappApiError(
      `La API de WhatsApp rechazó el mensaje: ${detalle}`,
      res.status,
      metaCode,
      reintenable
    );
  }

  const waMessageId = body?.messages?.[0]?.id;
  if (!waMessageId) {
    throw new WhatsappApiError(
      "La API de WhatsApp respondió sin identificador de mensaje (respuesta inesperada).",
      res.status,
      null,
      true
    );
  }
  return { waMessageId };
}

/**
 * Envía un mensaje de template (necesario para iniciar la conversación
 * fuera de la ventana de 24 hs). `variables` completa los placeholders
 * {{1}}, {{2}}, ... del cuerpo, EN ESE ORDEN.
 *
 * IMPORTANTE: la cantidad tiene que coincidir EXACTAMENTE con la que tiene
 * aprobada la plantilla en Meta. Si la plantilla no tiene placeholders (texto
 * fijo), hay que mandar el array vacío y NO incluir el componente "body":
 * mandar un body con parámetros de más (o vacío) hace que Meta rechace el
 * envío con el error 132000 ("number of parameters does not match").
 */
export async function sendTemplateMessage(
  telefono: string,
  variables: string[],
  // Override opcional de la plantilla (nombre + idioma). Por defecto usa la de
  // contacto POSVENTA (creds.templateName / templateLang). Cada caso pasa la que
  // le corresponde: Ventas la suya, Fidelización la suya. IMPORTANTE: el idioma
  // tiene que ser EXACTAMENTE el que esa plantilla tiene aprobado en Meta, o el
  // envío falla con 132001 ("template does not exist in this language").
  override?: { name?: string; lang?: string }
): Promise<RespuestaEnvio & { templateName: string }> {
  const creds = await obtenerCredencialesMeta();
  const templateName = override?.name || creds.templateName;
  const templateLang = override?.lang || creds.templateLang;
  const r = await llamarGraphApi(creds, {
    messaging_product: "whatsapp",
    to: telefono,
    type: "template",
    template: {
      name: templateName,
      language: { code: templateLang },
      // Sin variables → se omite "components" por completo.
      ...(variables.length > 0
        ? {
            components: [
              {
                type: "body",
                parameters: variables.map((texto) => ({ type: "text", text: texto })),
              },
            ],
          }
        : {}),
    },
  });
  return { ...r, templateName };
}

/**
 * Envía texto libre (solo válido dentro de la ventana de 24 hs
 * posterior a la última respuesta del cliente).
 */
export async function sendTextMessage(telefono: string, texto: string): Promise<RespuestaEnvio> {
  const creds = await obtenerCredencialesMeta();
  return llamarGraphApi(creds, {
    messaging_product: "whatsapp",
    to: telefono,
    type: "text",
    text: { body: texto },
  });
}

/**
 * Baja un archivo de media de Meta (ej. una nota de voz) por su id. Son DOS
 * pasos: 1) GET /{mediaId} devuelve una URL temporal (~5 min) + el mime;
 * 2) GET de esa URL (host de Meta) con el mismo Bearer trae los bytes.
 * La usa el worker de análisis para transcribir audios con Gemini.
 */
export async function descargarMedia(mediaId: string): Promise<{ bytes: Buffer; mimeType: string }> {
  if (env.modoDemo) {
    throw new WhatsappApiError("No se puede bajar media en MODO_DEMO.", 0, null, false);
  }
  const creds = await obtenerCredencialesMeta();
  if (!creds.token) {
    throw new WhatsappApiError("Falta el token de Meta para bajar la nota de voz.", 0, null, false);
  }

  // 1) Metadata: la URL temporal de descarga + el mime.
  let metaRes: Response;
  try {
    metaRes = await fetch(`${creds.graphBaseUrl}/${mediaId}`, {
      headers: { Authorization: `Bearer ${creds.token}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new WhatsappApiError(
      `No se pudo consultar la media: ${err instanceof Error ? err.message : String(err)}`,
      0,
      null,
      true
    );
  }
  if (!metaRes.ok) {
    const reintenable = metaRes.status === 429 || metaRes.status >= 500;
    throw new WhatsappApiError(`Meta respondió ${metaRes.status} al pedir la media.`, metaRes.status, null, reintenable);
  }
  const meta: any = await metaRes.json().catch(() => null);
  const url: string | undefined = meta?.url;
  const mimeType: string = meta?.mime_type ?? "audio/ogg";
  if (!url) throw new WhatsappApiError("La media no trae URL de descarga.", metaRes.status, null, false);

  // 2) Descargar los bytes (URL de Meta; requiere el mismo Bearer).
  let fileRes: Response;
  try {
    fileRes = await fetch(url, {
      headers: { Authorization: `Bearer ${creds.token}` },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new WhatsappApiError(
      `No se pudo descargar la media: ${err instanceof Error ? err.message : String(err)}`,
      0,
      null,
      true
    );
  }
  if (!fileRes.ok) {
    const reintenable = fileRes.status === 429 || fileRes.status >= 500;
    throw new WhatsappApiError(`La descarga de la media respondió ${fileRes.status}.`, fileRes.status, null, reintenable);
  }
  const bytes = Buffer.from(await fileRes.arrayBuffer());
  return { bytes, mimeType };
}
