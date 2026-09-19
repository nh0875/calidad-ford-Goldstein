import { Request, Response } from "express";
import { AreaCem } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { mensajeSucursalInvalida, SUCURSAL_GENERAL, sucursalCanonica } from "../config/marca";
import { ACCIONES, auditar } from "../services/audit.service";
import { provinciaPermitida } from "../services/area.service";
import { claveNormalizada } from "../services/normalizacion.service";
import {
  CAMPOS_ESCALA,
  CAMPOS_MES,
  CAMPOS_NOTA,
  camposMesDelArea,
  indicadoresDelAnio,
  sucursalesCem,
} from "../services/indicadores-cem.service";

// Indicadores CEM por trimestre (ver services/indicadores-cem.service.ts).
//
// QUIÉN: los VE cualquier perfil, incluido Fidelización (lista blanca en auth.ts,
// solo el GET). CARGAN Calidad y los administradores (decisión del 17-09-2026). Un
// usuario con provincia asignada carga solo los números de su provincia, igual que
// el resto de Volkswagen. Los objetivos valen para las dos provincias, así que los
// carga quien no tiene provincia asignada.

function puedeCargar(req: Request): string | null {
  if (req.usuario?.rol === "FIDELIZACION") return "Tu usuario puede ver los indicadores, pero no cargarlos.";
  return null;
}

function sucursalValida(valor: string): string | null {
  const canonica = sucursalCanonica(valor);
  return canonica && canonica !== SUCURSAL_GENERAL ? canonica : null;
}

/** Posventa es solo de las provincias de su planilla (Mendoza): el resto se rechaza. */
function motivoSucursalDelArea(area: AreaCem, sucursal: string): string | null {
  const validas = sucursalesCem(area);
  if (validas.some((v) => claveNormalizada(v) === claveNormalizada(sucursal))) return null;
  return `Los indicadores de ${area === AreaCem.POSVENTA ? "Posventa" : "Ventas"} son solo de ${validas.join(" y ")}.`;
}

/**
 * Cada área tiene las columnas de SU planilla. Si llega una que no es del área, lo
 * más probable es una pantalla abierta desde antes de la actualización del 19-09-2026
 * (Posventa tenía las mismas columnas que Ventas): se rechaza y se pide recargar, en
 * vez de "guardar" en silencio un número que la pantalla nueva no muestra.
 */
function motivoCamposAjenos(area: AreaCem, enviados: string[], propios: readonly string[]): string | null {
  const ajenos = enviados.filter((c) => !propios.includes(c));
  if (!ajenos.length) return null;
  return area === AreaCem.POSVENTA
    ? "Posventa ahora tiene las columnas de su planilla (mails enviados y notas Q1 a Q4). Recargá la página (F5) y volvé a cargar."
    : `Esas columnas no son de Ventas (${ajenos.join(", ")}).`;
}

/** Por qué este usuario no puede tocar los números de esa provincia, o null. */
function motivoProvincia(req: Request, sucursal: string): string | null {
  const provincia = provinciaPermitida(req.usuario!);
  if (provincia && claveNormalizada(provincia) !== claveNormalizada(sucursal)) {
    return `Tu usuario es de ${provincia}: solo puede cargar los indicadores de esa provincia.`;
  }
  return null;
}

// Ventas o Posventa (18-09-2026). Si no viene, es Ventas: es lo que había antes y
// así una pantalla abierta desde antes de la actualización sigue viendo lo mismo.
const areaSchema = z
  .nativeEnum(AreaCem, { errorMap: () => ({ message: "El área tiene que ser VENTAS o POSVENTA." }) })
  .default(AreaCem.VENTAS);

// ---------- GET /api/indicadores-cem?anio=&area= ----------
export async function obtenerIndicadoresCem(req: Request, res: Response) {
  const anio = req.query.anio ? Number(req.query.anio) : new Date().getFullYear();
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) {
    return res.status(400).json({ message: "El año no es válido." });
  }
  const area = areaSchema.safeParse(req.query.area ? String(req.query.area).toUpperCase() : undefined);
  if (!area.success) return res.status(400).json({ message: area.error.errors[0].message });
  const datos = await indicadoresDelAnio(anio, area.data);
  const provincia = provinciaPermitida(req.usuario!);
  res.json({
    ...datos,
    // Para que la pantalla no ofrezca editar lo que el backend va a rechazar.
    permisos: {
      cargar: !puedeCargar(req),
      provincia: provincia ? sucursalCanonica(provincia) ?? provincia : null,
    },
  });
}

// Números enteros no negativos, o vacío (null). El OS va de 0 a 5 con decimales.
const entero = z.number().int("Tiene que ser un número entero.").min(0, "No puede ser negativo.").max(1_000_000).nullable();
// Las notas Q1 a Q4 de Posventa, como el OS: de 0 a 5 con decimales.
const nota = z.number().min(0, "Las notas van de 0 a 5.").max(5, "Las notas van de 0 a 5.").nullable();
const notasSchema = {
  notaTrato: nota.optional(),
  notaOrganizacion: nota.optional(),
  notaCalidadReparacion: nota.optional(),
  notaLvs: nota.optional(),
};
const mesSchema = z.object({
  periodo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "El mes tiene que tener el formato AAAA-MM."),
  sucursal: z.string().trim().min(1),
  area: areaSchema,
  patentamientos: entero.optional(),
  baseCem: entero.optional(),
  baseCemTradicional: entero.optional(),
  baseCemAutoahorro: entero.optional(),
  encuestasEfectivas: entero.optional(),
  baseSinDuplicados: entero.optional(),
  mailOk: entero.optional(),
  os: z.number().min(0, "El OS va de 0 a 5.").max(5, "El OS va de 0 a 5.").nullable().optional(),
  mailsEnviados: entero.optional(),
  ...notasSchema,
});

/** Los campos que vinieron en el pedido (los que no son undefined). */
function enviados<T extends string>(datos: Partial<Record<T, unknown>>, campos: readonly T[]): T[] {
  return campos.filter((c) => datos[c] !== undefined);
}

// ---------- PUT /api/indicadores-cem/mes ----------
export async function guardarMesCem(req: Request, res: Response) {
  const noPuede = puedeCargar(req);
  if (noPuede) return res.status(403).json({ message: noPuede });
  const parsed = mesSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors.map((e) => e.message).join(" ") });
  }
  const sucursal = sucursalValida(parsed.data.sucursal);
  if (!sucursal) return res.status(400).json({ message: mensajeSucursalInvalida() });
  const { area } = parsed.data;
  const fueraDelArea = motivoSucursalDelArea(area, sucursal);
  if (fueraDelArea) return res.status(400).json({ message: fueraDelArea });
  const motivo = motivoProvincia(req, sucursal);
  if (motivo) return res.status(403).json({ message: motivo });

  const camposDelArea = camposMesDelArea(area);
  const ajenos = motivoCamposAjenos(area, enviados(parsed.data, CAMPOS_MES), camposDelArea);
  if (ajenos) return res.status(400).json({ message: ajenos });
  const datos = Object.fromEntries(enviados(parsed.data, camposDelArea).map((c) => [c, parsed.data[c]]));
  const clave = { periodo_sucursal_area: { periodo: parsed.data.periodo, sucursal, area } };
  const antes = await prisma.indicadorCemMes.findUnique({ where: clave });
  const guardado = await prisma.indicadorCemMes.upsert({
    where: clave,
    create: { periodo: parsed.data.periodo, sucursal, area, ...datos, actualizadoPorNombre: req.usuario?.nombre ?? null },
    update: { ...datos, actualizadoPorNombre: req.usuario?.nombre ?? null },
  });
  auditar(req, {
    accion: ACCIONES.INDICADORES_CEM_EDITADOS,
    entidad: "IndicadorCemMes",
    entidadId: guardado.id,
    detalles: {
      periodo: parsed.data.periodo,
      sucursal,
      area,
      antes: antes ? Object.fromEntries(camposDelArea.map((c) => [c, antes[c]])) : null,
      despues: datos,
    },
  });
  res.json({ data: guardado });
}

const porcentajeSchema = z.number().min(0, "Un porcentaje va de 0 a 100.").max(100, "Un porcentaje va de 0 a 100.").nullable();
const osSchema = z.number().min(0, "El OS va de 0 a 5.").max(5, "El OS va de 0 a 5.").nullable();
const trimestreBase = {
  anio: z.number().int().min(2000).max(2100),
  trimestre: z.number().int().min(1, "El trimestre va de 1 a 4.").max(4, "El trimestre va de 1 a 4."),
  area: areaSchema,
};

// ---------- PUT /api/indicadores-cem/trimestre ----------
// Ventas: el OS del trimestre y el resultado de la auditoría, por provincia.
// Posventa: las notas Q1 a Q4 del trimestre (las publica fábrica: no son el promedio
// de los meses, 19-09-2026).
const trimestreSchema = z.object({
  ...trimestreBase,
  sucursal: z.string().trim().min(1),
  os: osSchema.optional(),
  resultadoAuditoria: porcentajeSchema.optional(),
  ...notasSchema,
});
const CAMPOS_TRIMESTRE_VENTAS = ["os", "resultadoAuditoria"] as const;
const CAMPOS_TRIMESTRE = [...CAMPOS_TRIMESTRE_VENTAS, ...CAMPOS_NOTA] as const;

export async function guardarTrimestreCem(req: Request, res: Response) {
  const noPuede = puedeCargar(req);
  if (noPuede) return res.status(403).json({ message: noPuede });
  const parsed = trimestreSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors.map((e) => e.message).join(" ") });
  }
  const { anio, trimestre, area } = parsed.data;
  const sucursal = sucursalValida(parsed.data.sucursal);
  if (!sucursal) return res.status(400).json({ message: mensajeSucursalInvalida() });
  const fueraDelArea = motivoSucursalDelArea(area, sucursal);
  if (fueraDelArea) return res.status(400).json({ message: fueraDelArea });
  const motivo = motivoProvincia(req, sucursal);
  if (motivo) return res.status(403).json({ message: motivo });

  const propios: readonly (typeof CAMPOS_TRIMESTRE)[number][] =
    area === AreaCem.POSVENTA ? CAMPOS_NOTA : CAMPOS_TRIMESTRE_VENTAS;
  const ajenos = motivoCamposAjenos(area, enviados(parsed.data, CAMPOS_TRIMESTRE), propios);
  if (ajenos) return res.status(400).json({ message: ajenos });
  const datos = Object.fromEntries(enviados(parsed.data, propios).map((c) => [c, parsed.data[c]]));
  const guardado = await prisma.indicadorCemTrimestre.upsert({
    where: { anio_trimestre_sucursal_area: { anio, trimestre, sucursal, area } },
    create: { anio, trimestre, sucursal, area, ...datos, actualizadoPorNombre: req.usuario?.nombre ?? null },
    update: { ...datos, actualizadoPorNombre: req.usuario?.nombre ?? null },
  });
  auditar(req, {
    accion: ACCIONES.INDICADORES_CEM_EDITADOS,
    entidad: "IndicadorCemTrimestre",
    entidadId: guardado.id,
    detalles: { anio, trimestre, sucursal, area, despues: datos },
  });
  res.json({ data: guardado });
}

// ---------- PUT /api/indicadores-cem/objetivos ----------
// Valen para las dos provincias: los carga quien no tiene una provincia asignada.
// Ventas: OS, % de cargas y % de mails válidos. Posventa: la tabla "Objetivos LVS",
// desde qué nota empieza cada escala (19-09-2026).
const escalaSchema = z.number().min(0, "La nota LVS va de 0 a 5.").max(5, "La nota LVS va de 0 a 5.").nullable();
const objetivosSchema = z.object({
  ...trimestreBase,
  os: osSchema.optional(),
  cargas: porcentajeSchema.optional(),
  mailValidos: porcentajeSchema.optional(),
  lvsEscala1: escalaSchema.optional(),
  lvsEscala2: escalaSchema.optional(),
  lvsEscala3: escalaSchema.optional(),
  lvsEscala4: escalaSchema.optional(),
});
const CAMPOS_OBJETIVO_VENTAS = ["os", "cargas", "mailValidos"] as const;
const CAMPOS_OBJETIVO = [...CAMPOS_OBJETIVO_VENTAS, ...CAMPOS_ESCALA] as const;

/**
 * La tabla de escalas tiene que quedar entera o vacía, y de mayor a menor: con una
 * escala que empieza más abajo que la siguiente, la cuenta daría cualquier cosa. Se
 * valida la tabla que QUEDA (lo guardado más lo que llega), no solo lo que llega.
 */
function motivoTablaEscalas(tabla: Array<number | null>): string | null {
  const cargadas = tabla.filter((v): v is number => v !== null);
  if (cargadas.length === 0) return null;
  if (cargadas.length < 4) return "Completá las cuatro escalas (o dejalas todas vacías).";
  for (let i = 1; i < 4; i++) {
    if (!(Math.round(tabla[i - 1]! * 100) > Math.round(tabla[i]! * 100))) {
      return `La Escala ${i} tiene que empezar más arriba que la Escala ${i + 1}.`;
    }
  }
  return null;
}

export async function guardarObjetivosCem(req: Request, res: Response) {
  const noPuede = puedeCargar(req);
  if (noPuede) return res.status(403).json({ message: noPuede });
  const provincia = provinciaPermitida(req.usuario!);
  if (provincia) {
    return res.status(403).json({
      message: "Los objetivos valen para las dos provincias: los carga alguien que vea las dos.",
    });
  }
  const parsed = objetivosSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors.map((e) => e.message).join(" ") });
  }
  const { anio, trimestre, area } = parsed.data;
  const propios: readonly (typeof CAMPOS_OBJETIVO)[number][] =
    area === AreaCem.POSVENTA ? CAMPOS_ESCALA : CAMPOS_OBJETIVO_VENTAS;
  const ajenos = motivoCamposAjenos(area, enviados(parsed.data, CAMPOS_OBJETIVO), propios);
  if (ajenos) return res.status(400).json({ message: ajenos });
  const datos = Object.fromEntries(enviados(parsed.data, propios).map((c) => [c, parsed.data[c]]));

  // Cada área tiene sus propios objetivos (decisión del 18-09-2026).
  const clave = { anio_trimestre_area: { anio, trimestre, area } };
  if (area === AreaCem.POSVENTA) {
    const antes = await prisma.objetivoCemTrimestre.findUnique({ where: clave });
    const tabla = CAMPOS_ESCALA.map((c) => (c in datos ? (datos[c] as number | null) : antes?.[c] ?? null));
    const mal = motivoTablaEscalas(tabla);
    if (mal) return res.status(400).json({ message: mal });
  }
  const guardado = await prisma.objetivoCemTrimestre.upsert({
    where: clave,
    create: { anio, trimestre, area, ...datos, actualizadoPorNombre: req.usuario?.nombre ?? null },
    update: { ...datos, actualizadoPorNombre: req.usuario?.nombre ?? null },
  });
  auditar(req, {
    accion: ACCIONES.INDICADORES_CEM_EDITADOS,
    entidad: "ObjetivoCemTrimestre",
    entidadId: guardado.id,
    detalles: { anio, trimestre, area, despues: datos },
  });
  res.json({ data: guardado });
}
