// ---------------------------------------------------------------------------
// El escalón telefónico del circuito de insistencia (Volkswagen)
// ---------------------------------------------------------------------------
//
// Cuando un cliente no contesta ninguno de los dos WhatsApp, el caso queda en
// LLAMADA_PENDIENTE y lo llama Calidad. Acá viven las tres cosas que se pueden
// hacer desde la pantalla:
//
//   1. Mandar el segundo contacto a mano, sin esperar a que lo haga el circuito.
//   2. Cargar el resultado de la llamada (el caso pasa a RESPONDIO_LLAMADA).
//   3. Anotar que no se pudo hablar, con el motivo.
//
// POR QUÉ EL RESULTADO DE LA LLAMADA SE MIDE APARTE. Un caso rescatado por
// teléfono NO es lo mismo que uno que contestó solo por WhatsApp: costó una
// llamada. Guardarlos con el mismo estado haría imposible saber cuánto rinde
// insistir, que es justamente lo que este circuito vino a averiguar.

import { Request, Response } from "express";
import { z } from "zod";
import { AreaTrabajo, EstadoContacto } from "@prisma/client";
import { marca } from "../config/marca";
import { prisma } from "../config/prisma";
import { puedeVer } from "../services/area.service";
import { encolarSegundoContactoManual } from "../services/segundo-contacto.service";
import { ITEMS_POSVENTA } from "../config/posventa-vw";
import { PuntajeItem, guardarPuntajes } from "../services/encuesta-posventa.service";
import { ACCIONES, auditar } from "../services/audit.service";

const SELECT_CASO = {
  id: true,
  area: true,
  sucursal: true,
  estadoContacto: true,
  segundoContactoEn: true,
  nombrePropietario: true,
} as const;

/** Busca el caso y corta si la persona no lo puede tocar. Devuelve null si ya respondió. */
async function traerCasoAutorizado(req: Request, res: Response) {
  const caso = await prisma.caso.findFirst({
    where: { id: req.params.casoId, eliminadoEn: null },
    select: SELECT_CASO,
  });
  if (!caso) {
    res.status(404).json({ message: "No se encontró el caso." });
    return null;
  }
  if (!puedeVer(req.usuario!, { area: caso.area, sucursal: caso.sucursal })) {
    res.status(403).json({ message: "Ese caso es de otra área o provincia: no lo podés gestionar." });
    return null;
  }
  return caso;
}

// ---------- POST /api/seguimiento/:casoId/segundo-contacto ----------
//
// El botón para no esperar a la barrida. Toda la validación real vive en el
// servicio, que es el mismo que usa el circuito automático: si estuviera
// duplicada acá, tarde o temprano las dos versiones dirían cosas distintas.
export async function mandarSegundoContacto(req: Request, res: Response) {
  const caso = await traerCasoAutorizado(req, res);
  if (!caso) return;

  const r = await encolarSegundoContactoManual(caso.id);
  if (!r.encolado) return res.status(409).json({ message: r.motivo });

  auditar(req, {
    accion: ACCIONES.SEGUNDO_CONTACTO_MANUAL,
    entidad: "Caso",
    entidadId: caso.id,
    detalles: { cliente: caso.nombrePropietario },
  });

  res.json({
    message:
      "El segundo contacto quedó encolado. Sale dentro del horario de envío (o apenas abre, si estamos fuera).",
  });
}

// ---------- POST /api/seguimiento/:casoId/llamada ----------

const itemsValidos: readonly string[] = ITEMS_POSVENTA;

const llamadaSchema = z.object({
  // Posventa: una estrella por ítem. Ventas: una sola nota general.
  puntajes: z
    .array(
      z.object({
        item: z.string().refine((v) => (itemsValidos as string[]).includes(v), "Ítem desconocido."),
        estrellas: z.number().int().min(1).max(5).nullable(),
        comentario: z.string().trim().max(1000).nullable().optional(),
      })
    )
    .optional(),
  estrellasGeneral: z.number().int().min(1).max(5).nullable().optional(),
  comentario: z.string().trim().max(2000).nullable().optional(),
});

/**
 * Carga lo que el cliente dijo por teléfono y da el caso por respondido.
 *
 * La nota NO es obligatoria. Un cliente puede atender, decir que está todo bien y
 * cortar sin dar un número: eso es una respuesta igual, y perderla por no tener
 * puntaje sería peor que guardarla incompleta.
 */
export async function cargarResultadoLlamada(req: Request, res: Response) {
  if (!marca.segundoContacto) {
    return res.status(404).json({ message: `El circuito de llamadas no está disponible en ${marca.nombre}.` });
  }
  const parseo = llamadaSchema.safeParse(req.body ?? {});
  if (!parseo.success) {
    return res.status(400).json({ message: parseo.error.issues[0]?.message ?? "Datos inválidos." });
  }
  const caso = await traerCasoAutorizado(req, res);
  if (!caso) return;

  const { puntajes, estrellasGeneral, comentario } = parseo.data;

  // Posventa se mide por ítems y Ventas con una nota sola. No es un capricho de
  // pantalla: es la misma diferencia que ya existe en la encuesta por WhatsApp, y
  // guardar Ventas por ítems ensuciaría los promedios por ítem con datos que no
  // corresponden a ese circuito.
  if (caso.area === AreaTrabajo.POSVENTA && puntajes?.length) {
    const aGuardar: PuntajeItem[] = puntajes.map((p) => ({
      item: p.item as PuntajeItem["item"],
      estrellas: p.estrellas,
      comentario: p.comentario ?? null,
    }));
    await guardarPuntajes(caso.id, aGuardar);
  }

  await prisma.caso.update({
    where: { id: caso.id },
    data: {
      estadoContacto: EstadoContacto.RESPONDIO_LLAMADA,
      // Se limpia el motivo de un intento fallido anterior: si antes no se pudo
      // hablar y ahora sí, dejar el "no atendió" viejo colgado haría pensar que
      // el caso sigue trabado.
      llamadaMotivo: null,
      ...(estrellasGeneral !== undefined && estrellasGeneral !== null
        ? { estrellas: estrellasGeneral }
        : {}),
    },
  });

  // El comentario se guarda como un mensaje ENTRANTE del caso. Así aparece en la
  // conversación junto con todo lo demás, en vez de esconderse en un campo que
  // nadie mira: para quien lee el caso, lo que el cliente dijo por teléfono vale
  // igual que lo que escribió por WhatsApp.
  if (comentario?.trim()) {
    await prisma.whatsappMessage.create({
      data: {
        casoId: caso.id,
        direction: "ENTRANTE",
        content: `[Llamada telefónica] ${comentario.trim()}`,
        status: "recibido",
      },
    });
  }

  auditar(req, {
    accion: ACCIONES.LLAMADA_CARGADA,
    entidad: "Caso",
    entidadId: caso.id,
    detalles: {
      cliente: caso.nombrePropietario,
      area: caso.area,
      items: puntajes?.length ?? 0,
      estrellasGeneral: estrellasGeneral ?? null,
    },
  });

  res.json({ message: "Listo, quedó cargado lo que dijo el cliente por teléfono." });
}

// ---------- POST /api/seguimiento/:casoId/llamada-fallida ----------

const fallidaSchema = z.object({
  motivo: z.string().trim().min(1, "Contá por qué no se pudo hablar.").max(500),
});

/**
 * "No se pudo hablar", con el motivo.
 *
 * El caso SE QUEDA en LLAMADA_PENDIENTE a propósito: no atender no es un
 * desenlace, es un intento. Si esto lo cerrara, un número equivocado se
 * confundiría con un cliente que no quiso contestar, y nadie volvería a intentar.
 * Lo único que cambia es que queda escrito qué pasó.
 */
export async function marcarLlamadaFallida(req: Request, res: Response) {
  if (!marca.segundoContacto) {
    return res.status(404).json({ message: `El circuito de llamadas no está disponible en ${marca.nombre}.` });
  }
  const parseo = fallidaSchema.safeParse(req.body ?? {});
  if (!parseo.success) {
    return res.status(400).json({ message: parseo.error.issues[0]?.message ?? "Falta el motivo." });
  }
  const caso = await traerCasoAutorizado(req, res);
  if (!caso) return;

  await prisma.caso.update({
    where: { id: caso.id },
    data: { llamadaMotivo: parseo.data.motivo },
  });

  auditar(req, {
    accion: ACCIONES.LLAMADA_FALLIDA,
    entidad: "Caso",
    entidadId: caso.id,
    detalles: { cliente: caso.nombrePropietario, motivo: parseo.data.motivo },
  });

  res.json({ message: "Anotado. El caso sigue pendiente de llamada para volver a intentar." });
}
