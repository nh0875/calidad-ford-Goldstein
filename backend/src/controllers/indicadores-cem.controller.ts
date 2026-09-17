import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { mensajeSucursalInvalida, SUCURSAL_GENERAL, sucursalCanonica } from "../config/marca";
import { ACCIONES, auditar } from "../services/audit.service";
import { provinciaPermitida } from "../services/area.service";
import { claveNormalizada } from "../services/normalizacion.service";
import { CAMPOS_MES, indicadoresDelAnio } from "../services/indicadores-cem.service";

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

/** Por qué este usuario no puede tocar los números de esa provincia, o null. */
function motivoProvincia(req: Request, sucursal: string): string | null {
  const provincia = provinciaPermitida(req.usuario!);
  if (provincia && claveNormalizada(provincia) !== claveNormalizada(sucursal)) {
    return `Tu usuario es de ${provincia}: solo puede cargar los indicadores de esa provincia.`;
  }
  return null;
}

// ---------- GET /api/indicadores-cem?anio= ----------
export async function obtenerIndicadoresCem(req: Request, res: Response) {
  const anio = req.query.anio ? Number(req.query.anio) : new Date().getFullYear();
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) {
    return res.status(400).json({ message: "El año no es válido." });
  }
  const datos = await indicadoresDelAnio(anio);
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
const mesSchema = z.object({
  periodo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "El mes tiene que tener el formato AAAA-MM."),
  sucursal: z.string().trim().min(1),
  patentamientos: entero.optional(),
  baseCem: entero.optional(),
  baseCemTradicional: entero.optional(),
  baseCemAutoahorro: entero.optional(),
  encuestasEfectivas: entero.optional(),
  baseSinDuplicados: entero.optional(),
  mailOk: entero.optional(),
  os: z.number().min(0, "El OS va de 0 a 5.").max(5, "El OS va de 0 a 5.").nullable().optional(),
});

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
  const motivo = motivoProvincia(req, sucursal);
  if (motivo) return res.status(403).json({ message: motivo });

  const datos = Object.fromEntries(
    CAMPOS_MES.filter((c) => parsed.data[c] !== undefined).map((c) => [c, parsed.data[c]])
  );
  const antes = await prisma.indicadorCemMes.findUnique({
    where: { periodo_sucursal: { periodo: parsed.data.periodo, sucursal } },
  });
  const guardado = await prisma.indicadorCemMes.upsert({
    where: { periodo_sucursal: { periodo: parsed.data.periodo, sucursal } },
    create: { periodo: parsed.data.periodo, sucursal, ...datos, actualizadoPorNombre: req.usuario?.nombre ?? null },
    update: { ...datos, actualizadoPorNombre: req.usuario?.nombre ?? null },
  });
  auditar(req, {
    accion: ACCIONES.INDICADORES_CEM_EDITADOS,
    entidad: "IndicadorCemMes",
    entidadId: guardado.id,
    detalles: {
      periodo: parsed.data.periodo,
      sucursal,
      antes: antes ? Object.fromEntries(CAMPOS_MES.map((c) => [c, antes[c]])) : null,
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
};

// ---------- PUT /api/indicadores-cem/trimestre ----------
// El OS del trimestre y el resultado de la auditoría, por provincia.
const trimestreSchema = z.object({
  ...trimestreBase,
  sucursal: z.string().trim().min(1),
  os: osSchema.optional(),
  resultadoAuditoria: porcentajeSchema.optional(),
});

export async function guardarTrimestreCem(req: Request, res: Response) {
  const noPuede = puedeCargar(req);
  if (noPuede) return res.status(403).json({ message: noPuede });
  const parsed = trimestreSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors.map((e) => e.message).join(" ") });
  }
  const { anio, trimestre } = parsed.data;
  const sucursal = sucursalValida(parsed.data.sucursal);
  if (!sucursal) return res.status(400).json({ message: mensajeSucursalInvalida() });
  const motivo = motivoProvincia(req, sucursal);
  if (motivo) return res.status(403).json({ message: motivo });

  const datos = {
    ...(parsed.data.os !== undefined ? { os: parsed.data.os } : {}),
    ...(parsed.data.resultadoAuditoria !== undefined ? { resultadoAuditoria: parsed.data.resultadoAuditoria } : {}),
  };
  const guardado = await prisma.indicadorCemTrimestre.upsert({
    where: { anio_trimestre_sucursal: { anio, trimestre, sucursal } },
    create: { anio, trimestre, sucursal, ...datos, actualizadoPorNombre: req.usuario?.nombre ?? null },
    update: { ...datos, actualizadoPorNombre: req.usuario?.nombre ?? null },
  });
  auditar(req, {
    accion: ACCIONES.INDICADORES_CEM_EDITADOS,
    entidad: "IndicadorCemTrimestre",
    entidadId: guardado.id,
    detalles: { anio, trimestre, sucursal, despues: datos },
  });
  res.json({ data: guardado });
}

// ---------- PUT /api/indicadores-cem/objetivos ----------
// Valen para las dos provincias: los carga quien no tiene una provincia asignada.
const objetivosSchema = z.object({
  ...trimestreBase,
  os: osSchema.optional(),
  cargas: porcentajeSchema.optional(),
  mailValidos: porcentajeSchema.optional(),
});

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
  const { anio, trimestre } = parsed.data;
  const datos = {
    ...(parsed.data.os !== undefined ? { os: parsed.data.os } : {}),
    ...(parsed.data.cargas !== undefined ? { cargas: parsed.data.cargas } : {}),
    ...(parsed.data.mailValidos !== undefined ? { mailValidos: parsed.data.mailValidos } : {}),
  };
  const guardado = await prisma.objetivoCemTrimestre.upsert({
    where: { anio_trimestre: { anio, trimestre } },
    create: { anio, trimestre, ...datos, actualizadoPorNombre: req.usuario?.nombre ?? null },
    update: { ...datos, actualizadoPorNombre: req.usuario?.nombre ?? null },
  });
  auditar(req, {
    accion: ACCIONES.INDICADORES_CEM_EDITADOS,
    entidad: "ObjetivoCemTrimestre",
    entidadId: guardado.id,
    detalles: { anio, trimestre, despues: datos },
  });
  res.json({ data: guardado });
}
