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
import { AreaTrabajo, EstadoContacto, MessageDirection, Semaforo, TipoAviso } from "@prisma/client";
import { marca } from "../config/marca";
import { prisma } from "../config/prisma";
import { puedeVer } from "../services/area.service";
import { encolarSegundoContactoManual } from "../services/segundo-contacto.service";
import { ITEM_QUE_DEFINE_EL_CASO, ITEMS_POSVENTA, itemsPreguntados } from "../config/posventa-vw";
import { PuntajeItem, guardarPuntajes } from "../services/encuesta-posventa.service";
import { aplicarReglaRQR, derivarDeEstrellas } from "../services/sentiment.service";
import { crearRqrAutomatico } from "../services/rqr.service";
import { crearAviso } from "../services/aviso.service";
import { ACCIONES, auditar } from "../services/audit.service";
import { parseConvId } from "./seguimiento.controller";

const SELECT_CASO = {
  id: true,
  area: true,
  sucursal: true,
  estadoContacto: true,
  segundoContactoEn: true,
  nombrePropietario: true,
  // Decide qué ítems se pueden cargar: si al auto no lo lavaron, el lavado no
  // se le preguntó y tampoco se puede cargar a mano.
  tuvoLavado: true,
} as const;

/** Busca el caso y corta si la persona no lo puede tocar. */
async function traerCasoAutorizado(req: Request, res: Response) {
  // La pantalla manda el id CON PREFIJO ("caso:abc123"), igual que a los demás
  // endpoints de seguimiento. Buscarlo tal cual no encuentra nada y los tres
  // botones responderían 404 sin que se entienda por qué.
  const conv = parseConvId(req.params.casoId);
  if (!conv || conv.tipo !== "caso") {
    res.status(404).json({ message: "No se encontró el caso." });
    return null;
  }

  const caso = await prisma.caso.findFirst({
    where: { id: conv.id, eliminadoEn: null },
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

  // Lo que se le preguntó a ESTE caso. En Posventa se mide por ítems y en Ventas
  // con una nota sola: no es un capricho de pantalla, es la misma diferencia que
  // ya existe en la encuesta por WhatsApp, y guardar Ventas por ítems ensuciaría
  // los promedios por ítem con datos de otro circuito.
  //
  // Del filtro por `preguntados` sale lo que no corresponde: la pantalla ya no
  // muestra el lavado cuando al auto no lo lavaron, pero el pedido se puede
  // armar a mano, y un puntaje de lavado inventado entra al promedio del área
  // sin que después nadie lo pueda distinguir de uno real.
  const preguntados = itemsPreguntados(caso.tuvoLavado);
  const porItems: PuntajeItem[] =
    caso.area === AreaTrabajo.POSVENTA && puntajes?.length
      ? puntajes
          .filter((p) => preguntados.includes(p.item as PuntajeItem["item"]))
          .map((p) => ({
            item: p.item as PuntajeItem["item"],
            estrellas: p.estrellas,
            comentario: p.comentario ?? null,
          }))
      : [];

  // LA NOTA QUE DEFINE EL CASO. En Posventa es el ítem GENERAL, igual que en la
  // encuesta por WhatsApp; en Ventas es la única nota que se carga. Se acepta
  // estrellasGeneral como respaldo porque la pantalla cae a una sola estrella
  // cuando todavía no cargó el catálogo de ítems de la marca.
  const general = porItems.find((p) => p.item === ITEM_QUE_DEFINE_EL_CASO)?.estrellas ?? null;
  const estrellas = general ?? estrellasGeneral ?? null;

  await prisma.caso.update({
    where: { id: caso.id },
    data: {
      estadoContacto: EstadoContacto.RESPONDIO_LLAMADA,
      // Se limpia el motivo de un intento fallido anterior: si antes no se pudo
      // hablar y ahora sí, dejar el "no atendió" viejo colgado haría pensar que
      // el caso sigue trabado.
      llamadaMotivo: null,
    },
  });

  // El comentario se guarda como un mensaje ENTRANTE del caso. Así aparece en la
  // conversación junto con todo lo demás, en vez de esconderse en un campo que
  // nadie mira: para quien lee el caso, lo que el cliente dijo por teléfono vale
  // igual que lo que escribió por WhatsApp.
  //
  // Nace YA ANALIZADO: lo que dijo por teléfono lo acaba de cargar una persona,
  // no hay nada que la IA tenga que interpretar. Sin esto quedaba esperando y se
  // colaba en el próximo análisis del caso, mezclado con el mensaje nuevo del
  // cliente.
  let mensajeId: string | null = null;
  if (comentario?.trim()) {
    const mensaje = await prisma.whatsappMessage.create({
      data: {
        casoId: caso.id,
        direction: MessageDirection.ENTRANTE,
        content: `[Llamada telefónica] ${comentario.trim()}`,
        status: "recibido",
        analizadoEn: new Date(),
      },
    });
    mensajeId = mensaje.id;
  }

  // LA CALIFICACIÓN TIENE QUE VALER LO MISMO QUE UNA POR WHATSAPP.
  //
  // Un caso rescatado por teléfono cuenta igual que uno que contestó solo: si la
  // nota no queda registrada como una clasificación del caso, ese cliente no
  // aparece en ningún tablero, no entra en el promedio del asesor y no abre RQR
  // aunque haya dicho que la pasó mal. Por eso se crea el mismo análisis que
  // crea la IA, marcado como que lo cargó una persona.
  if (estrellas !== null) {
    const derivado = derivarDeEstrellas(estrellas);
    const requiereRQR = aplicarReglaRQR(derivado.semaforo, derivado.severidad);
    const resumen = comentario?.trim()
      ? `Respuesta por teléfono (${estrellas} de 5): ${comentario.trim()}`
      : `Respuesta por teléfono: ${estrellas} de 5.`;

    // Invariante del sistema: un solo análisis principal por caso. El que estaba
    // (si lo había) pasa a seguimiento, o el caso contaría dos veces en los
    // reportes.
    const [, analisis] = await prisma.$transaction([
      prisma.sentimentAnalysis.updateMany({
        where: { casoId: caso.id, esSeguimiento: false },
        data: { esSeguimiento: true },
      }),
      prisma.sentimentAnalysis.create({
        data: {
          casoId: caso.id,
          messageId: mensajeId,
          semaforo: derivado.semaforo,
          severidad: derivado.severidad,
          estrellas,
          // La cargó una persona que habló con el cliente: no hay nada que
          // interpretar ni margen de error de lectura.
          confianza: 1,
          resumenIA: resumen,
          respuestaCrudaIA: {
            motivo: "llamada-telefonica",
            estrellas,
            comentario: comentario?.trim() ?? null,
            cargadoPor: req.usuario!.email,
          },
          requiereRQR,
          esLlamada: true,
          esSeguimiento: false,
          mensajesAnalizados: mensajeId ? 1 : 0,
        },
      }),
    ]);

    if (porItems.length) await guardarPuntajes(caso.id, porItems, analisis.id);

    if (requiereRQR) {
      const completo = await prisma.caso.findUnique({ where: { id: caso.id } });
      if (completo) {
        const { rqr, accion } = await crearRqrAutomatico({
          caso: completo,
          analisis,
          textoCliente: comentario?.trim() || resumen,
        });
        await crearAviso({
          tipo: TipoAviso.RQR_ABIERTO,
          area: caso.area,
          casoId: caso.id,
          rqrId: rqr.id,
          titulo:
            accion === "creado"
              ? `${rqr.numeroRQR} — se abrió un RQR de ${completo.nombrePropietario} (por teléfono)`
              : `${rqr.numeroRQR} — ${completo.nombrePropietario} volvió a reclamar (por teléfono)`,
          detalle: `${resumen} (asesor: ${completo.asesor}, sucursal: ${completo.sucursal})`,
        });
      }
    } else if (derivado.semaforo === Semaforo.AMARILLO) {
      // Amarillo sin RQR no existe hoy en Volkswagen (todo lo que no es 5 abre
      // RQR), pero el aviso queda por si mañana cambia la regla: un amarillo que
      // no abre reclamo igual conviene que alguien lo mire.
      await crearAviso({
        tipo: TipoAviso.AMARILLO_SIN_RQR,
        area: caso.area,
        casoId: caso.id,
        titulo: `${caso.nombrePropietario} quedó en amarillo (respondió por teléfono)`,
        detalle: resumen,
      });
    }
  } else if (porItems.length) {
    // Cargó ítems sueltos pero no la satisfacción general: se guardan igual, sin
    // análisis. Perder lo que el cliente dijo por no tener la nota que manda
    // sería peor que guardarlo incompleto.
    await guardarPuntajes(caso.id, porItems);
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
 * "No se pudo hablar": se agotaron los tres contactos.
 *
 * El caso pasa a NO_RESPONDE_CONTACTOS, que es el final del circuito: no
 * contestó el WhatsApp inicial, no contestó la insistencia y tampoco se lo pudo
 * agarrar por teléfono. A partir de ahí sale de la lista de pendientes y no se
 * le manda nada más.
 *
 * El MOTIVO es obligatorio y queda guardado. Sin él, "no se pudo" sería una
 * bolsa donde caen cosas muy distintas —número equivocado, no atiende nunca, se
 * negó a contestar— y esas tres piden acciones diferentes: la primera es un dato
 * mal cargado que hay que corregir, la última es una decisión del cliente que
 * hay que respetar.
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
    data: {
      estadoContacto: EstadoContacto.NO_RESPONDE_CONTACTOS,
      llamadaMotivo: parseo.data.motivo,
    },
  });

  auditar(req, {
    accion: ACCIONES.LLAMADA_FALLIDA,
    entidad: "Caso",
    entidadId: caso.id,
    detalles: { cliente: caso.nombrePropietario, motivo: parseo.data.motivo },
  });

  res.json({
    message: "Anotado. El caso queda como “No responde contactos”: se intentaron los tres contactos y no hubo forma.",
  });
}
