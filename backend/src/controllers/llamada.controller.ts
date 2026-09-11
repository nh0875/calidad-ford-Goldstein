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
import { AreaTrabajo, EstadoContacto, EstadoRQR, MessageDirection, TipoAviso } from "@prisma/client";
import { marca } from "../config/marca";
import { prisma } from "../config/prisma";
import { puedeVer } from "../services/area.service";
import { encolarSegundoContactoManual } from "../services/segundo-contacto.service";
import { ITEM_QUE_DEFINE_EL_CASO, ITEMS_POSVENTA, itemsPreguntados } from "../config/posventa-vw";
import { PuntajeItem, guardarPuntajes, puntajesDelCaso } from "../services/encuesta-posventa.service";
import { aplicarReglaRQR, derivarDeEstrellas } from "../services/sentiment.service";
import { crearRqrAutomatico } from "../services/rqr.service";
import { crearAviso } from "../services/aviso.service";
import { ACCIONES, auditar } from "../services/audit.service";
import { parseConvId } from "./seguimiento.controller";

/**
 * Con qué empieza el mensaje que deja la llamada en la conversación.
 *
 * Es lo que permite volver a encontrarlo para corregirlo. Si cambia, los
 * comentarios cargados antes dejan de ser editables (quedan en la conversación,
 * pero el formulario ya no los reconoce como suyos).
 */
const PREFIJO_LLAMADA = "[Llamada telefónica] ";

/**
 * Los estados en los que este formulario tiene sentido.
 *
 *   LLAMADA_PENDIENTE     — todavía no se cargó: es la primera vez.
 *   RESPONDIO_LLAMADA     — ya se cargó y se está CORRIGIENDO.
 *   NO_RESPONDE_CONTACTOS — se había dado por no alcanzable y esta vez sí
 *                           atendió: el caso se reabre como respondido.
 *
 * Fuera de esos tres no se acepta, y no es burocracia: un caso que contestó por
 * WhatsApp tiene su propia clasificación hecha sobre lo que el cliente escribió,
 * y dejar que este formulario la pise sería borrar la respuesta real del cliente
 * con lo que alguien tipeó en otra pantalla.
 */
const ESTADOS_QUE_ACEPTAN_LLAMADA = [
  EstadoContacto.LLAMADA_PENDIENTE,
  EstadoContacto.RESPONDIO_LLAMADA,
  EstadoContacto.NO_RESPONDE_CONTACTOS,
] as const;

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

// ---------- GET /api/seguimiento/:casoId/llamada ----------
//
// Lo que YA se cargó de la llamada, para poder corregirlo.
//
// La pantalla necesita volver a mostrar exactamente lo que se guardó: si el
// formulario se abriera vacío, corregir una estrella obligaría a acordarse y
// volver a tipear todo lo demás, y lo que no se vuelva a cargar se borra.
export async function verResultadoLlamada(req: Request, res: Response) {
  if (!marca.segundoContacto) {
    return res.status(404).json({ message: `El circuito de llamadas no está disponible en ${marca.nombre}.` });
  }
  const caso = await traerCasoAutorizado(req, res);
  if (!caso) return;

  const [analisis, mensaje, puntajes, rqrAbierto] = await Promise.all([
    prisma.sentimentAnalysis.findFirst({
      where: { casoId: caso.id, esLlamada: true },
      orderBy: { analyzedAt: "desc" },
      select: { estrellas: true, analyzedAt: true },
    }),
    prisma.whatsappMessage.findFirst({
      where: {
        casoId: caso.id,
        direction: MessageDirection.ENTRANTE,
        content: { startsWith: PREFIJO_LLAMADA },
      },
      orderBy: { createdAt: "desc" },
      select: { content: true },
    }),
    caso.area === AreaTrabajo.POSVENTA ? puntajesDelCaso(caso.id) : Promise.resolve([]),
    prisma.rQR.findFirst({
      where: { casoId: caso.id, estado: { in: [EstadoRQR.ABIERTO, EstadoRQR.EN_TRATAMIENTO] }, eliminadoEn: null },
      select: { numeroRQR: true },
    }),
  ]);

  res.json({
    data: {
      estrellasGeneral: analisis?.estrellas ?? null,
      comentario: mensaje ? mensaje.content.slice(PREFIJO_LLAMADA.length) : "",
      // Solo los ítems que a este caso se le preguntaron (sin el lavado cuando
      // al auto no se lo lavaron).
      puntajes: puntajes.filter((x) => !x.noAplica).map((x) => ({ item: x.item, estrellas: x.estrellas })),
      cargadoEn: analisis?.analyzedAt ?? null,
      // Para avisar antes de cambiar una nota que ya abrió un reclamo formal.
      rqrAbierto: rqrAbierto?.numeroRQR ?? null,
    },
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
 * Carga —o CORRIGE— lo que el cliente dijo por teléfono, y da el caso por
 * respondido.
 *
 * La nota NO es obligatoria. Un cliente puede atender, decir que está todo bien y
 * cortar sin dar un número: eso es una respuesta igual, y perderla por no tener
 * puntaje sería peor que guardarla incompleta.
 *
 * SE PUEDE VOLVER A CARGAR. Lo que se anota acá lo tipea una persona apurada
 * mientras habla por teléfono, así que equivocarse es normal: una estrella de
 * más, un comentario incompleto, el caso equivocado. Hasta ahora eso quedaba
 * grabado para siempre —la nota entraba en el promedio del asesor y podía abrir
 * un RQR— y la única salida era pedirlo por base de datos.
 *
 * Corregir NO apila: se actualiza el análisis que ya existe y el comentario que
 * ya está en la conversación, en vez de crear otro. Si cada corrección dejara un
 * registro nuevo, el caso contaría dos veces en los reportes y la conversación
 * tendría el mismo comentario repetido con dos textos distintos.
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

  if (!(ESTADOS_QUE_ACEPTAN_LLAMADA as readonly EstadoContacto[]).includes(caso.estadoContacto)) {
    return res.status(409).json({
      message:
        `Este formulario es para los casos que se cierran por llamada, y este está en ${caso.estadoContacto}. ` +
        `Si el cliente contestó por WhatsApp, su calificación sale de lo que escribió.`,
    });
  }
  const esCorreccion = caso.estadoContacto === EstadoContacto.RESPONDIO_LLAMADA;

  const { puntajes, estrellasGeneral, comentario } = parseo.data;
  const texto = comentario?.trim() ?? "";

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

  // ------------------------------------------------------------------------
  // El comentario, como un mensaje más de la conversación
  // ------------------------------------------------------------------------
  //
  // Va ahí y no en un campo aparte porque, para quien lee el caso, lo que el
  // cliente dijo por teléfono vale igual que lo que escribió por WhatsApp.
  //
  // Nace YA ANALIZADO: lo acaba de cargar una persona, no hay nada que la IA
  // tenga que interpretar. Sin esto quedaba esperando y se colaba en el próximo
  // análisis del caso, mezclado con el mensaje nuevo del cliente.
  const mensajePrevio = await prisma.whatsappMessage.findFirst({
    where: {
      casoId: caso.id,
      direction: MessageDirection.ENTRANTE,
      content: { startsWith: PREFIJO_LLAMADA },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  let mensajeId: string | null = mensajePrevio?.id ?? null;
  if (texto && mensajePrevio) {
    await prisma.whatsappMessage.update({
      where: { id: mensajePrevio.id },
      data: { content: `${PREFIJO_LLAMADA}${texto}` },
    });
  } else if (texto) {
    const mensaje = await prisma.whatsappMessage.create({
      data: {
        casoId: caso.id,
        direction: MessageDirection.ENTRANTE,
        content: `${PREFIJO_LLAMADA}${texto}`,
        status: "recibido",
        analizadoEn: new Date(),
      },
    });
    mensajeId = mensaje.id;
  } else if (mensajePrevio) {
    // Borró el comentario: el mensaje se va con él. Dejarlo sería dejar en la
    // conversación algo que la persona que habló con el cliente acaba de decir
    // que no es lo que pasó.
    //
    // Primero se lo desengancha del análisis: la relación borra en cascada, y
    // borrar el mensaje de una se llevaría puesta la calificación del caso.
    await prisma.$transaction([
      prisma.sentimentAnalysis.updateMany({
        where: { casoId: caso.id, messageId: mensajePrevio.id },
        data: { messageId: null },
      }),
      prisma.whatsappMessage.delete({ where: { id: mensajePrevio.id } }),
    ]);
    mensajeId = null;
  }

  // ------------------------------------------------------------------------
  // La calificación tiene que valer lo mismo que una por WhatsApp
  // ------------------------------------------------------------------------
  //
  // Un caso rescatado por teléfono cuenta igual que uno que contestó solo: si la
  // nota no queda registrada como una clasificación del caso, ese cliente no
  // aparece en ningún tablero, no entra en el promedio del asesor y no abre RQR
  // aunque haya dicho que la pasó mal. Por eso se guarda el mismo análisis que
  // crea la IA, marcado como que lo cargó una persona.
  const llamadaPrevia = await prisma.sentimentAnalysis.findFirst({
    where: { casoId: caso.id, esLlamada: true },
    orderBy: { analyzedAt: "desc" },
    select: { id: true, requiereRQR: true },
  });

  const derivado = estrellas !== null ? derivarDeEstrellas(estrellas) : null;
  const requiereRQR = aplicarReglaRQR(derivado?.semaforo ?? null, derivado?.severidad ?? null);
  const resumen =
    estrellas !== null
      ? texto
        ? `Respuesta por teléfono (${estrellas} de 5): ${texto}`
        : `Respuesta por teléfono: ${estrellas} de 5.`
      : texto
        ? `Respuesta por teléfono, sin calificación: ${texto}`
        : "Respondió por teléfono, sin calificación ni comentario.";

  const datos = {
    messageId: mensajeId,
    semaforo: derivado?.semaforo ?? null,
    severidad: derivado?.severidad ?? null,
    estrellas,
    // La cargó una persona que habló con el cliente: no hay nada que interpretar
    // ni margen de error de lectura.
    confianza: 1,
    resumenIA: resumen,
    respuestaCrudaIA: {
      motivo: "llamada-telefonica",
      estrellas,
      comentario: texto || null,
      cargadoPor: req.usuario!.email,
      corregido: esCorreccion,
    },
    requiereRQR,
    esLlamada: true,
    esSeguimiento: false,
    mensajesAnalizados: mensajeId ? 1 : 0,
  };

  let analisisId: string;
  if (llamadaPrevia) {
    // Se corrige el que ya estaba. Crear otro dejaría el caso con dos análisis
    // principales y contándose dos veces en los reportes.
    const actualizado = await prisma.sentimentAnalysis.update({
      where: { id: llamadaPrevia.id },
      data: { ...datos, analyzedAt: new Date() },
      select: { id: true },
    });
    analisisId = actualizado.id;
  } else {
    // Invariante del sistema: un solo análisis principal por caso. El que estaba
    // (si lo había) pasa a seguimiento.
    const [, creado] = await prisma.$transaction([
      prisma.sentimentAnalysis.updateMany({
        where: { casoId: caso.id, esSeguimiento: false },
        data: { esSeguimiento: true },
      }),
      prisma.sentimentAnalysis.create({ data: { casoId: caso.id, ...datos }, select: { id: true } }),
    ]);
    analisisId = creado.id;
  }

  // Los puntajes se pisan tal como vinieron (sobrescribir), incluso en blanco:
  // es una persona corrigiendo un formulario, y si saca una estrella que puso
  // por error tiene que desaparecer de verdad.
  if (porItems.length) await guardarPuntajes(caso.id, porItems, analisisId, { sobrescribir: true });

  // ------------------------------------------------------------------------
  // El RQR
  // ------------------------------------------------------------------------
  //
  // Se abre si la nota lo pide y el caso no tiene ya uno abierto.
  //
  // Lo que NO se hace es cerrarlo solo cuando la corrección sube la nota. Un RQR
  // abierto puede tener a alguien trabajándolo, con su bitácora y sus acciones:
  // borrarlo porque cambió un número sería tirar trabajo de otro. Se avisa y lo
  // cierra una persona.
  let aviso: string | null = null;
  const rqrAbierto = await prisma.rQR.findFirst({
    where: { casoId: caso.id, estado: { in: [EstadoRQR.ABIERTO, EstadoRQR.EN_TRATAMIENTO] }, eliminadoEn: null },
    select: { numeroRQR: true },
  });

  if (requiereRQR && !rqrAbierto) {
    const completo = await prisma.caso.findUnique({ where: { id: caso.id } });
    const analisis = await prisma.sentimentAnalysis.findUnique({ where: { id: analisisId } });
    if (completo && analisis) {
      const { rqr, accion } = await crearRqrAutomatico({
        caso: completo,
        analisis,
        textoCliente: texto || resumen,
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
      aviso = `Se abrió el ${rqr.numeroRQR}.`;
    }
  } else if (!requiereRQR && rqrAbierto) {
    aviso =
      `Ojo: el caso tiene el ${rqrAbierto.numeroRQR} abierto, que se abrió con la calificación anterior. ` +
      `La nota nueva ya no lo justifica, pero no se cierra solo: si ya no corresponde, cerralo desde RQR.`;
  }

  auditar(req, {
    accion: ACCIONES.LLAMADA_CARGADA,
    entidad: "Caso",
    entidadId: caso.id,
    detalles: {
      cliente: caso.nombrePropietario,
      area: caso.area,
      correccion: esCorreccion,
      items: porItems.length,
      estrellas,
      conComentario: !!texto,
    },
  });

  res.json({
    message:
      (esCorreccion
        ? "Listo, se corrigió lo que había cargado de la llamada."
        : "Listo, quedó cargado lo que dijo el cliente por teléfono.") + (aviso ? ` ${aviso}` : ""),
  });
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
