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

import { prisma } from "../config/prisma";
import { marca, sucursalCanonica } from "../config/marca";
import { redondear } from "./redondeo";

export const CAMPOS_MES = [
  "patentamientos",
  "baseCem",
  "baseCemTradicional",
  "baseCemAutoahorro",
  "encuestasEfectivas",
  "baseSinDuplicados",
  "mailOk",
  "os",
] as const;
export type CampoMes = (typeof CAMPOS_MES)[number];

export type DatosMes = Record<CampoMes, number | null>;

export interface ObjetivosTrimestre {
  os: number | null;
  cargas: number | null;
  mailValidos: number | null;
}

/** Cumple / no cumple el objetivo. null = no hay objetivo o no hay número. */
export type Cumple = boolean | null;

export interface MesCalculado extends DatosMes {
  periodo: string;
  /** base CEM / patentamientos × 100 */
  porcentajeCarga: number | null;
  /** encuestas efectivas / base CEM × 100 */
  porcentajeEfectivas: number | null;
  /** mails OK / base sin duplicados × 100 */
  porcentajeMailValidos: number | null;
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
  datosTrimestre: Map<string, { os: number | null; resultadoAuditoria: number | null }>; // clave: sucursal
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
    };
    const efectivasMensuales = meses
      .map((m) => (m.encuestasEfectivas === null || !m.baseCem ? null : (m.encuestasEfectivas * 100) / m.baseCem))
      .filter((v): v is number => v !== null);
    const datosT = entrada.datosTrimestre.get(sucursal) ?? { os: null, resultadoAuditoria: null };
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
      },
    };
  });

  return { anio: entrada.anio, trimestre: entrada.trimestre, periodos, objetivos, sucursales };
}

/** Las sucursales de la planilla, como las escribe la marca. */
export function sucursalesCem(): string[] {
  return [...marca.sucursales];
}

/** Los cuatro trimestres de un año, con lo que haya cargado. */
export async function indicadoresDelAnio(anio: number): Promise<{
  anio: number;
  anios: number[];
  sucursales: string[];
  trimestres: TrimestreCalculado[];
}> {
  const sucursales = sucursalesCem();
  const [filasMes, filasTrimestre, filasObjetivo, aniosMes] = await Promise.all([
    prisma.indicadorCemMes.findMany({ where: { periodo: { startsWith: `${anio}-` } } }),
    prisma.indicadorCemTrimestre.findMany({ where: { anio } }),
    prisma.objetivoCemTrimestre.findMany({ where: { anio } }),
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
        .map((f) => [sucursalCanonica(f.sucursal) ?? f.sucursal, { os: f.os, resultadoAuditoria: f.resultadoAuditoria }])
    );
    const obj = filasObjetivo.find((o) => o.trimestre === trimestre);
    return calcularTrimestre({
      anio,
      trimestre,
      sucursales,
      meses,
      datosTrimestre,
      objetivos: { os: obj?.os ?? null, cargas: obj?.cargas ?? null, mailValidos: obj?.mailValidos ?? null },
    });
  });

  // Los años que tienen algo cargado, más el pedido y el actual: el selector de
  // año de la pantalla no puede quedar vacío.
  const anios = [
    ...new Set([...aniosMes.map((a) => Number(a.periodo.slice(0, 4))), anio, new Date().getFullYear()]),
  ].sort((a, b) => b - a);

  return { anio, anios, sucursales, trimestres };
}

// ---------------------------------------------------------------------------
// Histórico de la planilla
// ---------------------------------------------------------------------------
//
// Lo que tenía "Q 2026.ods" el 17-09-2026, tal cual, para que la pantalla arranque
// con lo que Calidad ya informó (decisión del dueño). Se carga UNA sola vez, al
// arrancar, y solo si las tablas están vacías: nunca pisa lo que se cargó después.
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
const HISTORICO_OBJETIVOS: Array<{ trimestre: number } & ObjetivosTrimestre> = [
  { trimestre: 1, os: 4.8, cargas: 85, mailValidos: 97 },
  { trimestre: 2, os: 4.81, cargas: 85, mailValidos: 97 },
  { trimestre: 3, os: 4.81, cargas: 85, mailValidos: 97 },
];

export async function sembrarHistoricoCem(): Promise<boolean> {
  if (!marca.indicadoresCem) return false;
  const [meses, trimestres, objetivos] = await Promise.all([
    prisma.indicadorCemMes.count(),
    prisma.indicadorCemTrimestre.count(),
    prisma.objetivoCemTrimestre.count(),
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
