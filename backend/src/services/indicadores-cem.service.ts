// ---------------------------------------------------------------------------
// Indicadores CEM por trimestre (Volkswagen)
// ---------------------------------------------------------------------------
//
// Es la planilla "Q 2026" de Calidad adentro del sistema (pedido del 17-09-2026).
// Por trimestre y por provincia, un renglón por mes con lo que informa fábrica y
// el DMS: patentamientos, base CEM (tradicional y autoahorro), encuestas
// efectivas, base sin duplicados, mails OK y OS. Por trimestre, el OS del
// trimestre y el resultado de la auditoría, y los objetivos.
//
// LOS NÚMEROS SE CARGAN A MANO (decisión del dueño). El sistema no los puede
// sacar solo: el Excel de fábrica que se carga en Encuestas de fábrica trae
// únicamente los clientes que no respondieron, no la base CEM entera, y
// patentamientos y OS vienen de afuera. Lo que hace el sistema es la cuenta: los
// porcentajes, los totales y la comparación con los objetivos, con las MISMAS
// fórmulas de la planilla (ver calcularTrimestre).
//
// POSVENTA (19-09-2026) tiene su propia planilla, "Postventa Q 2026", con OTRAS
// columnas: mails enviados, encuestas efectivas y las notas Q1 a Q4 (Trato,
// Organización, Calidad de reparación y LVS) de cada mes; la tasa de respuesta, y la
// ESCALA que sale de la nota LVS con la tabla "Objetivos LVS" del trimestre. Solo
// Mendoza. Las notas del total del trimestre las publica fábrica y se cargan a mano.

import { AreaCem } from "@prisma/client";
import { prisma } from "../config/prisma";
import { marca, sucursalCanonica } from "../config/marca";
import { redondear } from "./redondeo";

/** Las notas Q1 a Q4 de Posventa (de 0 a 5, como el OS). */
export const CAMPOS_NOTA = ["notaTrato", "notaOrganizacion", "notaCalidadReparacion", "notaLvs"] as const;
export type CampoNota = (typeof CAMPOS_NOTA)[number];

/** Lo que se carga por mes en Ventas (la planilla "Q 2026"). */
export const CAMPOS_MES_VENTAS = [
  "patentamientos",
  "baseCem",
  "baseCemTradicional",
  "baseCemAutoahorro",
  "encuestasEfectivas",
  "baseSinDuplicados",
  "mailOk",
  "os",
] as const;
/** Lo que se carga por mes en Posventa (la planilla "Postventa Q 2026"). */
export const CAMPOS_MES_POSVENTA = ["mailsEnviados", "encuestasEfectivas", ...CAMPOS_NOTA] as const;

/** Todos los campos de un mes, de las dos áreas (encuestasEfectivas es de las dos). */
export const CAMPOS_MES = [...CAMPOS_MES_VENTAS, "mailsEnviados", ...CAMPOS_NOTA] as const;
export type CampoMes = (typeof CAMPOS_MES)[number];

export function camposMesDelArea(area: AreaCem): readonly CampoMes[] {
  return area === AreaCem.POSVENTA ? CAMPOS_MES_POSVENTA : CAMPOS_MES_VENTAS;
}

/** Los campos que son notas de 0 a 5 (el resto son cantidades enteras). */
export const CAMPOS_DECIMALES: ReadonlySet<CampoMes> = new Set<CampoMes>(["os", ...CAMPOS_NOTA]);

export type DatosMes = Record<CampoMes, number | null>;

export interface ObjetivosTrimestre {
  os: number | null;
  cargas: number | null;
  mailValidos: number | null;
  /** Posventa: desde qué nota LVS empieza cada escala (4,88 / 4,85 / 4,82 / 4,80). */
  lvsEscala1: number | null;
  lvsEscala2: number | null;
  lvsEscala3: number | null;
  lvsEscala4: number | null;
}

export const CAMPOS_ESCALA = ["lvsEscala1", "lvsEscala2", "lvsEscala3", "lvsEscala4"] as const;

/** Cumple / no cumple el objetivo. null = no hay objetivo o no hay número. */
export type Cumple = boolean | null;

/** 1 a 4 cumple (1 es la mejor); 5 = No cumple. null = sin nota LVS o sin tabla de escalas. */
export type Escala = 1 | 2 | 3 | 4 | 5 | null;

export interface DatosTrimestre {
  os: number | null;
  resultadoAuditoria: number | null;
  notaTrato: number | null;
  notaOrganizacion: number | null;
  notaCalidadReparacion: number | null;
  notaLvs: number | null;
}

export const trimestreVacio = (): DatosTrimestre => ({
  os: null,
  resultadoAuditoria: null,
  notaTrato: null,
  notaOrganizacion: null,
  notaCalidadReparacion: null,
  notaLvs: null,
});

export interface MesCalculado extends DatosMes {
  periodo: string;
  /** base CEM / patentamientos × 100 */
  porcentajeCarga: number | null;
  /** encuestas efectivas / base CEM × 100 */
  porcentajeEfectivas: number | null;
  /** mails OK / base sin duplicados × 100 */
  porcentajeMailValidos: number | null;
  /** Posventa: encuestas efectivas / mails enviados × 100 */
  tasaRespuesta: number | null;
  /** Posventa: la escala de la nota LVS del mes. */
  escala: Escala;
  /** La base CEM no es tradicional + autoahorro: probablemente un número mal tipeado. */
  baseNoSuma: boolean;
  cumple: { cargas: Cumple; mailValidos: Cumple; os: Cumple };
}

export interface TotalCalculado {
  patentamientos: number | null;
  baseCem: number | null;
  baseCemTradicional: number | null;
  baseCemAutoahorro: number | null;
  encuestasEfectivas: number | null;
  baseSinDuplicados: number | null;
  mailOk: number | null;
  porcentajeCarga: number | null;
  porcentajeEfectivas: number | null;
  porcentajeMailValidos: number | null;
  /** El OS del trimestre, cargado a mano (fábrica lo publica: no es el promedio). */
  os: number | null;
  resultadoAuditoria: number | null;
  /** Cuántas cargas hacen falta para el objetivo: patentamientos × objetivo de cargas / 100. */
  cargasNecesarias: number | null;
  cumple: { cargas: Cumple; mailValidos: Cumple; os: Cumple };
  /** Posventa: suma de los mails enviados de los meses. */
  mailsEnviados: number | null;
  /** Posventa: efectivas del trimestre / mails del trimestre × 100 (como la planilla: de los totales). */
  tasaRespuesta: number | null;
  /** Posventa: las notas del trimestre, cargadas a mano (las publica fábrica). */
  notaTrato: number | null;
  notaOrganizacion: number | null;
  notaCalidadReparacion: number | null;
  notaLvs: number | null;
  /** Posventa: la escala de la nota LVS del trimestre. */
  escala: Escala;
}

export interface SucursalTrimestre {
  sucursal: string;
  meses: MesCalculado[];
  total: TotalCalculado;
}

export interface TrimestreCalculado {
  anio: number;
  trimestre: number;
  periodos: string[];
  objetivos: ObjetivosTrimestre;
  sucursales: SucursalTrimestre[];
}

const pct = (parte: number | null, total: number | null): number | null =>
  parte === null || total === null || total === 0 ? null : redondear((parte * 100) / total);

const suma = (valores: Array<number | null>): number | null => {
  const hay = valores.filter((v): v is number => v !== null);
  return hay.length ? hay.reduce((a, b) => a + b, 0) : null;
};

// "Llega al objetivo" se compara con los números YA redondeados a dos decimales,
// que son los que se ven: si la pantalla dice 85,00 y el objetivo es 85, cumple.
const cumple = (valor: number | null, objetivo: number | null): Cumple =>
  valor === null || objetivo === null ? null : redondear(valor) >= redondear(objetivo);

/**
 * La escala de una nota LVS con la tabla "Objetivos LVS" del trimestre. La tabla de
 * la planilla es: Escala 1 "> 4,87", Escala 2 "4,85 – 4,87", Escala 3 "4,82 – 4,84",
 * Escala 4 "4,80 – 4,81" y Escala 5 "< 4,80"; se guarda desde dónde empieza cada
 * una (4,88 / 4,85 / 4,82 / 4,80). Debajo de la 4 es la 5, "No cumple" (decisión del
 * 19-09-2026: el 1er trimestre, con 4,57, la planilla dice "NO CUMPLE"). Se compara
 * con la nota ya redondeada a dos decimales, la que se ve. Sin tabla completa no se
 * inventa una escala.
 */
export function escalaLvs(nota: number | null, o: ObjetivosTrimestre): Escala {
  const desde = [o.lvsEscala1, o.lvsEscala2, o.lvsEscala3, o.lvsEscala4];
  if (nota === null || desde.some((d) => d === null)) return null;
  const n = redondear(nota);
  for (let i = 0; i < 4; i++) if (n >= redondear(desde[i]!)) return (i + 1) as Escala;
  return 5;
}

/** Los tres meses de un trimestre: 2026 T3 → ["2026-07", "2026-08", "2026-09"]. */
export function periodosDelTrimestre(anio: number, trimestre: number): string[] {
  return [1, 2, 3].map((i) => `${anio}-${String((trimestre - 1) * 3 + i).padStart(2, "0")}`);
}

export function mesVacio(): DatosMes {
  return Object.fromEntries(CAMPOS_MES.map((c) => [c, null])) as DatosMes;
}

/**
 * La cuenta de la planilla, trimestre por trimestre. Función pura: se prueba sin base.
 *
 * Las fórmulas son las de "Q 2026", incluida una que no es la obvia:
 *  - el % de encuestas efectivas del TOTAL es el PROMEDIO de los porcentajes de
 *    los meses (en la planilla, SUMA/3), no efectivas del trimestre / base del
 *    trimestre. Se eligió así a propósito (17-09-2026) para que dé lo mismo que
 *    lo que ya se viene informando. Se promedian los meses que tienen el número:
 *    con un trimestre en curso, dividir por 3 fijo lo bajaría sin motivo.
 *  - el % de carga y el de mails válidos del total sí salen de los totales.
 *  - el OS del total es el que publica fábrica para el trimestre, cargado aparte.
 */
export function calcularTrimestre(entrada: {
  anio: number;
  trimestre: number;
  sucursales: string[];
  meses: Map<string, DatosMes>; // clave: `${periodo}|${sucursal}`
  datosTrimestre: Map<string, DatosTrimestre>; // clave: sucursal
  objetivos: ObjetivosTrimestre;
}): TrimestreCalculado {
  const periodos = periodosDelTrimestre(entrada.anio, entrada.trimestre);
  const { objetivos } = entrada;

  const sucursales = entrada.sucursales.map((sucursal): SucursalTrimestre => {
    const meses = periodos.map((periodo): MesCalculado => {
      const d = entrada.meses.get(`${periodo}|${sucursal}`) ?? mesVacio();
      const porcentajeCarga = pct(d.baseCem, d.patentamientos);
      const porcentajeMailValidos = pct(d.mailOk, d.baseSinDuplicados);
      return {
        periodo,
        ...d,
        porcentajeCarga,
        porcentajeEfectivas: pct(d.encuestasEfectivas, d.baseCem),
        porcentajeMailValidos,
        tasaRespuesta: pct(d.encuestasEfectivas, d.mailsEnviados),
        escala: escalaLvs(d.notaLvs, objetivos),
        baseNoSuma:
          d.baseCem !== null &&
          d.baseCemTradicional !== null &&
          d.baseCemAutoahorro !== null &&
          d.baseCem !== d.baseCemTradicional + d.baseCemAutoahorro,
        cumple: {
          cargas: cumple(porcentajeCarga, objetivos.cargas),
          mailValidos: cumple(porcentajeMailValidos, objetivos.mailValidos),
          os: cumple(d.os, objetivos.os),
        },
      };
    });

    const totales = {
      patentamientos: suma(meses.map((m) => m.patentamientos)),
      baseCem: suma(meses.map((m) => m.baseCem)),
      baseCemTradicional: suma(meses.map((m) => m.baseCemTradicional)),
      baseCemAutoahorro: suma(meses.map((m) => m.baseCemAutoahorro)),
      encuestasEfectivas: suma(meses.map((m) => m.encuestasEfectivas)),
      baseSinDuplicados: suma(meses.map((m) => m.baseSinDuplicados)),
      mailOk: suma(meses.map((m) => m.mailOk)),
      mailsEnviados: suma(meses.map((m) => m.mailsEnviados)),
    };
    const efectivasMensuales = meses
      .map((m) => (m.encuestasEfectivas === null || !m.baseCem ? null : (m.encuestasEfectivas * 100) / m.baseCem))
      .filter((v): v is number => v !== null);
    const datosT = entrada.datosTrimestre.get(sucursal) ?? trimestreVacio();
    const porcentajeCarga = pct(totales.baseCem, totales.patentamientos);
    const porcentajeMailValidos = pct(totales.mailOk, totales.baseSinDuplicados);

    return {
      sucursal,
      meses,
      total: {
        ...totales,
        porcentajeCarga,
        porcentajeEfectivas: efectivasMensuales.length
          ? redondear(efectivasMensuales.reduce((a, b) => a + b, 0) / efectivasMensuales.length)
          : null,
        porcentajeMailValidos,
        os: datosT.os,
        resultadoAuditoria: datosT.resultadoAuditoria,
        cargasNecesarias:
          totales.patentamientos === null || objetivos.cargas === null
            ? null
            : redondear((totales.patentamientos * objetivos.cargas) / 100),
        cumple: {
          cargas: cumple(porcentajeCarga, objetivos.cargas),
          mailValidos: cumple(porcentajeMailValidos, objetivos.mailValidos),
          os: cumple(datosT.os, objetivos.os),
        },
        // Posventa: la tasa del total sale de los totales (en la planilla,
        // efectivas del TOTAL × 100 / mails del TOTAL), no del promedio de los meses.
        tasaRespuesta: pct(totales.encuestasEfectivas, totales.mailsEnviados),
        notaTrato: datosT.notaTrato,
        notaOrganizacion: datosT.notaOrganizacion,
        notaCalidadReparacion: datosT.notaCalidadReparacion,
        notaLvs: datosT.notaLvs,
        escala: escalaLvs(datosT.notaLvs, objetivos),
      },
    };
  });

  return { anio: entrada.anio, trimestre: entrada.trimestre, periodos, objetivos, sucursales };
}

/**
 * Las sucursales de la planilla de cada área, como las escribe la marca. Posventa es
 * solo Mendoza (su planilla trae solo Mendoza, 19-09-2026).
 */
export function sucursalesCem(area: AreaCem = AreaCem.VENTAS): string[] {
  return area === AreaCem.POSVENTA ? [...marca.sucursalesCemPosventa] : [...marca.sucursales];
}

/** Los objetivos de una fila de ObjetivoCemTrimestre (o todos vacíos si no hay). */
export function objetivosDeFila(obj?: Partial<Record<keyof ObjetivosTrimestre, number | null>> | null): ObjetivosTrimestre {
  return {
    os: obj?.os ?? null,
    cargas: obj?.cargas ?? null,
    mailValidos: obj?.mailValidos ?? null,
    lvsEscala1: obj?.lvsEscala1 ?? null,
    lvsEscala2: obj?.lvsEscala2 ?? null,
    lvsEscala3: obj?.lvsEscala3 ?? null,
    lvsEscala4: obj?.lvsEscala4 ?? null,
  };
}

/**
 * Los cuatro trimestres de un año de UN área, con lo que haya cargado.
 *
 * Las dos áreas pasan por la misma cuenta (calcularTrimestre calcula todo); cada
 * pantalla muestra las columnas de su planilla. Desde el 19-09-2026 Posventa tiene
 * las suyas (mails enviados, notas Q1 a Q4, tasa de respuesta y escala).
 */
export async function indicadoresDelAnio(
  anio: number,
  area: AreaCem = AreaCem.VENTAS
): Promise<{
  anio: number;
  area: AreaCem;
  anios: number[];
  sucursales: string[];
  trimestres: TrimestreCalculado[];
}> {
  const sucursales = sucursalesCem(area);
  const [filasMes, filasTrimestre, filasObjetivo, aniosMes] = await Promise.all([
    prisma.indicadorCemMes.findMany({ where: { area, periodo: { startsWith: `${anio}-` } } }),
    prisma.indicadorCemTrimestre.findMany({ where: { area, anio } }),
    prisma.objetivoCemTrimestre.findMany({ where: { area, anio } }),
    // Los años con algo cargado, de CUALQUIER área: el selector de año es uno solo
    // y no conviene que cambie de opciones al pasar de Ventas a Posventa.
    prisma.indicadorCemMes.findMany({ select: { periodo: true }, distinct: ["periodo"] }),
  ]);

  const meses = new Map<string, DatosMes>();
  for (const f of filasMes) {
    const sucursal = sucursalCanonica(f.sucursal) ?? f.sucursal;
    meses.set(
      `${f.periodo}|${sucursal}`,
      Object.fromEntries(CAMPOS_MES.map((c) => [c, f[c] ?? null])) as DatosMes
    );
  }

  const trimestres = [1, 2, 3, 4].map((trimestre) => {
    const datosTrimestre = new Map(
      filasTrimestre
        .filter((f) => f.trimestre === trimestre)
        .map((f): [string, DatosTrimestre] => [
          sucursalCanonica(f.sucursal) ?? f.sucursal,
          {
            os: f.os,
            resultadoAuditoria: f.resultadoAuditoria,
            notaTrato: f.notaTrato,
            notaOrganizacion: f.notaOrganizacion,
            notaCalidadReparacion: f.notaCalidadReparacion,
            notaLvs: f.notaLvs,
          },
        ])
    );
    const obj = filasObjetivo.find((o) => o.trimestre === trimestre);
    return calcularTrimestre({
      anio,
      trimestre,
      sucursales,
      meses,
      datosTrimestre,
      objetivos: objetivosDeFila(obj),
    });
  });

  // Los años que tienen algo cargado, más el pedido y el actual: el selector de
  // año de la pantalla no puede quedar vacío.
  const anios = [
    ...new Set([...aniosMes.map((a) => Number(a.periodo.slice(0, 4))), anio, new Date().getFullYear()]),
  ].sort((a, b) => b - a);

  return { anio, area, anios, sucursales, trimestres };
}

// ---------------------------------------------------------------------------
// Histórico de la planilla
// ---------------------------------------------------------------------------
//
// Lo que tenía "Q 2026.ods" el 17-09-2026, tal cual, para que la pantalla arranque
// con lo que Calidad ya informó (decisión del dueño). Se carga UNA sola vez, al
// arrancar, y solo si no hay NADA de Ventas: nunca pisa lo que se cargó después.
// Mira solo Ventas: lo de Posventa (su planilla o lo cargado a mano) no lo frena.
//
// OJO con Q1: en la planilla los objetivos de ese trimestre dicen "MAIL VALIDOS:
// 85%" y "CARGAS: 97%", al revés que en Q2 y Q3 ("CARGAS: 85%", "MAIL VALIDOS:
// 97%"), pero el renglón "85 % DE CARGAS" de esa misma hoja usa 85. Era un error de
// tipeo: se cargó cargas 85 y mails 97, como Q2 y Q3 (decisión del 17-09-2026).

type FilaHistorica = [string, number, number, number, number, number, number, number, number];
// [periodo, patentamientos, base CEM, tradicional, autoahorro, efectivas, sin duplicados, mail OK, OS]
const HISTORICO_MESES: Record<string, FilaHistorica[]> = {
  Mendoza: [
    ["2026-01", 112, 97, 90, 7, 22, 96, 96, 4.86],
    ["2026-02", 65, 56, 52, 4, 22, 56, 56, 4.91],
    ["2026-03", 68, 58, 49, 9, 16, 58, 58, 4.94],
    ["2026-04", 59, 51, 45, 6, 14, 51, 51, 4.86],
    ["2026-05", 58, 50, 46, 4, 18, 49, 49, 4.83],
    ["2026-06", 57, 49, 47, 2, 21, 49, 49, 4.9],
    ["2026-07", 62, 55, 52, 3, 37, 55, 55, 4.92],
    ["2026-08", 65, 57, 45, 12, 24, 57, 56, 5],
    ["2026-09", 45, 33, 30, 3, 18, 33, 31, 4.89],
  ],
  "San Juan": [
    ["2026-01", 94, 80, 77, 3, 22, 80, 80, 4.86],
    ["2026-02", 55, 47, 45, 2, 18, 47, 47, 4.78],
    ["2026-03", 54, 46, 45, 1, 14, 46, 46, 4.71],
    ["2026-04", 48, 41, 34, 7, 13, 41, 41, 4.92],
    ["2026-05", 48, 41, 40, 1, 16, 41, 41, 4.88],
    ["2026-06", 45, 39, 38, 1, 14, 39, 39, 5],
    ["2026-07", 52, 50, 44, 6, 22, 50, 50, 5],
    ["2026-08", 55, 49, 41, 8, 25, 49, 49, 4.92],
    ["2026-09", 27, 17, 17, 0, 8, 17, 17, 5],
  ],
};
const HISTORICO_TRIMESTRES: Array<{ trimestre: number; sucursal: string; os: number | null; resultadoAuditoria: number | null }> = [
  { trimestre: 1, sucursal: "Mendoza", os: 4.9, resultadoAuditoria: 88.1 },
  { trimestre: 1, sucursal: "San Juan", os: 4.8, resultadoAuditoria: 88.8 },
  { trimestre: 2, sucursal: "Mendoza", os: 4.87, resultadoAuditoria: null },
  { trimestre: 2, sucursal: "San Juan", os: 4.93, resultadoAuditoria: null },
];
const HISTORICO_OBJETIVOS: Array<{ trimestre: number; os: number; cargas: number; mailValidos: number }> = [
  { trimestre: 1, os: 4.8, cargas: 85, mailValidos: 97 },
  { trimestre: 2, os: 4.81, cargas: 85, mailValidos: 97 },
  { trimestre: 3, os: 4.81, cargas: 85, mailValidos: 97 },
];

export async function sembrarHistoricoCem(): Promise<boolean> {
  if (!marca.indicadoresCem) return false;
  const soloVentas = { where: { area: AreaCem.VENTAS } };
  const [meses, trimestres, objetivos] = await Promise.all([
    prisma.indicadorCemMes.count(soloVentas),
    prisma.indicadorCemTrimestre.count(soloVentas),
    prisma.objetivoCemTrimestre.count(soloVentas),
  ]);
  if (meses + trimestres + objetivos > 0) return false;

  const nombre = "Planilla Q 2026 (carga inicial)";
  await prisma.$transaction([
    prisma.indicadorCemMes.createMany({
      data: Object.entries(HISTORICO_MESES).flatMap(([sucursal, filas]) =>
        filas.map(([periodo, patentamientos, baseCem, baseCemTradicional, baseCemAutoahorro, encuestasEfectivas, baseSinDuplicados, mailOk, os]) => ({
          periodo,
          sucursal,
          patentamientos,
          baseCem,
          baseCemTradicional,
          baseCemAutoahorro,
          encuestasEfectivas,
          baseSinDuplicados,
          mailOk,
          os,
          actualizadoPorNombre: nombre,
        }))
      ),
    }),
    prisma.indicadorCemTrimestre.createMany({
      data: HISTORICO_TRIMESTRES.map((t) => ({ anio: 2026, ...t, actualizadoPorNombre: nombre })),
    }),
    prisma.objetivoCemTrimestre.createMany({
      data: HISTORICO_OBJETIVOS.map((o) => ({ anio: 2026, ...o, actualizadoPorNombre: nombre })),
    }),
  ]);
  return true;
}

// ---------------------------------------------------------------------------
// Planilla de POSVENTA ("Postventa Q 2026")
// ---------------------------------------------------------------------------
//
// Lo que tenía la planilla de Posventa el 19-09-2026, Mendoza, enero a septiembre
// (decisión del dueño: se carga sola UNA vez y después se sigue a mano en la
// pestaña). A diferencia de la de Ventas, esta llega cuando la pantalla ya estaba en
// uso: por eso completa SOLO los casilleros vacíos (nunca pisa algo que alguien ya
// cargó) y deja una marca en Configuracion para no volver a correr. Sin la marca, un
// número que alguien borró a propósito volvería a aparecer en cada arranque.
//
// Las notas del TOTAL de cada trimestre son las de la planilla, que las publica
// fábrica (no son el promedio de los meses). Septiembre y el Q3 estaban en curso.

const CLAVE_PLANILLA_POSVENTA = "cem.posventa.planillaQ2026";
const SUCURSAL_PLANILLA_POSVENTA = "Mendoza";

type FilaPosventa = [string, number, number, number, number, number, number];
// [periodo, mails enviados, encuestas efectivas, Q1 trato, Q2 organización, Q3 calidad de reparación, Q4 LVS]
const PLANILLA_POSVENTA_MESES: FilaPosventa[] = [
  ["2026-01", 362, 59, 4.75, 4.76, 4.5, 4.47],
  ["2026-02", 351, 55, 4.8, 4.76, 4.44, 4.47],
  ["2026-03", 387, 85, 4.87, 4.72, 4.79, 4.69],
  ["2026-04", 431, 91, 4.9, 4.87, 4.84, 4.87],
  ["2026-05", 354, 73, 4.88, 4.85, 4.88, 4.84],
  ["2026-06", 380, 74, 4.93, 4.88, 4.85, 4.88],
  ["2026-07", 413, 82, 4.88, 4.78, 4.8, 4.74],
  ["2026-08", 395, 73, 4.9, 4.86, 4.85, 4.92],
  ["2026-09", 168, 29, 4.72, 4.85, 4.86, 4.72],
];
// [trimestre, Q1 trato, Q2 organización, Q3 calidad de reparación, Q4 LVS] del TOTAL
const PLANILLA_POSVENTA_TRIMESTRES: Array<[number, number, number, number, number]> = [
  [1, 4.81, 4.74, 4.61, 4.57],
  [2, 4.9, 4.87, 4.85, 4.86],
  [3, 4.86, 4.82, 4.83, 4.81],
];
// "OBJETIVOS LVS", igual en las cuatro hojas: Escala 1 "> 4,87", Escala 2 "4,85 –
// 4,87", Escala 3 "4,82 – 4,84", Escala 4 "4,80 – 4,81", Escala 5 "< 4,80".
const PLANILLA_POSVENTA_ESCALAS = { lvsEscala1: 4.88, lvsEscala2: 4.85, lvsEscala3: 4.82, lvsEscala4: 4.8 };

/** Solo los campos que hoy están vacíos (null o sin fila): lo cargado no se toca. */
function soloVacios<T extends Record<string, number>>(nuevos: T, actual: Record<string, unknown> | null): Partial<T> {
  return Object.fromEntries(
    Object.entries(nuevos).filter(([c]) => actual === null || actual[c] === null || actual[c] === undefined)
  ) as Partial<T>;
}

/**
 * Carga la planilla de Posventa una sola vez. Devuelve cuántos casilleros completó,
 * o null si no correspondía (otra marca, ya se hizo).
 */
export async function sembrarPlanillaPosventaCem(): Promise<number | null> {
  if (!marca.indicadoresCem || !marca.sucursalesCemPosventa.includes(SUCURSAL_PLANILLA_POSVENTA)) return null;
  if (await prisma.configuracion.findUnique({ where: { clave: CLAVE_PLANILLA_POSVENTA } })) return null;

  const nombre = "Planilla Postventa Q 2026 (carga inicial)";
  const area = AreaCem.POSVENTA;
  const sucursal = SUCURSAL_PLANILLA_POSVENTA;
  let completados = 0;

  await prisma.$transaction(async (tx) => {
    for (const [periodo, mailsEnviados, encuestasEfectivas, notaTrato, notaOrganizacion, notaCalidadReparacion, notaLvs] of PLANILLA_POSVENTA_MESES) {
      const clave = { periodo_sucursal_area: { periodo, sucursal, area } };
      const actual = await tx.indicadorCemMes.findUnique({ where: clave });
      const datos = soloVacios(
        { mailsEnviados, encuestasEfectivas, notaTrato, notaOrganizacion, notaCalidadReparacion, notaLvs },
        actual
      );
      if (!Object.keys(datos).length) continue;
      completados += Object.keys(datos).length;
      await tx.indicadorCemMes.upsert({
        where: clave,
        create: { periodo, sucursal, area, ...datos, actualizadoPorNombre: nombre },
        update: { ...datos, actualizadoPorNombre: nombre },
      });
    }

    for (const [trimestre, notaTrato, notaOrganizacion, notaCalidadReparacion, notaLvs] of PLANILLA_POSVENTA_TRIMESTRES) {
      const clave = { anio_trimestre_sucursal_area: { anio: 2026, trimestre, sucursal, area } };
      const actual = await tx.indicadorCemTrimestre.findUnique({ where: clave });
      const datos = soloVacios({ notaTrato, notaOrganizacion, notaCalidadReparacion, notaLvs }, actual);
      if (!Object.keys(datos).length) continue;
      completados += Object.keys(datos).length;
      await tx.indicadorCemTrimestre.upsert({
        where: clave,
        create: { anio: 2026, trimestre, sucursal, area, ...datos, actualizadoPorNombre: nombre },
        update: { ...datos, actualizadoPorNombre: nombre },
      });
    }

    for (const trimestre of [1, 2, 3, 4]) {
      const clave = { anio_trimestre_area: { anio: 2026, trimestre, area } };
      const actual = await tx.objetivoCemTrimestre.findUnique({ where: clave });
      // La tabla va entera o no va: si alguien ya cargó alguna escala de ese
      // trimestre, se respeta su tabla completa (mezclar dos tablas podría dejarla
      // desordenada).
      if (actual && CAMPOS_ESCALA.some((c) => actual[c] !== null)) continue;
      completados += CAMPOS_ESCALA.length;
      await tx.objetivoCemTrimestre.upsert({
        where: clave,
        create: { anio: 2026, trimestre, area, ...PLANILLA_POSVENTA_ESCALAS, actualizadoPorNombre: nombre },
        update: { ...PLANILLA_POSVENTA_ESCALAS, actualizadoPorNombre: nombre },
      });
    }

    await tx.configuracion.create({
      data: {
        clave: CLAVE_PLANILLA_POSVENTA,
        valor: JSON.stringify({ cargadoEn: new Date().toISOString(), casillerosCompletados: completados }),
      },
    });
  });
  return completados;
}
