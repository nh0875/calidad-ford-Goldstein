// Reporte de desempeño de POSVENTA (Volkswagen).
//
// Es el reporte de sentimiento pero mirado por ÍTEM: en vez de "cuántos verdes
// hubo", contesta "cómo viene cada parte del circuito". Esa es la pregunta que
// el área se hace todos los meses, y con una nota sola no se podía responder.
//
// Todo lo que devuelve esta función es lo mismo que sale exportado a Excel y a
// Word: un solo cálculo, para que el reporte impreso no pueda diferir de lo que
// se ve en pantalla.
import { AreaTrabajo, ItemPosventa, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { DEFINICION_ITEMS, ITEM_QUE_DEFINE_EL_CASO, etiquetaItem } from "../config/posventa-vw";

/** Etiqueta de los casos sin asesor o sin sucursal cargados. */
const SIN_DATO = "(sin dato)";

export interface FiltrosPosventa {
  fechaDesde?: string;
  fechaHasta?: string;
  sucursal?: string;
  asesor?: string;
}

/** Un ítem con sus números. */
export interface ResumenItem {
  item: ItemPosventa;
  etiqueta: string;
  descripcion: string;
  /** Cuántos clientes puntuaron ESTE ítem. */
  respuestas: number;
  /** Promedio 1-5, o null si nadie lo puntuó. */
  promedio: number | null;
  /** Cuántos pusieron 1, 2, 3, 4 y 5. */
  distribucion: Record<string, number>;
  /** % de 5 estrellas: la meta del área. */
  porcentajeCinco: number | null;
  /** % de 1 o 2: lo que hay que atacar. */
  porcentajeMalos: number | null;
}

function promedio(valores: number[]): number | null {
  if (valores.length === 0) return null;
  return Math.round((valores.reduce((a, b) => a + b, 0) / valores.length) * 100) / 100;
}

function porcentaje(parte: number, total: number): number | null {
  if (total === 0) return null;
  return Math.round((parte / total) * 1000) / 10;
}

/**
 * Trae todas las evaluaciones que entran en el filtro.
 *
 * El filtro va sobre el CASO (fecha, sucursal, asesor), no sobre la evaluación:
 * lo que se quiere medir es "las visitas al taller de este período", y la
 * evaluación es un dato de esa visita.
 */
async function evaluacionesFiltradas(f: FiltrosPosventa) {
  const whereCaso: Prisma.CasoWhereInput = {
    eliminadoEn: null,
    area: AreaTrabajo.POSVENTA,
    ...(f.fechaDesde || f.fechaHasta
      ? {
          fechaProgramacion: {
            ...(f.fechaDesde ? { gte: new Date(`${f.fechaDesde}T00:00:00`) } : {}),
            ...(f.fechaHasta ? { lte: new Date(`${f.fechaHasta}T23:59:59.999`) } : {}),
          },
        }
      : {}),
    // "(sin dato)" es la etiqueta que pone el agrupador para los casos sin asesor
    // o sin sucursal cargados. La pantalla arma el combo con esas etiquetas, así
    // que hay que traducirla de vuelta: buscarla tal cual no encontraba nada
    // nunca y el reporte salía vacío.
    ...(f.sucursal ? { sucursal: f.sucursal === SIN_DATO ? "" : { equals: f.sucursal, mode: "insensitive" as const } } : {}),
    ...(f.asesor ? { asesor: f.asesor === SIN_DATO ? "" : { equals: f.asesor, mode: "insensitive" as const } } : {}),
  };

  return prisma.evaluacionPosventa.findMany({
    where: { caso: whereCaso },
    select: {
      item: true,
      estrellas: true,
      comentario: true,
      creadoEn: true,
      caso: {
        select: {
          id: true,
          numeroOrden: true,
          nombrePropietario: true,
          sucursal: true,
          asesor: true,
          modelo: true,
          patente: true,
          fechaProgramacion: true,
        },
      },
    },
  });
}

type Evaluacion = Awaited<ReturnType<typeof evaluacionesFiltradas>>[number];

function resumirItems(filas: Evaluacion[]): ResumenItem[] {
  return DEFINICION_ITEMS.map((d) => {
    const delItem = filas.filter((f) => f.item === d.item && f.estrellas !== null);
    const valores = delItem.map((f) => f.estrellas!);
    const distribucion: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
    for (const v of valores) distribucion[String(v)] = (distribucion[String(v)] ?? 0) + 1;
    const malos = distribucion["1"] + distribucion["2"];
    return {
      item: d.item as ItemPosventa,
      etiqueta: d.etiqueta,
      descripcion: d.descripcion,
      respuestas: valores.length,
      promedio: promedio(valores),
      distribucion,
      porcentajeCinco: porcentaje(distribucion["5"], valores.length),
      porcentajeMalos: porcentaje(malos, valores.length),
    };
  });
}

/** Promedio por ítem para un corte (asesor o sucursal). */
function agruparPor(
  filas: Evaluacion[],
  clave: (e: Evaluacion) => string
): Array<{ nombre: string; respuestas: number; promedioGeneral: number | null; porItem: Record<string, number | null> }> {
  const grupos = new Map<string, Evaluacion[]>();
  for (const f of filas) {
    const k = clave(f) || "(sin dato)";
    const lista = grupos.get(k) ?? [];
    lista.push(f);
    grupos.set(k, lista);
  }

  return [...grupos.entries()]
    .map(([nombre, lista]) => {
      const porItem: Record<string, number | null> = {};
      for (const d of DEFINICION_ITEMS) {
        porItem[d.item] = promedio(
          lista.filter((f) => f.item === d.item && f.estrellas !== null).map((f) => f.estrellas!)
        );
      }
      // Los casos distintos que puntuaron el ítem general: es la cantidad de
      // clientes, no de puntajes (que serían hasta 5 por cliente).
      const casosGenerales = new Set(
        lista.filter((f) => f.item === ITEM_QUE_DEFINE_EL_CASO && f.estrellas !== null).map((f) => f.caso.id)
      );
      return {
        nombre,
        respuestas: casosGenerales.size,
        promedioGeneral: porItem[ITEM_QUE_DEFINE_EL_CASO] ?? null,
        porItem,
      };
    })
    // El peor promedio general primero: es a quien hay que ayudar.
    .sort((a, b) => (a.promedioGeneral ?? 99) - (b.promedioGeneral ?? 99));
}

export interface ReporteDesempenoPosventa {
  filtros: FiltrosPosventa;
  /** Clientes distintos que contestaron al menos un ítem. */
  clientesQueContestaron: number;
  items: ResumenItem[];
  /** El ítem con peor promedio: es el titular del reporte. */
  itemMasFlojo: { item: string; etiqueta: string; promedio: number } | null;
  porAsesor: ReturnType<typeof agruparPor>;
  porSucursal: ReturnType<typeof agruparPor>;
  /** Comentarios de los clientes, para que los números tengan cara. */
  comentarios: Array<{
    item: string;
    etiqueta: string;
    estrellas: number | null;
    comentario: string;
    cliente: string;
    sucursal: string;
    asesor: string;
    fecha: string;
  }>;
  /** Detalle caso por caso (lo que se exporta a Excel). */
  detalle: Array<{
    numeroOrden: string;
    cliente: string;
    sucursal: string;
    asesor: string;
    modelo: string;
    fecha: string;
    puntajes: Record<string, number | null>;
  }>;
}

function fechaCorta(d: Date | null): string {
  if (!d) return "—";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export async function reporteDesempenoPosventa(f: FiltrosPosventa): Promise<ReporteDesempenoPosventa> {
  const filas = await evaluacionesFiltradas(f);
  const items = resumirItems(filas);

  const conPromedio = items.filter((i) => i.promedio !== null);
  const masFlojo =
    conPromedio.length > 0
      ? conPromedio.reduce((peor, i) => (i.promedio! < peor.promedio! ? i : peor))
      : null;

  // Detalle por caso: una fila por cliente con sus 5 puntajes.
  const porCaso = new Map<string, Evaluacion[]>();
  for (const fila of filas) {
    const lista = porCaso.get(fila.caso.id) ?? [];
    lista.push(fila);
    porCaso.set(fila.caso.id, lista);
  }

  const detalle = [...porCaso.values()]
    .map((lista) => {
      const c = lista[0].caso;
      const puntajes: Record<string, number | null> = {};
      for (const d of DEFINICION_ITEMS) {
        puntajes[d.item] = lista.find((x) => x.item === d.item)?.estrellas ?? null;
      }
      return {
        numeroOrden: c.numeroOrden,
        cliente: c.nombrePropietario,
        sucursal: c.sucursal,
        asesor: c.asesor,
        modelo: c.modelo,
        fecha: fechaCorta(c.fechaProgramacion),
        puntajes,
      };
    })
    .sort((a, b) => a.numeroOrden.localeCompare(b.numeroOrden));

  const comentarios = filas
    .filter((x) => x.comentario && x.comentario.trim())
    .map((x) => ({
      item: x.item,
      etiqueta: etiquetaItem(x.item),
      estrellas: x.estrellas,
      comentario: x.comentario!.trim(),
      cliente: x.caso.nombrePropietario,
      sucursal: x.caso.sucursal,
      asesor: x.caso.asesor,
      fecha: fechaCorta(x.caso.fechaProgramacion),
    }))
    // Los peores primero: son los que hay que leer.
    .sort((a, b) => (a.estrellas ?? 99) - (b.estrellas ?? 99));

  return {
    filtros: f,
    clientesQueContestaron: porCaso.size,
    items,
    itemMasFlojo: masFlojo ? { item: masFlojo.item, etiqueta: masFlojo.etiqueta, promedio: masFlojo.promedio! } : null,
    porAsesor: agruparPor(filas, (e) => e.caso.asesor),
    porSucursal: agruparPor(filas, (e) => e.caso.sucursal),
    comentarios,
    detalle,
  };
}
