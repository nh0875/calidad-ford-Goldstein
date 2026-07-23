import { Request, Response } from "express";
import { OrigenAgendamiento } from "@prisma/client";
import { z } from "zod";
import { env } from "../config/env";
import { contarDestinatarios, encolarCampana, progresoCola } from "../services/campana.service";
import { ACCIONES, auditar } from "../services/audit.service";
import { cupoDisponibleHoy, dentroDeVentana } from "../services/ventana-envio.service";
import { estadoMeta } from "../services/configuracion.service";
import { areaEfectiva, parsearAreaQuery } from "../services/area.service";

const filtrosSchema = z.object({
  uploadId: z.string().trim().min(1).optional(),
  sucursal: z.string().trim().min(1).optional(),
  periodo: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "El período tiene que tener el formato AAAA-MM, por ejemplo 2026-01.")
    .optional(),
  asesor: z.string().trim().min(1).optional(),
  // Debe estar acá para que "enviar a todos los pendientes del filtro actual"
  // respete el filtro de Origen de la pantalla /casos (si no, se ignoraría y se
  // enviaría a pendientes de TODOS los orígenes).
  origenAgendamiento: z.nativeEnum(OrigenAgendamiento).optional(),
  casoIds: z.array(z.string().trim().min(1)).max(5000).optional(),
});

// En el GET de preview los casoIds llegan como lista separada por comas
function filtrosDesdeQuery(query: Request["query"]) {
  return filtrosSchema.safeParse({
    uploadId: query.uploadId || undefined,
    sucursal: query.sucursal || undefined,
    periodo: query.periodo || undefined,
    asesor: query.asesor || undefined,
    origenAgendamiento: query.origenAgendamiento || undefined,
    casoIds:
      typeof query.casoIds === "string" && query.casoIds.length > 0
        ? query.casoIds.split(",")
        : undefined,
  });
}

export async function previewCampana(req: Request, res: Response) {
  const parsed = filtrosDesdeQuery(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      message: `Hay filtros con formato incorrecto: ${parsed.error.errors.map((e) => e.message).join(" ")}`,
    });
  }

  // El área la fija la sesión (no el cliente): un usuario restringido solo
  // cuenta/alcanza casos de su área, aun con casoIds manuales.
  const area = areaEfectiva(req.usuario!, parsearAreaQuery(req.query.area));
  const destinatarios = await contarDestinatarios({ ...parsed.data, area });
  res.json({
    destinatarios,
    message:
      destinatarios === 0
        ? "Ningún caso pendiente coincide con esos filtros: no se enviaría ningún mensaje."
        : `Se va a enviar el mensaje de WhatsApp a ${destinatarios} cliente(s) con contacto pendiente.`,
  });
}

export async function enviarCampana(req: Request, res: Response) {
  const parsed = filtrosSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      message: `Hay filtros con formato incorrecto: ${parsed.error.errors.map((e) => e.message).join(" ")}`,
    });
  }

  // Sin MODO_DEMO y sin credenciales de Meta cargadas, no tiene sentido encolar:
  // mensaje claro apuntando a dónde configurarlas (no un error críptico por caso).
  if (!env.modoDemo) {
    const meta = await estadoMeta();
    if (!meta.completo) {
      return res.status(409).json({
        message:
          "Faltan configurar las credenciales de WhatsApp en Configuración (token y phone number ID de Meta). " +
          "Cargálas en la pantalla de Configuración y probá la conexión antes de enviar campañas.",
      });
    }
  }

  const area = areaEfectiva(req.usuario!, parsearAreaQuery(req.query.area));
  const encolados = await encolarCampana({ ...parsed.data, area });

  // Aviso informativo sobre ventana/tope (el worker los hace cumplir al enviar)
  const avisos: string[] = [];
  if (encolados > 0 && !dentroDeVentana()) {
    avisos.push(`Estás fuera del horario de envío (${env.horaInicioEnvio}-${env.horaFinEnvio}): los mensajes empezarán a salir cuando abra la ventana.`);
  }
  if (encolados > 0) {
    const cupo = await cupoDisponibleHoy();
    if (encolados > cupo) {
      avisos.push(`Hoy quedan ${cupo} envíos del tope diario (${env.maxEnviosDiarios}); el resto continuará el/los día(s) siguiente(s).`);
    }
  }

  if (encolados > 0) {
    await auditar(req, {
      accion: ACCIONES.CAMPANA_ENVIADA,
      entidad: "Campana",
      detalles: {
        casosEncolados: encolados,
        filtros: {
          uploadId: parsed.data.uploadId ?? null,
          sucursal: parsed.data.sucursal ?? null,
          periodo: parsed.data.periodo ?? null,
          asesor: parsed.data.asesor ?? null,
          origenAgendamiento: parsed.data.origenAgendamiento ?? null,
          area: area ?? null,
          seleccionManual: parsed.data.casoIds ? parsed.data.casoIds.length : null,
        },
      },
    });
  }

  res.status(encolados > 0 ? 202 : 200).json({
    encolados,
    message:
      encolados === 0
        ? "No había casos pendientes para esos filtros: no se encoló ningún mensaje."
        : `Listo: se programó el envío de ${encolados} mensaje(s) de WhatsApp. El progreso se puede seguir en esta pantalla.` +
          (avisos.length ? " " + avisos.join(" ") : ""),
  });
}

export async function progresoCampana(_req: Request, res: Response) {
  res.json(await progresoCola());
}
