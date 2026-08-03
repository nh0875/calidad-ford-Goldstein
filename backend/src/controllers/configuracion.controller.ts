import { Request, Response } from "express";
import { z } from "zod";
import {
  CLAVES_EDITABLES,
  estadoMeta,
  guardarConfiguracion,
  guardarCredencialesMeta,
  obtenerConfiguracion,
  obtenerCredencialesMeta,
} from "../services/configuracion.service";
import { cifradoDisponible } from "../services/cripto.service";
import { ACCIONES, auditar } from "../services/audit.service";
import { env } from "../config/env";

// GET /api/configuracion — cualquier usuario autenticado puede leer (para
// mostrar/prever los textos). La edición es solo ADMIN (lo exige la ruta).
export async function getConfiguracion(_req: Request, res: Response) {
  res.json({ data: await obtenerConfiguracion() });
}

// PATCH /api/configuracion — solo ADMIN. Recibe { clave: valor, ... } y guarda
// únicamente las claves conocidas (ignora cualquier otra).
const patchSchema = z.record(z.string(), z.string());

export async function patchConfiguracion(req: Request, res: Response) {
  const parsed = patchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: "El cuerpo debe ser un objeto de clave→texto." });
  }

  const desconocidas = Object.keys(parsed.data).filter((k) => !CLAVES_EDITABLES.has(k));
  if (desconocidas.length === Object.keys(parsed.data).length && desconocidas.length > 0) {
    return res.status(400).json({ message: "No se reconoce ninguna de las claves enviadas." });
  }

  const aplicadas = await guardarConfiguracion(parsed.data);

  await auditar(req, {
    accion: ACCIONES.CONFIGURACION_MODIFICADA,
    entidad: "Configuracion",
    detalles: { claves: aplicadas }, // sin valores, para no volcar textos largos ni datos sensibles
  });

  res.json({ message: "Configuración guardada.", data: await obtenerConfiguracion() });
}

// ---------- Credenciales de WhatsApp (Meta) ----------

// GET /api/configuracion/whatsapp — estado enmascarado (nunca el token completo)
export async function getMeta(_req: Request, res: Response) {
  res.json({ data: await estadoMeta() });
}

// PATCH /api/configuracion/whatsapp — solo ADMIN. Guarda cifrado el token/verify.
const metaSchema = z.object({
  token: z.string().trim().optional(),
  phoneNumberId: z.string().trim().optional(),
  webhookVerifyToken: z.string().trim().optional(),
  templateName: z.string().trim().optional(),
  templateLang: z.string().trim().optional(),
  templateVentaName: z.string().trim().optional(),
  templateVentaLang: z.string().trim().optional(),
  fidelizacionTemplateName: z.string().trim().optional(),
  fidelizacionTemplateLang: z.string().trim().optional(),
});

export async function patchMeta(req: Request, res: Response) {
  const parsed = metaSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: "Datos de WhatsApp inválidos." });
  }
  const vaAGuardarSecreto = Boolean(parsed.data.token || parsed.data.webhookVerifyToken);
  if (vaAGuardarSecreto && !cifradoDisponible()) {
    return res.status(400).json({
      message:
        "No hay CONFIG_ENCRYPTION_KEY válida (32 bytes) configurada, así que no se puede guardar el token cifrado. Configurala en el .env y reiniciá el backend.",
    });
  }

  await guardarCredencialesMeta(parsed.data);

  await auditar(req, {
    accion: ACCIONES.CONFIGURACION_MODIFICADA,
    entidad: "Configuracion",
    // Solo se listan los campos tocados, NUNCA los valores (menos el token)
    detalles: {
      seccion: "whatsapp",
      campos: Object.keys(parsed.data).filter((k) => (parsed.data as Record<string, unknown>)[k] !== undefined),
      tokenActualizado: Boolean(parsed.data.token),
      verifyActualizado: Boolean(parsed.data.webhookVerifyToken),
    },
  });

  res.json({ message: "Credenciales de WhatsApp guardadas.", data: await estadoMeta() });
}

// POST /api/configuracion/whatsapp/probar — prueba real contra la Graph API de Meta
export async function probarWhatsapp(_req: Request, res: Response) {
  if (env.modoDemo) {
    return res.json({ ok: true, detalle: "MODO_DEMO activo: la conexión con WhatsApp está simulada." });
  }
  const c = await obtenerCredencialesMeta();
  if (!c.token || !c.phoneNumberId) {
    return res.json({ ok: false, detalle: "Faltan el token o el phone number ID. Cargálos y guardá antes de probar." });
  }
  try {
    const url = `${c.graphBaseUrl}/${c.phoneNumberId}?fields=verified_name,display_phone_number,code_verification_status`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${c.token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const body: any = await r.json().catch(() => null);
    if (!r.ok) {
      const detalle = body?.error?.message ?? `HTTP ${r.status}`;
      return res.json({ ok: false, detalle: `Meta rechazó las credenciales: ${detalle}` });
    }
    return res.json({
      ok: true,
      detalle: `Conexión OK. Número: ${body?.display_phone_number ?? "?"} (${body?.verified_name ?? "sin nombre verificado"}).`,
    });
  } catch (err) {
    return res.json({ ok: false, detalle: `No se pudo conectar con Meta: ${err instanceof Error ? err.message : String(err)}` });
  }
}
