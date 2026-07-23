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
 * del cuerpo del template en orden: nombre, modelo, fecha de salida.
 */
export async function sendTemplateMessage(
  telefono: string,
  variables: string[]
): Promise<RespuestaEnvio & { templateName: string }> {
  const creds = await obtenerCredencialesMeta();
  const r = await llamarGraphApi(creds, {
    messaging_product: "whatsapp",
    to: telefono,
    type: "template",
    template: {
      name: creds.templateName,
      language: { code: creds.templateLang },
      components: [
        {
          type: "body",
          parameters: variables.map((texto) => ({ type: "text", text: texto })),
        },
      ],
    },
  });
  return { ...r, templateName: creds.templateName };
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
