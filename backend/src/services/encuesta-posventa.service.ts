// Encuesta de Posventa por ítems (Volkswagen).
//
// El cliente recibe la plantilla de Posventa con dos botones. Si aprieta
// "Quiero participar por WhatsApp", el sistema le manda UN mensaje con las 5
// preguntas y a partir de ahí su respuesta se puntúa ítem por ítem.
//
// Va en un mensaje solo y no de a una: preguntar de a una da mejor detalle en
// teoría, pero obliga a recordar en qué pregunta va cada cliente, el cliente
// abandona a la mitad y WhatsApp cierra la ventana de texto libre a las 24 hs.
import { AreaTrabajo, EstadoContacto, MessageDirection } from "@prisma/client";
import { marca } from "../config/marca";
import { prisma } from "../config/prisma";
import { DEFINICION_ITEMS, ItemPosventa } from "../config/posventa-vw";
import { CLAVES_CONFIG, obtenerValor } from "./configuracion.service";
import { estaSuprimido, telefonosSuprimidos } from "./supresion.service";
import { WhatsappApiError, sendTextMessage } from "./whatsapp.service";

/**
 * ¿Este caso usa la encuesta por ítems?
 *
 * Solo en las marcas que la tienen habilitada Y solo en POSVENTA: Ventas es otro
 * circuito, con otra gente y otros tiempos, y se sigue clasificando como siempre.
 */
export function usaEncuestaPorItems(area: AreaTrabajo): boolean {
  return marca.posventaPorItems && area === AreaTrabajo.POSVENTA;
}

/** ¿El texto que llegó es el botón de "participar por WhatsApp"? */
export async function esBotonParticiparWhatsapp(contenido: string, esBoton: boolean): Promise<boolean> {
  if (!esBoton) return false;
  const titulo = (await obtenerValor(CLAVES_CONFIG.POSVENTA_TEXTO_BOTON_WHATSAPP)).trim().toLowerCase();
  if (!titulo) return false;
  return contenido.trim().toLowerCase() === titulo;
}

/** ¿El texto que llegó es el botón de "participar por llamada"? */
export async function esBotonParticiparLlamada(contenido: string, esBoton: boolean): Promise<boolean> {
  if (!esBoton) return false;
  const titulo = (await obtenerValor(CLAVES_CONFIG.POSVENTA_TEXTO_BOTON_LLAMADA)).trim().toLowerCase();
  if (!titulo) return false;
  return contenido.trim().toLowerCase() === titulo;
}

/**
 * El cliente pidió que lo llamen. Se deja anotado y NO se le manda nada.
 *
 * Es importante que no se analice ese mensaje: apretar "quiero que me llamen" no
 * es una opinión sobre el servicio. Antes caía como un mensaje cualquiera, la IA
 * lo clasificaba (daba AMARILLO) y al cliente le llegaba el mensaje automático de
 * "lamentamos que tu experiencia no haya sido la esperada", que no tiene nada que
 * ver con lo que pidió. Y encima nadie se enteraba de que había pedido el llamado.
 */
export async function marcarQuiereLlamado(
  casoId: string,
  waMessageIdBoton?: string
): Promise<{ marcado: boolean; motivo?: string }> {
  const caso = await prisma.caso.findUnique({ where: { id: casoId } });
  if (!caso || caso.eliminadoEn) return { marcado: false, motivo: "caso inexistente o eliminado" };

  await prisma.caso.update({
    where: { id: caso.id },
    data: {
      quiereLlamadoEn: new Date(),
      ...(caso.estadoContacto === EstadoContacto.ENVIADO
        ? { estadoContacto: EstadoContacto.RESPONDIDO }
        : {}),
    },
  });

  // El mensaje del botón no se analiza (ver arriba).
  if (waMessageIdBoton) {
    await prisma.whatsappMessage.updateMany({
      where: { casoId: caso.id, waMessageId: waMessageIdBoton, analizadoEn: null },
      data: { analizadoEn: new Date() },
    });
  }

  console.log(`[encuesta-posventa] el caso ${caso.numeroOrden} pidió que lo llamen`);
  return { marcado: true };
}

export interface ResultadoEnvioPreguntas {
  enviado: boolean;
  motivo?: string;
}

/**
 * Le manda al cliente las 5 preguntas y deja marcado el caso.
 *
 * La marca (`encuestaItemsEnviadaEn`) es la que después le dice al analizador
 * que el próximo mensaje del cliente está contestando la encuesta y no es un
 * comentario suelto. También evita mandarlas dos veces si vuelve a apretar el
 * botón.
 */
export async function enviarPreguntasPosventa(
  casoId: string,
  /** waMessageId del mensaje del BOTÓN, para no analizarlo después. */
  waMessageIdBoton?: string
): Promise<ResultadoEnvioPreguntas> {
  const caso = await prisma.caso.findUnique({ where: { id: casoId } });
  if (!caso || caso.eliminadoEn) return { enviado: false, motivo: "caso inexistente o eliminado" };

  // El mensaje del BOTÓN se marca como analizado ACÁ ARRIBA, antes de cualquier
  // otro corte.
  //
  // Apretar un botón no es una opinión y nunca tiene que entrar al análisis. Si
  // esto se hiciera recién al final, el segundo apretón (que corta en "ya se le
  // habían mandado") dejaría ese mensaje sin marcar: se consolidaría con la
  // respuesta que el cliente mande después y el analizador recibiría
  // "(1) Quiero participar por Whatsapp (2) 5 4 5 3 4", que el parser de números
  // ya no reconoce.
  if (waMessageIdBoton) {
    await prisma.whatsappMessage.updateMany({
      where: { casoId: caso.id, waMessageId: waMessageIdBoton, analizadoEn: null },
      data: { analizadoEn: new Date() },
    });
  }

  if (!usaEncuestaPorItems(caso.area)) return { enviado: false, motivo: "la marca o el área no usan encuesta por ítems" };
  if (caso.encuestaItemsEnviadaEn) return { enviado: false, motivo: "ya se le habían mandado" };
  if (caso.whatsappOptOut) return { enviado: false, motivo: "opt-out" };
  if (estaSuprimido(caso.telefonosNorm, await telefonosSuprimidos())) {
    return { enviado: false, motivo: "teléfono suprimido" };
  }
  if ((await obtenerValor(CLAVES_CONFIG.POSVENTA_ENVIAR_PREGUNTAS)) !== "true") {
    return { enviado: false, motivo: "el envío automático está apagado en Configuración" };
  }

  const telefono = caso.whatsapp?.trim() || caso.celular?.trim() || "";
  if (!telefono.startsWith("+")) return { enviado: false, motivo: "sin teléfono válido" };

  const texto = (await obtenerValor(CLAVES_CONFIG.POSVENTA_PREGUNTAS)).trim();
  if (!texto) return { enviado: false, motivo: "el texto de las preguntas está vacío en Configuración" };

  let waMessageId: string;
  try {
    ({ waMessageId } = await sendTextMessage(telefono, texto));
  } catch (err) {
    // No se corta el webhook por esto: el cliente ya dijo que quiere participar y
    // eso queda registrado. Si el envío falla, Calidad lo ve en Seguimiento y le
    // puede escribir a mano.
    console.error(
      `[encuesta-posventa] no se pudieron enviar las preguntas del caso ${caso.numeroOrden}:`,
      err instanceof WhatsappApiError ? err.message : err
    );
    return { enviado: false, motivo: "falló el envío por WhatsApp" };
  }

  await prisma.$transaction([
    prisma.whatsappMessage.create({
      data: {
        casoId: caso.id,
        direction: MessageDirection.SALIENTE,
        content: texto,
        status: "enviado",
        waMessageId,
        // Es un mensaje automático del sistema, no lo escribió una persona.
        esAgradecimiento: true,
      },
    }),
    prisma.caso.update({
      where: { id: caso.id },
      data: {
        encuestaItemsEnviadaEn: new Date(),
        // El cliente contestó el template: el caso pasa a RESPONDIDO igual que
        // con cualquier otra respuesta.
        ...(caso.estadoContacto === EstadoContacto.ENVIADO
          ? { estadoContacto: EstadoContacto.RESPONDIDO }
          : {}),
      },
    }),
  ]);

  console.log(`[encuesta-posventa] preguntas enviadas al caso ${caso.numeroOrden}`);
  return { enviado: true };
}

// ---------------------------------------------------------------------------
// Guardado de los puntajes
// ---------------------------------------------------------------------------

export interface PuntajeItem {
  item: ItemPosventa;
  estrellas: number | null;
  comentario: string | null;
}

/**
 * Guarda (o corrige) los puntajes de un caso.
 *
 * Se hace con upsert por (caso, ítem): si el cliente amplía su respuesta más
 * tarde, se corrige el puntaje que había en vez de sumar otra fila y contarlo
 * dos veces en el promedio del área.
 *
 * Los ítems que el cliente NO contestó se guardan igual con estrellas en null:
 * así el reporte puede distinguir "nadie contestó sobre el lavado" de "el lavado
 * anda bien", que son cosas muy distintas.
 */
export async function guardarPuntajes(
  casoId: string,
  puntajes: PuntajeItem[],
  analisisId?: string
): Promise<number> {
  let guardados = 0;
  for (const p of puntajes) {
    const estrellas = p.estrellas !== null && p.estrellas >= 1 && p.estrellas <= 5 ? p.estrellas : null;
    await prisma.evaluacionPosventa.upsert({
      where: { casoId_item: { casoId, item: p.item } },
      create: {
        casoId,
        item: p.item,
        estrellas,
        comentario: p.comentario?.trim() || null,
        analisisId: analisisId ?? null,
      },
      // OJO: el update NO pisa con null.
      //
      // Un mensaje posterior del cliente ("me olvidé: el auto vino sin lavar")
      // se analiza contra los 5 ítems y devuelve null en los 4 que no menciona.
      // Escribiendo esos null encima, ese cliente perdía los puntajes que YA
      // había dado: sus notas desaparecían del promedio del área y la fila del
      // Excel quedaba con guiones. Peor todavía con un mensaje sin relación
      // ("hola, necesito un turno"), que borraba los cinco.
      //
      // Ahora un mensaje posterior solo puede COMPLETAR o CORREGIR lo que
      // menciona; lo que no menciona queda como estaba.
      update: {
        ...(estrellas !== null ? { estrellas, analisisId: analisisId ?? null } : {}),
        ...(p.comentario?.trim() ? { comentario: p.comentario.trim() } : {}),
      },
    });
    if (estrellas !== null) guardados++;
  }
  return guardados;
}

/** Los puntajes de un caso, en el orden del catálogo. */
export async function puntajesDelCaso(casoId: string) {
  const filas = await prisma.evaluacionPosventa.findMany({ where: { casoId } });
  return DEFINICION_ITEMS.map((d) => {
    const fila = filas.find((f) => f.item === d.item);
    return {
      item: d.item,
      etiqueta: d.etiqueta,
      estrellas: fila?.estrellas ?? null,
      comentario: fila?.comentario ?? null,
    };
  });
}
