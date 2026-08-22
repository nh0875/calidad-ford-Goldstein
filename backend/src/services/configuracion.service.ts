import { AreaTrabajo } from "@prisma/client";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { cifradoDisponible, cifrar, descifrar } from "./cripto.service";
import { marca } from "../config/marca";
import { textoPreguntasPorDefecto } from "../config/posventa-vw";

// Configuración editable (clave→valor en la tabla Configuracion). Parte A guarda
// acá los textos de los mensajes automáticos y sus toggles, editables desde
// /configuracion, con valores por defecto si nunca se tocaron.

export const CLAVES_CONFIG = {
  AGRADECIMIENTO_VERDE_AMARILLO: "agradecimiento.textoVerdeAmarillo",
  AGRADECIMIENTO_ROJO: "agradecimiento.textoRojo",
  AGRADECIMIENTO_ENVIAR_A_ROJOS: "agradecimiento.enviarARojos",
  // Fidelización: respuesta automática cuando el cliente aprieta el 3er botón
  // ("Agendar mi Turno con un Asesor") de la plantilla. El texto lo edita el
  // jefe de servicio; el toggle lo prende/apaga; el "texto del botón" es el
  // título EXACTO del botón en Meta (para reconocerlo cuando llega la respuesta).
  FIDELIZACION_RESPUESTA_BOTON_ASESOR: "fidelizacion.respuestaBotonAsesor",
  FIDELIZACION_ENVIAR_RESPUESTA_BOTON: "fidelizacion.enviarRespuestaBotonAsesor",
  FIDELIZACION_TEXTO_BOTON_ASESOR: "fidelizacion.textoBotonAsesor",
  // Encuesta de Posventa por ítems (Volkswagen). El TÍTULO del botón es el que
  // figura en la plantilla aprobada en Meta: si allá lo renombran, se corrige
  // acá y el sistema lo vuelve a reconocer, sin tocar código ni redeployar.
  POSVENTA_TEXTO_BOTON_WHATSAPP: "posventa.textoBotonWhatsapp",
  POSVENTA_PREGUNTAS: "posventa.preguntas",
  POSVENTA_ENVIAR_PREGUNTAS: "posventa.enviarPreguntas",
} as const;

// Placeholders soportados en los textos: {nombre} {email} {modelo}
export const DEFAULTS_CONFIG: Record<string, string> = {
  [CLAVES_CONFIG.AGRADECIMIENTO_VERDE_AMARILLO]:
    `¡Gracias por tu respuesta, {nombre}! Te recordamos que en los próximos días te va a llegar la encuesta oficial de ${marca.nombre} Argentina a tu casilla {email}. Tu opinión nos ayuda muchísimo.`,
  [CLAVES_CONFIG.AGRADECIMIENTO_ROJO]:
    "Gracias por contarnos tu experiencia, {nombre}. Lamentamos que no haya sido la esperada. Un responsable del área se va a comunicar con vos a la brevedad para darle una solución.",
  // El texto ROJO (empático, sin recordatorio de encuesta) se manda a los AMARILLOS
  // (neutros) SIEMPRE y a los ROJOS (detractores) solo si este toggle está en "true".
  // "false" = a los ROJOS no se les manda ningún mensaje automático (a los amarillos sí).
  [CLAVES_CONFIG.AGRADECIMIENTO_ENVIAR_A_ROJOS]: "true",
  // Fidelización — respuesta al botón "Agendar mi Turno con un Asesor".
  [CLAVES_CONFIG.FIDELIZACION_RESPUESTA_BOTON_ASESOR]:
    "¡Gracias, {nombre}! Ya tomamos tu pedido de turno con un asesor. En breve nos comunicamos para coordinar el día y horario que mejor te quede. ¡Saludos!",
  [CLAVES_CONFIG.FIDELIZACION_ENVIAR_RESPUESTA_BOTON]: "true",
  [CLAVES_CONFIG.FIDELIZACION_TEXTO_BOTON_ASESOR]: "Agendar mi Turno con un Asesor",
  // Posventa por ítems. El texto de las preguntas se arma del catálogo
  // (config/posventa-vw.ts) para que la lista y el orden vivan en un solo lugar.
  [CLAVES_CONFIG.POSVENTA_TEXTO_BOTON_WHATSAPP]: "Quiero participar por Whatsapp",
  [CLAVES_CONFIG.POSVENTA_PREGUNTAS]: textoPreguntasPorDefecto(),
  [CLAVES_CONFIG.POSVENTA_ENVIAR_PREGUNTAS]: "true",
};

// Solo estas claves son editables desde la API (evita que se inyecten claves arbitrarias)
export const CLAVES_EDITABLES: Set<string> = new Set(Object.values(CLAVES_CONFIG));

/** Devuelve todas las claves conocidas con su valor actual (o el default). */
export async function obtenerConfiguracion(): Promise<Record<string, string>> {
  const filas = await prisma.configuracion.findMany();
  const guardado = Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
  const resultado: Record<string, string> = {};
  for (const clave of CLAVES_EDITABLES) {
    resultado[clave] = guardado[clave] ?? DEFAULTS_CONFIG[clave] ?? "";
  }
  return resultado;
}

export async function obtenerValor(clave: string): Promise<string> {
  const fila = await prisma.configuracion.findUnique({ where: { clave } });
  return fila?.valor ?? DEFAULTS_CONFIG[clave] ?? "";
}

/** Guarda (upsert) los cambios recibidos, solo para claves editables conocidas. */
export async function guardarConfiguracion(cambios: Record<string, string>): Promise<string[]> {
  const aplicadas: string[] = [];
  for (const [clave, valor] of Object.entries(cambios)) {
    if (!CLAVES_EDITABLES.has(clave)) continue;
    await prisma.configuracion.upsert({
      where: { clave },
      create: { clave, valor: String(valor) },
      update: { valor: String(valor) },
    });
    aplicadas.push(clave);
  }
  return aplicadas;
}

// ---------- Credenciales de WhatsApp (Meta), cargadas desde /configuracion ----------
// El token y el verify token se guardan CIFRADOS (AES-256-GCM). El phone number
// id, el nombre y el idioma del template van en claro (no son secretos).

export const CLAVES_META = {
  TOKEN: "meta.whatsappToken",
  PHONE_NUMBER_ID: "meta.phoneNumberId",
  VERIFY_TOKEN: "meta.webhookVerifyToken",
  TEMPLATE_NAME: "meta.templateName", // contacto POSVENTA
  TEMPLATE_LANG: "meta.templateLang",
  TEMPLATE_VENTA_NAME: "meta.templateVentaName", // contacto VENTAS
  TEMPLATE_VENTA_LANG: "meta.templateVentaLang",
  FIDELIZACION_TEMPLATE_NAME: "meta.fidelizacionTemplateName",
  FIDELIZACION_TEMPLATE_LANG: "meta.fidelizacionTemplateLang",
  // Plantilla de recuperación ("no nos llegó tu mensaje, ¿lo repetís?").
  RESPUESTA_NO_RECIBIDA_NAME: "meta.respuestaNoRecibidaName",
  RESPUESTA_NO_RECIBIDA_LANG: "meta.respuestaNoRecibidaLang",
  // Estado de la plantilla de fidelización según Meta (lo actualiza el webhook
  // message_template_status_update): APPROVED / PENDING / REJECTED / ... o "".
  FIDELIZACION_TEMPLATE_STATUS: "meta.fidelizacionTemplateStatus",
} as const;

const CLAVES_META_CIFRADAS = new Set<string>([CLAVES_META.TOKEN, CLAVES_META.VERIFY_TOKEN]);

async function leerMeta(clave: string): Promise<string> {
  const fila = await prisma.configuracion.findUnique({ where: { clave } });
  if (!fila?.valor) return "";
  if (!CLAVES_META_CIFRADAS.has(clave)) return fila.valor;
  try {
    return descifrar(fila.valor);
  } catch (err) {
    // Ej: se rotó CONFIG_ENCRYPTION_KEY y el valor viejo quedó ilegible
    console.error(`[config] no se pudo descifrar ${clave}:`, err instanceof Error ? err.message : err);
    return "";
  }
}

export interface CredencialesMeta {
  token: string;
  phoneNumberId: string;
  webhookVerifyToken: string;
  templateName: string; // contacto POSVENTA
  templateLang: string;
  templateVentaName: string; // contacto VENTAS
  templateVentaLang: string;
  fidelizacionTemplateName: string;
  fidelizacionTemplateLang: string;
  respuestaNoRecibidaName: string;
  respuestaNoRecibidaLang: string;
  graphBaseUrl: string;
}

/**
 * Elige la plantilla de contacto INICIAL según el área del caso: un caso de
 * Posventa se contacta con la plantilla de posventa y uno de Ventas con la de
 * ventas. Cada una tiene su nombre y su idioma (pueden diferir en Meta).
 */
export function plantillaContacto(area: AreaTrabajo, creds: CredencialesMeta): { name: string; lang: string } {
  if (area === AreaTrabajo.VENTAS) {
    return { name: creds.templateVentaName, lang: creds.templateVentaLang };
  }
  return { name: creds.templateName, lang: creds.templateLang };
}

/** Igual que plantillaContacto pero resolviendo las credenciales por dentro. */
export async function plantillaContactoPara(area: AreaTrabajo): Promise<{ name: string; lang: string }> {
  return plantillaContacto(area, await obtenerCredencialesMeta());
}

// Credenciales efectivas para USAR (envío, verificación de webhook): primero lo
// guardado en /configuracion; si algo falta, cae al .env (bootstrap/migración).
export async function obtenerCredencialesMeta(): Promise<CredencialesMeta> {
  const [token, phone, verify, tName, tLang, tVentaName, tVentaLang, tFidel, tFidelLang, tRnrName, tRnrLang] =
    await Promise.all([
      leerMeta(CLAVES_META.TOKEN),
      leerMeta(CLAVES_META.PHONE_NUMBER_ID),
      leerMeta(CLAVES_META.VERIFY_TOKEN),
      leerMeta(CLAVES_META.TEMPLATE_NAME),
      leerMeta(CLAVES_META.TEMPLATE_LANG),
      leerMeta(CLAVES_META.TEMPLATE_VENTA_NAME),
      leerMeta(CLAVES_META.TEMPLATE_VENTA_LANG),
      leerMeta(CLAVES_META.FIDELIZACION_TEMPLATE_NAME),
      leerMeta(CLAVES_META.FIDELIZACION_TEMPLATE_LANG),
      leerMeta(CLAVES_META.RESPUESTA_NO_RECIBIDA_NAME),
      leerMeta(CLAVES_META.RESPUESTA_NO_RECIBIDA_LANG),
    ]);
  const templateLang = tLang || env.meta.templateLang;
  return {
    token: token || env.meta.token,
    phoneNumberId: phone || env.meta.phoneNumberId,
    webhookVerifyToken: verify || env.meta.webhookVerifyToken,
    templateName: tName || env.meta.templateName,
    templateLang,
    templateVentaName: tVentaName || env.meta.templateVentaName,
    // Por defecto, el idioma de la de ventas es el mismo que la de posventa
    // (hoy ambas en español); se puede fijar aparte si difieren en Meta.
    templateVentaLang: tVentaLang || templateLang,
    fidelizacionTemplateName: tFidel || env.meta.fidelizacionTemplateName,
    fidelizacionTemplateLang: tFidelLang || templateLang,
    respuestaNoRecibidaName: tRnrName || env.meta.respuestaNoRecibidaName,
    respuestaNoRecibidaLang: tRnrLang || env.meta.respuestaNoRecibidaLang || templateLang,
    graphBaseUrl: env.meta.graphBaseUrl, // la base no es secreto: va por .env
  };
}

export interface GuardarMeta {
  token?: string;
  phoneNumberId?: string;
  webhookVerifyToken?: string;
  templateName?: string;
  templateLang?: string;
  templateVentaName?: string;
  templateVentaLang?: string;
  fidelizacionTemplateName?: string;
  fidelizacionTemplateLang?: string;
  respuestaNoRecibidaName?: string;
  respuestaNoRecibidaLang?: string;
}

export async function guardarCredencialesMeta(d: GuardarMeta): Promise<void> {
  const set = async (clave: string, valor: string, cifrado: boolean) => {
    const almacenado = cifrado ? cifrar(valor) : valor;
    await prisma.configuracion.upsert({
      where: { clave },
      create: { clave, valor: almacenado },
      update: { valor: almacenado },
    });
  };
  // El token y el verify token solo se pisan si vienen con valor (para no
  // borrarlos sin querer desde la UI, que los muestra enmascarados).
  if (d.token) await set(CLAVES_META.TOKEN, d.token, true);
  if (d.webhookVerifyToken) await set(CLAVES_META.VERIFY_TOKEN, d.webhookVerifyToken, true);
  if (d.phoneNumberId !== undefined) await set(CLAVES_META.PHONE_NUMBER_ID, d.phoneNumberId, false);
  if (d.templateName !== undefined) await set(CLAVES_META.TEMPLATE_NAME, d.templateName, false);
  if (d.templateLang !== undefined) await set(CLAVES_META.TEMPLATE_LANG, d.templateLang, false);
  if (d.templateVentaName !== undefined) await set(CLAVES_META.TEMPLATE_VENTA_NAME, d.templateVentaName, false);
  if (d.templateVentaLang !== undefined) await set(CLAVES_META.TEMPLATE_VENTA_LANG, d.templateVentaLang, false);
  if (d.fidelizacionTemplateName !== undefined)
    await set(CLAVES_META.FIDELIZACION_TEMPLATE_NAME, d.fidelizacionTemplateName, false);
  if (d.fidelizacionTemplateLang !== undefined)
    await set(CLAVES_META.FIDELIZACION_TEMPLATE_LANG, d.fidelizacionTemplateLang, false);
  if (d.respuestaNoRecibidaName !== undefined)
    await set(CLAVES_META.RESPUESTA_NO_RECIBIDA_NAME, d.respuestaNoRecibidaName, false);
  if (d.respuestaNoRecibidaLang !== undefined)
    await set(CLAVES_META.RESPUESTA_NO_RECIBIDA_LANG, d.respuestaNoRecibidaLang, false);
}

// ---------- Estado de la plantilla de Fidelización (lo setea el webhook) ----------
// Meta avisa por el webhook message_template_status_update cuando una plantilla
// cambia de estado. Guardamos el estado para saber si ya se puede enviar el
// recordatorio de fidelización sin necesidad de "probar y ver".

export async function guardarEstadoPlantillaFidelizacion(estado: string): Promise<void> {
  await prisma.configuracion.upsert({
    where: { clave: CLAVES_META.FIDELIZACION_TEMPLATE_STATUS },
    create: { clave: CLAVES_META.FIDELIZACION_TEMPLATE_STATUS, valor: estado },
    update: { valor: estado },
  });
}

/** Estado conocido de la plantilla de fidelización ("" = sin confirmar todavía). */
export async function obtenerEstadoPlantillaFidelizacion(): Promise<string> {
  const fila = await prisma.configuracion.findUnique({
    where: { clave: CLAVES_META.FIDELIZACION_TEMPLATE_STATUS },
  });
  return fila?.valor ?? "";
}

// Estado enmascarado para la pantalla (NUNCA devuelve el token completo).
export async function estadoMeta() {
  const c = await obtenerCredencialesMeta();
  const pista = (s: string) => (s.length <= 4 ? "••••" : "…" + s.slice(-4));
  return {
    cifradoDisponible: cifradoDisponible(),
    tokenConfigurado: Boolean(c.token),
    tokenPista: c.token ? pista(c.token) : null,
    phoneNumberId: c.phoneNumberId,
    verifyTokenConfigurado: Boolean(c.webhookVerifyToken),
    templateName: c.templateName,
    templateLang: c.templateLang,
    templateVentaName: c.templateVentaName,
    templateVentaLang: c.templateVentaLang,
    fidelizacionTemplateName: c.fidelizacionTemplateName,
    fidelizacionTemplateLang: c.fidelizacionTemplateLang,
    respuestaNoRecibidaName: c.respuestaNoRecibidaName,
    respuestaNoRecibidaLang: c.respuestaNoRecibidaLang,
    completo: Boolean(c.token && c.phoneNumberId),
  };
}
