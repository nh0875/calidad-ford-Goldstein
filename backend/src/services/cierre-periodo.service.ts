// ---------------------------------------------------------------------------
// Cierre de meses de las encuestas de fábrica (Volkswagen)
// ---------------------------------------------------------------------------
//
// Pedido de Calidad del 17-09-2026: "los clientes de agosto se cierran en agosto,
// los de septiembre en septiembre", y después se pueden volver a consultar, pero
// no aparecen más en la lista principal porque ocupan lugar y confunden.
//
// CÓMO QUEDÓ (decisiones del dueño):
//  - Vale para las dos listas: Encuestas de fábrica (Ventas) y PV.
//  - Se cierra por MES y por PROVINCIA. El mes es el del cliente: en Ventas, el de
//    su Fecha Dominio (el mismo de los gráficos); en PV, el del servicio.
//  - Cierra Calidad con un botón (un usuario con provincia, solo la suya). Reabre
//    solo un administrador.
//  - Además se cierra SOLO: el día 19 de cada mes, el mes anterior, en las dos
//    listas y las dos provincias. Si ese día la PC estaba apagada, cierra apenas
//    arranca. Un mes que un administrador reabrió no se vuelve a cerrar solo.
//    Al instalarse cerró de una vez todos los meses que ya habían pasado su 19.
//  - Un cliente cerrado sale de la lista de trabajo y de los avisos, y solo se
//    consulta: para tocarlo hay que reabrir el mes. Los gráficos lo siguen contando.
//  - Si después de cerrar llega un cliente de ese mes (una carga atrasada, un 5
//    confirmado tarde), NO se esconde: aparece en la lista marcado "mes cerrado",
//    para que alguien lo trabaje. Volver a apretar "Cerrar" lo guarda con los demás.
//
// CÓMO SE GUARDA: cada cliente cerrado tiene `cerradoEn` (y en PV además el mes en
// que quedó, porque ahí el mes no se guarda: sale de las fechas del caso). El mes
// en sí queda en CierrePeriodo, que es lo que dice quién lo cerró, cuándo, y si un
// administrador lo reabrió.

import { ListaCierre, OrigenCierre } from "@prisma/client";
import { prisma } from "../config/prisma";
import { marca, sucursalCanonica } from "../config/marca";
import { claveNormalizada } from "./normalizacion.service";
import { periodoDelServicio, sincronizarPromotoresPV, whereCasoDeLaLista } from "./encuesta-pv.service";
import { ACCIONES, auditar } from "./audit.service";

/** El día del mes en que se cierra solo el mes anterior. */
export const DIA_CIERRE_AUTOMATICO = 19;

const ZONA = "America/Argentina/Buenos_Aires";

/** Año, mes y día de una fecha EN ARGENTINA, sin depender del huso del proceso. */
export function fechaArgentina(fecha: Date): { anio: number; mes: number; dia: number } {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(fecha)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return { anio: Number(partes.year), mes: Number(partes.month), dia: Number(partes.day) };
}

/** "2026-09" corrido `delta` meses: ("2026-01", -1) → "2025-12". */
export function sumarMeses(periodo: string, delta: number): string {
  const [a, m] = periodo.split("-").map(Number);
  const total = a * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export function periodoActual(ahora: Date): string {
  const { anio, mes } = fechaArgentina(ahora);
  return `${anio}-${String(mes).padStart(2, "0")}`;
}

/**
 * El último mes que el cierre automático ya puede cerrar: desde el día 19, el mes
 * anterior; antes del 19, el anterior a ese. El 17-09 da julio; el 19-09, agosto.
 */
export function ultimoPeriodoCerrable(ahora: Date): string {
  const { dia } = fechaArgentina(ahora);
  return sumarMeses(periodoActual(ahora), dia >= DIA_CIERRE_AUTOMATICO ? -1 : -2);
}

/** Las listas que existen en esta marca. En Ford ninguna: todo esto no hace nada. */
export function listasHabilitadas(): ListaCierre[] {
  const listas: ListaCierre[] = [];
  if (marca.refuerzo.habilitado && marca.refuerzo.formatoExcel === "VW") listas.push(ListaCierre.ENCUESTA_VENTAS);
  if (marca.encuestaFabricaPV.habilitado && marca.encuestaFabricaPV.sucursal) listas.push(ListaCierre.ENCUESTA_PV);
  return listas;
}

const mismaSucursal = (a: string, b: string) => claveNormalizada(a) === claveNormalizada(b);

interface ClienteDeMes {
  id: string;
  periodo: string | null;
  sucursal: string;
  cerrado: boolean;
}

/** Todos los clientes de la lista con su mes y su provincia (como la escribe la marca). */
async function clientesDeLaLista(lista: ListaCierre): Promise<ClienteDeMes[]> {
  if (lista === ListaCierre.ENCUESTA_VENTAS) {
    const filas = await prisma.encuestaFabricaVW.findMany({
      select: { id: true, periodo: true, sucursal: true, cerradoEn: true },
    });
    return filas.map((f) => ({
      id: f.id,
      periodo: f.periodo,
      sucursal: sucursalCanonica(f.sucursal) ?? f.sucursal,
      cerrado: !!f.cerradoEn,
    }));
  }
  const sucursal = sucursalCanonica(marca.encuestaFabricaPV.sucursal) ?? marca.encuestaFabricaPV.sucursal ?? "";
  const filas = await prisma.encuestaFabricaPV.findMany({
    where: { caso: await whereCasoDeLaLista() },
    select: {
      id: true,
      cerradoEn: true,
      periodoCierre: true,
      caso: { select: { fechaSalida: true, fechaProgramacion: true } },
    },
  });
  return filas.map((f) => ({
    id: f.id,
    periodo: f.cerradoEn ? f.periodoCierre : periodoDelServicio(f.caso.fechaSalida ?? f.caso.fechaProgramacion ?? null),
    sucursal,
    cerrado: !!f.cerradoEn,
  }));
}

export interface MesDeLaLista {
  periodo: string;
  sucursal: string;
  /** Clientes de ese mes que están en la lista de trabajo. */
  enLista: number;
  /** Clientes de ese mes ya cerrados. */
  cerrados: number;
  cierre: {
    /** true = el mes está cerrado; false = un administrador lo reabrió. */
    activo: boolean;
    origen: OrigenCierre;
    cerradoEn: Date;
    cerradoPorNombre: string | null;
    reabiertoEn: Date | null;
    reabiertoPorNombre: string | null;
  } | null;
}

/** Los meses de la lista, con cuántos clientes hay abiertos y cerrados en cada uno. */
export async function mesesDeLaLista(lista: ListaCierre): Promise<MesDeLaLista[]> {
  const [clientes, cierres] = await Promise.all([
    clientesDeLaLista(lista),
    prisma.cierrePeriodo.findMany({ where: { lista } }),
  ]);
  const meses = new Map<string, MesDeLaLista>();
  const clave = (periodo: string, sucursal: string) => `${periodo}|${claveNormalizada(sucursal)}`;
  const fila = (periodo: string, sucursal: string) => {
    const k = clave(periodo, sucursal);
    const existente = meses.get(k);
    if (existente) return existente;
    const nueva: MesDeLaLista = { periodo, sucursal, enLista: 0, cerrados: 0, cierre: null };
    meses.set(k, nueva);
    return nueva;
  };
  for (const c of clientes) {
    if (!c.periodo) continue;
    const m = fila(c.periodo, c.sucursal);
    if (c.cerrado) m.cerrados++;
    else m.enLista++;
  }
  for (const c of cierres) {
    fila(c.periodo, sucursalCanonica(c.sucursal) ?? c.sucursal).cierre = {
      activo: !c.reabiertoEn,
      origen: c.origen,
      cerradoEn: c.cerradoEn,
      cerradoPorNombre: c.cerradoPorNombre,
      reabiertoEn: c.reabiertoEn,
      reabiertoPorNombre: c.reabiertoPorNombre,
    };
  }
  return [...meses.values()].sort((a, b) => b.periodo.localeCompare(a.periodo) || a.sucursal.localeCompare(b.sucursal));
}

/** Los meses cerrados (sin los reabiertos), para marcar a los que llegaron tarde. */
export async function periodosCerrados(lista: ListaCierre): Promise<Array<{ periodo: string; sucursal: string }>> {
  const filas = await prisma.cierrePeriodo.findMany({
    where: { lista, reabiertoEn: null },
    select: { periodo: true, sucursal: true },
  });
  return filas.map((f) => ({ periodo: f.periodo, sucursal: sucursalCanonica(f.sucursal) ?? f.sucursal }));
}

interface Quien {
  id: string | null;
  nombre: string | null;
}

/**
 * Cierra un mes de una provincia: los clientes de ese mes que están en la lista
 * pasan a cerrados. Se puede volver a cerrar un mes ya cerrado (guarda a los que
 * llegaron después) y uno reabierto (lo vuelve a cerrar).
 */
export async function cerrarPeriodo(opciones: {
  lista: ListaCierre;
  periodo: string;
  sucursal: string;
  origen: OrigenCierre;
  quien: Quien;
}): Promise<{ cerrados: number; totalCerrados: number }> {
  const { lista, periodo, sucursal, origen, quien } = opciones;
  const ahora = new Date();
  const clientes = (await clientesDeLaLista(lista)).filter(
    (c) => c.periodo === periodo && mismaSucursal(c.sucursal, sucursal)
  );
  const ids = clientes.filter((c) => !c.cerrado).map((c) => c.id);

  // `cerradoEn: null` en el where: si dos cierres corren a la vez (el botón y el
  // automático), ninguno pisa la fecha que puso el otro.
  const { count } =
    lista === ListaCierre.ENCUESTA_VENTAS
      ? await prisma.encuestaFabricaVW.updateMany({ where: { id: { in: ids }, cerradoEn: null }, data: { cerradoEn: ahora } })
      : await prisma.encuestaFabricaPV.updateMany({
          where: { id: { in: ids }, cerradoEn: null },
          data: { cerradoEn: ahora, periodoCierre: periodo },
        });

  const totalCerrados = clientes.length - ids.length + count;
  await prisma.cierrePeriodo.upsert({
    where: { lista_periodo_sucursal: { lista, periodo, sucursal } },
    create: {
      lista,
      periodo,
      sucursal,
      origen,
      cerradoEn: ahora,
      cerradoPorId: quien.id,
      cerradoPorNombre: quien.nombre,
      clientesCerrados: totalCerrados,
    },
    update: {
      origen,
      cerradoEn: ahora,
      cerradoPorId: quien.id,
      cerradoPorNombre: quien.nombre,
      clientesCerrados: totalCerrados,
      reabiertoEn: null,
      reabiertoPorId: null,
      reabiertoPorNombre: null,
    },
  });
  return { cerrados: count, totalCerrados };
}

/** Reabre un mes: sus clientes vuelven a la lista de trabajo. Solo administradores. */
export async function reabrirPeriodo(opciones: {
  lista: ListaCierre;
  periodo: string;
  sucursal: string;
  quien: Quien;
}): Promise<{ reabiertos: number } | { error: string }> {
  const { lista, periodo, sucursal, quien } = opciones;
  const cierre = await prisma.cierrePeriodo.findUnique({
    where: { lista_periodo_sucursal: { lista, periodo, sucursal } },
  });
  if (!cierre || cierre.reabiertoEn) return { error: "Ese mes no está cerrado." };

  let reabiertos = 0;
  if (lista === ListaCierre.ENCUESTA_VENTAS) {
    const ids = (await clientesDeLaLista(lista))
      .filter((c) => c.cerrado && c.periodo === periodo && mismaSucursal(c.sucursal, sucursal))
      .map((c) => c.id);
    reabiertos = (await prisma.encuestaFabricaVW.updateMany({ where: { id: { in: ids } }, data: { cerradoEn: null } })).count;
  } else {
    reabiertos = (
      await prisma.encuestaFabricaPV.updateMany({
        where: { cerradoEn: { not: null }, periodoCierre: periodo },
        data: { cerradoEn: null, periodoCierre: null },
      })
    ).count;
  }
  await prisma.cierrePeriodo.update({
    where: { id: cierre.id },
    data: { reabiertoEn: new Date(), reabiertoPorId: quien.id, reabiertoPorNombre: quien.nombre, clientesCerrados: 0 },
  });
  return { reabiertos };
}

/** Los ids de los clientes cerrados de un mes de Ventas (la consulta los detalla). */
export async function idsCerradosVentas(periodo: string, sucursal: string): Promise<string[]> {
  return (await clientesDeLaLista(ListaCierre.ENCUESTA_VENTAS))
    .filter((c) => c.cerrado && c.periodo === periodo && mismaSucursal(c.sucursal, sucursal))
    .map((c) => c.id);
}

/** Qué clave de Configuracion guarda hasta qué mes llegó el cierre automático. */
const claveMarcaDeAgua = (lista: ListaCierre) => `cierre.automatico.${lista}`;

/**
 * El cierre del día 19. Corre al arrancar y una vez por hora; casi siempre no hace
 * nada.
 *
 * Recuerda hasta qué mes ya cerró (una "marca de agua" por lista) y solo mira los
 * meses nuevos desde ahí. Por eso:
 *  - si el 19 la PC estaba apagada, lo hace apenas vuelve;
 *  - un cliente que llega tarde a un mes que ya pasó por acá no se esconde solo:
 *    aparece en la lista marcado, como pidió Calidad;
 *  - un mes que alguien ya cerró o que un administrador reabrió (tiene su fila en
 *    CierrePeriodo) no se toca.
 * La primera vez no hay marca: cierra todos los meses que ya pasaron su 19.
 */
export async function cierreAutomaticoDePeriodos(
  ahora: Date = new Date()
): Promise<Array<{ lista: ListaCierre; periodo: string; sucursal: string; cerrados: number }>> {
  const hasta = ultimoPeriodoCerrable(ahora);
  const hechos: Array<{ lista: ListaCierre; periodo: string; sucursal: string; cerrados: number }> = [];

  for (const lista of listasHabilitadas()) {
    const clave = claveMarcaDeAgua(lista);
    const marcaDeAgua = (await prisma.configuracion.findUnique({ where: { clave } }))?.valor ?? null;
    if (marcaDeAgua && marcaDeAgua >= hasta) continue;

    // Que los promotores que ya son 5 estén en la tabla antes de cerrar su mes: si no,
    // entrarían después como "llegados tarde" sin haber llegado tarde.
    if (lista === ListaCierre.ENCUESTA_PV) await sincronizarPromotoresPV();

    const meses = await mesesDeLaLista(lista);
    // Se recorren TODOS los meses y TODAS las provincias de la lista, tengan clientes o
    // no: un mes que el 19 todavía no tenía nada cargado (el Excel llega tarde) queda
    // cerrado igual, y lo que entre después sale marcado "mes cerrado". Solo las
    // provincias de la marca: un cliente con otra sucursal ("General") nunca se
    // esconde solo, porque después no habría cómo consultarlo ni reabrirlo.
    const provincias =
      lista === ListaCierre.ENCUESTA_VENTAS
        ? marca.sucursales
        : [sucursalCanonica(marca.encuestaFabricaPV.sucursal) ?? marca.encuestaFabricaPV.sucursal ?? ""];
    // La primera vez, desde el mes más viejo que tiene clientes: no hace falta llenar
    // la tabla de meses vacíos de años atrás.
    const masViejo = meses
      .filter((m) => m.enLista + m.cerrados > 0)
      .map((m) => m.periodo)
      .sort()[0];
    const desde = marcaDeAgua ? sumarMeses(marcaDeAgua, 1) : masViejo;

    for (let periodo = desde; periodo && periodo <= hasta; periodo = sumarMeses(periodo, 1)) {
      for (const sucursal of provincias) {
        const fila = meses.find((m) => m.periodo === periodo && mismaSucursal(m.sucursal, sucursal));
        // Ya lo cerró alguien, o un administrador lo reabrió: no se toca.
        if (fila?.cierre) continue;
        const { cerrados } = await cerrarPeriodo({
          lista,
          periodo,
          sucursal,
          origen: OrigenCierre.AUTOMATICO,
          quien: { id: null, nombre: null },
        });
        hechos.push({ lista, periodo, sucursal, cerrados });
        if (cerrados > 0) {
          await auditar(null, {
            accion: ACCIONES.PERIODO_CERRADO,
            entidad: "CierrePeriodo",
            usuarioId: null,
            detalles: { lista, periodo, sucursal, cerrados, origen: "AUTOMATICO" },
          });
        }
      }
    }

    await prisma.configuracion.upsert({ where: { clave }, create: { clave, valor: hasta }, update: { valor: hasta } });
  }
  return hechos;
}
