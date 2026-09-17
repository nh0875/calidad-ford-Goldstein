import { AreaTrabajo, EstadoEncuestaFabrica, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { marca, sucursalCanonica } from "../config/marca";
import { claveNormalizada } from "./normalizacion.service";
import { variantesDeSucursal } from "./area.service";
import {
  calcularSeguimiento,
  ClienteSeguimiento,
  SeguimientoEncuestasVW,
} from "./seguimiento-encuesta-vw.service";

/**
 * Encuestas de fábrica de POSVENTA (Volkswagen, pedido de Calidad del 16-09-2026).
 *
 * QUÉ ES. Un cliente de Posventa de la sucursal configurada (Mendoza) que calificó
 * con 5 estrellas es un PROMOTOR: justo el cliente que conviene que conteste la
 * encuesta de fábrica. Entra solo a esta lista para que Calidad lo anime a
 * responderla, con el mismo circuito que las encuestas de Ventas: Pendiente →
 * Animado → Respondió.
 *
 * DE DÓNDE SALE, Y POR QUÉ NO ES UN EVENTO. Un caso puede quedar en 5 por tres
 * caminos distintos (la respuesta por WhatsApp que analiza la IA, el 3er contacto
 * por llamada, y la corrección a mano en Seguimiento) y puede DEJAR de estarlo
 * después (el cliente se queja en un mensaje posterior, o Calidad corrige la nota).
 * Engancharse a uno solo de esos caminos dejaría afuera a los otros sin que nadie
 * se entere. Por eso la lista se SINCRONIZA contra el dato: el análisis principal
 * del caso, el mismo que usa todo el sistema (analisisPrincipal: el más nuevo que
 * no es de seguimiento). La sincronización corre cada vez que alguien abre la
 * pestaña, pide sus gráficos o el menú cuenta los pendientes, así que un 5 nuevo
 * aparece enseguida.
 *
 * UN 5 QUE LA IA PIDIÓ REVISAR NO CUENTA. Si el análisis quedó para revisión
 * manual, el 5 todavía no es de nadie: entra cuando una persona lo confirma en
 * Seguimiento (la misma regla que decide el mensaje de agradecimiento de promotor).
 *
 * LOS QUE DEJAN DE SER PROMOTORES (la nota bajó, o el caso se corrigió y ya no es
 * de Posventa de esa sucursal). Si todavía estaban Pendientes, salen: nadie los
 * trabajó. Si Calidad ya los había animado o ya respondieron, la fila se conserva
 * en la base: la nota que bajó se marca en la lista; el caso que ya no es de la
 * sucursal deja de listarse y de contarse, y vuelve con su estado si se lo corrige.
 *
 * EL MES. Es el del SERVICIO (la salida del taller o, si no está, la apertura de la
 * orden): la encuesta de fábrica le llega al cliente por ese servicio, igual que en
 * Ventas el mes es el del patentamiento.
 */

const ESTRELLAS_PROMOTOR = 5;

/**
 * "AAAA-MM" del servicio.
 *
 * Las fechas del caso llegan de tres formas: medianoche local (Excel con la fecha
 * sola, export de fábrica), mediodía local (alta y edición manual del caso) o fecha
 * con hora (Excel del DMS: "Fecha Cierre" a las 14:23). Todas se leen con el mes
 * LOCAL, igual que los filtros de fecha del resto del sistema. La única excepción es
 * la medianoche UTC exacta (una fecha sola interpretada como UTC, que acá serían las
 * 21 h del día anterior): ahí el mes es el de UTC.
 *
 * NO se corre la fecha: un corrimiento fijo mandaba al mes siguiente los cierres de
 * la tarde del último día del mes y los casos manuales de fin de mes (lo encontró la
 * revisión del 16-09-2026).
 */
export function periodoDelServicio(fecha: Date | null | undefined): string | null {
  if (!fecha || isNaN(fecha.getTime())) return null;
  const medianocheUTC =
    fecha.getUTCHours() === 0 &&
    fecha.getUTCMinutes() === 0 &&
    fecha.getUTCSeconds() === 0 &&
    fecha.getUTCMilliseconds() === 0;
  const anio = medianocheUTC ? fecha.getUTCFullYear() : fecha.getFullYear();
  const mes = medianocheUTC ? fecha.getUTCMonth() : fecha.getMonth();
  return `${anio}-${String(mes + 1).padStart(2, "0")}`;
}

/**
 * Los casos que pertenecen a la lista: Posventa de la sucursal configurada, sin
 * eliminar. La sucursal se compara con todas sus variantes escritas ("MENDOZA",
 * "Mendoza "): Postgres no pliega tildes ni mayúsculas.
 */
export async function whereCasoDeLaLista(): Promise<Prisma.CasoWhereInput> {
  const sucursal = marca.encuestaFabricaPV.sucursal;
  const variantes = sucursal ? await variantesDeSucursal(sucursal) : [];
  return { eliminadoEn: null, area: AreaTrabajo.POSVENTA, sucursal: { in: variantes } };
}

// La sincronización se hace al abrir la pestaña y al pedir sus gráficos. El
// contador del menú se pide seguido: para ese caso alcanza con que se haya
// sincronizado hace un rato.
let ultimaSincronizacion = 0;

/**
 * Pone la lista al día con los análisis: agrega los promotores nuevos y saca los
 * pendientes que dejaron de serlo. Idempotente: se puede llamar cuantas veces haga
 * falta.
 */
export async function sincronizarPromotoresPV(opciones: { siPasaronMs?: number } = {}): Promise<void> {
  const config = marca.encuestaFabricaPV;
  if (!config.habilitado || !config.sucursal) return;
  if (opciones.siPasaronMs && Date.now() - ultimaSincronizacion < opciones.siPasaronMs) return;

  // Los pendientes se leen ANTES que los análisis. Si otra sincronización que corre
  // a la vez inserta un promotor recién calificado, esta no lo ve acá y no lo borra
  // por no haberlo visto también entre los candidatos.
  // Los de un MES CERRADO no se tocan: quedan como estaban para consultarlos, aunque
  // la nota del caso haya cambiado (decisión del 17-09-2026). Tampoco se duplican:
  // el índice único de casoId los sigue cubriendo en el createMany de abajo.
  const pendientes = await prisma.encuestaFabricaPV.findMany({
    where: { estado: EstadoEncuestaFabrica.PENDIENTE, cerradoEn: null },
    select: { id: true, casoId: true },
  });

  const casoDeLaLista = await whereCasoDeLaLista();
  const candidatos = await prisma.sentimentAnalysis.findMany({
    where: {
      esSeguimiento: false,
      estrellas: ESTRELLAS_PROMOTOR,
      requiereRevisionManual: false,
      caso: casoDeLaLista,
    },
    select: { casoId: true },
  });
  const idsCandidatos = [...new Set(candidatos.map((c) => c.casoId))];

  // Un 5 viejo puede estar tapado por una corrección posterior: lo que cuenta es el
  // análisis principal, el más nuevo que no es de seguimiento.
  const principales = idsCandidatos.length
    ? await prisma.sentimentAnalysis.findMany({
        where: { casoId: { in: idsCandidatos }, esSeguimiento: false },
        orderBy: { analyzedAt: "desc" },
        select: { casoId: true, estrellas: true, analyzedAt: true, requiereRevisionManual: true },
      })
    : [];
  const principalPorCaso = new Map<
    string,
    { estrellas: number | null; analyzedAt: Date; requiereRevisionManual: boolean }
  >();
  for (const a of principales) {
    if (!principalPorCaso.has(a.casoId)) principalPorCaso.set(a.casoId, a);
  }
  const promotores = [...principalPorCaso.entries()].filter(
    ([, a]) => a.estrellas === ESTRELLAS_PROMOTOR && !a.requiereRevisionManual
  );

  if (promotores.length) {
    // skipDuplicates: si dos pedidos sincronizan a la vez, el índice único de
    // casoId hace que el segundo no duplique nada.
    await prisma.encuestaFabricaPV.createMany({
      data: promotores.map(([casoId, a]) => ({ casoId, calificadoEn: a.analyzedAt })),
      skipDuplicates: true,
    });
  }

  const idsPromotores = new Set(promotores.map(([casoId]) => casoId));
  const sobran = pendientes.filter((p) => !idsPromotores.has(p.casoId)).map((p) => p.id);
  if (sobran.length) {
    // El estado va también en el where: si justo alguien lo animó entre la lectura
    // y el borrado, ya no es un pendiente y se queda.
    await prisma.encuestaFabricaPV.deleteMany({
      where: { id: { in: sobran }, estado: EstadoEncuestaFabrica.PENDIENTE, cerradoEn: null },
    });
  }

  ultimaSincronizacion = Date.now();
}

/**
 * ¿Este caso seguiría en la lista si estuviera Pendiente? La misma regla que la
 * sincronización. La usa el cambio de estado para no dejar volver a Pendiente a un
 * cliente que la próxima sincronización borraría con todo lo trabajado.
 */
export async function esPromotorPV(casoId: string): Promise<boolean> {
  const config = marca.encuestaFabricaPV;
  if (!config.habilitado || !config.sucursal) return false;
  const caso = await prisma.caso.findFirst({
    where: { id: casoId, ...(await whereCasoDeLaLista()) },
    select: { id: true },
  });
  if (!caso) return false;
  const principal = await prisma.sentimentAnalysis.findFirst({
    where: { casoId, esSeguimiento: false },
    orderBy: { analyzedAt: "desc" },
    select: { estrellas: true, requiereRevisionManual: true },
  });
  return principal?.estrellas === ESTRELLAS_PROMOTOR && !principal.requiereRevisionManual;
}

/** ¿El caso sigue siendo de la lista (Posventa de la sucursal, sin eliminar)? */
export async function casoEsDeLaLista(casoId: string): Promise<boolean> {
  const caso = await prisma.caso.findFirst({
    where: { id: casoId, ...(await whereCasoDeLaLista()) },
    select: { id: true },
  });
  return !!caso;
}

/** La nota del análisis principal de cada caso. */
async function notasActuales(
  casoIds: string[]
): Promise<Map<string, { estrellas: number | null; requiereRevisionManual: boolean }>> {
  const mapa = new Map<string, { estrellas: number | null; requiereRevisionManual: boolean }>();
  if (!casoIds.length) return mapa;
  const filas = await prisma.sentimentAnalysis.findMany({
    where: { casoId: { in: casoIds }, esSeguimiento: false },
    orderBy: { analyzedAt: "desc" },
    select: { casoId: true, estrellas: true, requiereRevisionManual: true },
  });
  for (const f of filas) {
    if (!mapa.has(f.casoId)) mapa.set(f.casoId, f);
  }
  return mapa;
}

export interface PromotorPV {
  id: string;
  estado: EstadoEncuestaFabrica;
  calificadoEn: Date | null;
  detectadaEn: Date;
  animadoEn: Date | null;
  respondioEn: Date | null;
  periodo: string | null;
  /** false si la nota del caso ya no es un 5 confirmado (solo pasa con los animados o respondidos). */
  sigueSiendoPromotor: boolean;
  estrellasActuales: number | null;
  /** La nota actual quedó para revisión manual. */
  notaEnRevision: boolean;
  caso: {
    id: string;
    numeroOrden: string;
    nombrePropietario: string;
    telefono: string;
    modelo: string;
    patente: string;
    asesor: string;
    sucursal: string;
    fechaServicio: Date | null;
  };
}

const ORDEN_ESTADO: Record<EstadoEncuestaFabrica, number> = {
  PENDIENTE: 0,
  AVISADO: 1,
  RESPONDIO: 2,
};

const INCLUDE_CASO = {
  caso: {
    select: {
      id: true,
      numeroOrden: true,
      nombrePropietario: true,
      whatsapp: true,
      celular: true,
      modelo: true,
      patente: true,
      asesor: true,
      sucursal: true,
      fechaSalida: true,
      fechaProgramacion: true,
    },
  },
} satisfies Prisma.EncuestaFabricaPVInclude;

type FilaPV = Prisma.EncuestaFabricaPVGetPayload<{ include: typeof INCLUDE_CASO }>;

/** Las filas como las muestra la pantalla, en el orden de trabajo. */
async function aPromotores(filas: FilaPV[]): Promise<PromotorPV[]> {
  const notas = await notasActuales(filas.map((f) => f.casoId));
  return filas
    .map((f) => {
      const fechaServicio = f.caso.fechaSalida ?? f.caso.fechaProgramacion ?? null;
      const nota = notas.get(f.casoId);
      const estrellas = nota?.estrellas ?? null;
      const enRevision = nota?.requiereRevisionManual ?? false;
      return {
        id: f.id,
        estado: f.estado,
        calificadoEn: f.calificadoEn,
        detectadaEn: f.detectadaEn,
        animadoEn: f.animadoEn,
        respondioEn: f.respondioEn,
        // Un cliente cerrado queda en el mes en que se cerró, aunque después se
        // corrija la fecha del caso.
        periodo: f.cerradoEn ? f.periodoCierre : periodoDelServicio(fechaServicio),
        sigueSiendoPromotor: estrellas === ESTRELLAS_PROMOTOR && !enRevision,
        estrellasActuales: estrellas,
        notaEnRevision: enRevision,
        caso: {
          id: f.caso.id,
          numeroOrden: f.caso.numeroOrden,
          nombrePropietario: f.caso.nombrePropietario,
          telefono: f.caso.whatsapp || f.caso.celular || "",
          modelo: f.caso.modelo,
          patente: f.caso.patente,
          asesor: f.caso.asesor,
          sucursal: sucursalCanonica(f.caso.sucursal) ?? f.caso.sucursal,
          fechaServicio,
        },
      };
    })
    // Primero lo que falta hacer; adentro de cada estado, los que calificaron más
    // recientemente arriba (son los que tienen el servicio fresco en la memoria).
    .sort((a, b) => {
      const e = ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado];
      if (e !== 0) return e;
      return (b.calificadoEn?.getTime() ?? 0) - (a.calificadoEn?.getTime() ?? 0);
    });
}

/** La lista de trabajo: sin los clientes de los meses cerrados. */
export async function listarPromotoresPV(): Promise<{
  data: PromotorPV[];
  resumen: { pendientes: number; animados: number; respondieron: number; total: number };
}> {
  await sincronizarPromotoresPV();

  const filas = await prisma.encuestaFabricaPV.findMany({
    where: { caso: await whereCasoDeLaLista(), cerradoEn: null },
    include: INCLUDE_CASO,
  });
  const data = await aPromotores(filas);

  return {
    data,
    resumen: {
      pendientes: data.filter((d) => d.estado === EstadoEncuestaFabrica.PENDIENTE).length,
      animados: data.filter((d) => d.estado === EstadoEncuestaFabrica.AVISADO).length,
      respondieron: data.filter((d) => d.estado === EstadoEncuestaFabrica.RESPONDIO).length,
      total: data.length,
    },
  };
}

/** Los clientes de un mes cerrado, para consultarlos. */
export async function listarPromotoresCerradosPV(periodo: string): Promise<PromotorPV[]> {
  const filas = await prisma.encuestaFabricaPV.findMany({
    where: { caso: await whereCasoDeLaLista(), cerradoEn: { not: null }, periodoCierre: periodo },
    include: INCLUDE_CASO,
  });
  return aPromotores(filas);
}

/** Pendientes de animar, para el contador del menú. Mismo criterio que el resumen de la lista. */
export async function contarPendientesPV(): Promise<number> {
  await sincronizarPromotoresPV({ siPasaronMs: 30_000 });
  return prisma.encuestaFabricaPV.count({
    where: { estado: EstadoEncuestaFabrica.PENDIENTE, cerradoEn: null, caso: await whereCasoDeLaLista() },
  });
}

/** El renglón del ranking de los casos que no tienen asesor cargado. */
const SIN_ASESOR = { codigo: "sin-asesor", nombre: "Sin asesor" };

/**
 * El seguimiento mes a mes. Reusa el cálculo de las encuestas de Ventas
 * (calcularSeguimiento): mismas definiciones de animado, tasa y efectividad. Lo
 * que en Ventas es el vendedor, acá es el ASESOR de servicio del caso.
 */
export async function seguimientoEncuestasPV(opciones: { periodo: string | null }): Promise<SeguimientoEncuestasVW> {
  await sincronizarPromotoresPV();
  const filas = await prisma.encuestaFabricaPV.findMany({
    where: { caso: await whereCasoDeLaLista() },
    select: {
      estado: true,
      animadoEn: true,
      cerradoEn: true,
      periodoCierre: true,
      caso: { select: { asesor: true, sucursal: true, fechaSalida: true, fechaProgramacion: true } },
    },
  });
  const clientes: ClienteSeguimiento[] = filas.map((f) => {
    const fecha = f.caso.fechaSalida ?? f.caso.fechaProgramacion ?? null;
    const asesor = (f.caso.asesor ?? "").trim();
    // "(sin asesor)" es lo que deja la importación de formularios cuando falta el dato:
    // cuenta igual que un asesor vacío, en un solo renglón.
    const conAsesor = asesor !== "" && asesor !== "(sin asesor)";
    // La sucursal como la escribe la marca ("Mendoza"), no como vino en el Excel.
    const sucursal = sucursalCanonica(f.caso.sucursal) ?? f.caso.sucursal;
    return {
      // Un cliente cerrado cuenta en el mes en que se cerró, igual que en la lista y
      // en el panel de cierre, aunque después se corrija la fecha del caso.
      periodo: f.cerradoEn ? f.periodoCierre : periodoDelServicio(fecha),
      // En Ventas este campo distingue el mes real del estimado. Acá el mes sale
      // siempre de una fecha del caso, así que nunca es una estimación.
      fechaDominio: fecha,
      estado: f.estado,
      avisadoEn: f.animadoEn,
      sucursal,
      vendedor: {
        codigo: conAsesor ? claveNormalizada(asesor) : SIN_ASESOR.codigo,
        nombre: conAsesor ? asesor : SIN_ASESOR.nombre,
        sucursal,
        email: null,
      },
    };
  });
  return calcularSeguimiento(clientes, { periodo: opciones.periodo });
}
