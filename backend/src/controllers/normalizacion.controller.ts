import { Request, Response } from "express";
import { TipoAlias } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { ACCIONES, auditar } from "../services/audit.service";
import {
  claveNormalizada,
  parsearAsesor,
  parsearSucursal,
} from "../services/normalizacion.service";

// ---------- GET /api/normalizacion/valores?tipo=ASESOR|SUCURSAL ----------
// Lista los valores distintos presentes en la base con su cantidad de casos,
// para que el ADMIN detecte variantes que la normalización no unificó.

const valoresSchema = z.object({ tipo: z.nativeEnum(TipoAlias).default(TipoAlias.ASESOR) });

interface ValorDistinto {
  nombre: string;
  codigo: string | null;
  clave: string;
  casos: number;
}

export async function valoresDistintos(req: Request, res: Response) {
  const parsed = valoresSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Tipo inválido." });

  let valores: ValorDistinto[];
  if (parsed.data.tipo === TipoAlias.ASESOR) {
    const filas = await prisma.caso.groupBy({
      by: ["asesor", "asesorCodigo"],
      where: { eliminadoEn: null },
      _count: { _all: true },
    });
    valores = filas.map((f) => ({
      nombre: f.asesor || "(sin dato)",
      codigo: f.asesorCodigo,
      clave: claveNormalizada(f.asesor || ""),
      casos: f._count._all,
    }));
  } else {
    const filas = await prisma.caso.groupBy({
      by: ["sucursal"],
      where: { eliminadoEn: null },
      _count: { _all: true },
    });
    valores = filas.map((f) => ({
      nombre: f.sucursal || "(sin dato)",
      codigo: null,
      clave: claveNormalizada(f.sucursal || ""),
      casos: f._count._all,
    }));
  }

  valores.sort((a, b) => b.casos - a.casos || a.nombre.localeCompare(b.nombre, "es"));
  res.json({ tipo: parsed.data.tipo, valores });
}

// ---------- GET /api/normalizacion/alias ----------

export async function listAlias(_req: Request, res: Response) {
  const alias = await prisma.aliasNormalizacion.findMany({
    orderBy: { creadoEn: "desc" },
    include: { creadoPor: { select: { nombre: true } } },
  });
  res.json({ data: alias });
}

// ---------- POST /api/normalizacion/alias ----------
// Declara que `valorVariante` equivale a `valorCanonico`. Reescribe los casos
// existentes que matcheen y queda guardado para las importaciones futuras.

const crearAliasSchema = z.object({
  tipo: z.nativeEnum(TipoAlias),
  valorVariante: z.string().trim().min(1, "Indicá el valor a unificar."),
  valorCanonico: z.string().trim().min(1, "Indicá el valor correcto (canónico)."),
  codigoCanonico: z.string().trim().min(1).optional(),
});

export async function crearAlias(req: Request, res: Response) {
  const parsed = crearAliasSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Datos inválidos." });
  }
  const { tipo, valorVariante, valorCanonico, codigoCanonico } = parsed.data;
  const esAsesor = tipo === TipoAlias.ASESOR;

  // Clave normalizada del valor VARIANTE (así matchea la clave que usan las
  // importaciones y los reportes al agrupar).
  const nombreVariante = esAsesor ? parsearAsesor(valorVariante).nombre : parsearSucursal(valorVariante).nombre;
  const claveOrigen = claveNormalizada(nombreVariante);

  const claveCanonica = claveNormalizada(
    esAsesor ? parsearAsesor(valorCanonico).nombre : parsearSucursal(valorCanonico).nombre
  );
  if (claveOrigen === claveCanonica) {
    return res.status(400).json({ message: "La variante y el valor canónico son el mismo; no hace falta un alias." });
  }

  const alias = await prisma.aliasNormalizacion.upsert({
    where: { tipo_claveOrigen: { tipo, claveOrigen } },
    create: { tipo, claveOrigen, valorCanonico, codigoCanonico: codigoCanonico ?? null, creadoPorId: req.usuario!.id },
    update: { valorCanonico, codigoCanonico: codigoCanonico ?? null },
  });

  // Reescribir los casos existentes que matcheen la clave variante.
  const casos = await prisma.caso.findMany({
    where: { eliminadoEn: null },
    select: { id: true, asesor: true, sucursal: true },
  });
  const idsAfectados = casos
    .filter((c) => claveNormalizada(esAsesor ? c.asesor : c.sucursal) === claveOrigen)
    .map((c) => c.id);

  if (idsAfectados.length > 0) {
    await prisma.caso.updateMany({
      where: { id: { in: idsAfectados } },
      data: esAsesor
        ? { asesor: valorCanonico, ...(codigoCanonico ? { asesorCodigo: codigoCanonico } : {}) }
        : { sucursal: valorCanonico },
    });
  }

  await auditar(req, {
    accion: ACCIONES.ALIAS_CREADO,
    entidad: "AliasNormalizacion",
    entidadId: alias.id,
    detalles: { tipo, de: valorVariante, a: valorCanonico, casosReescritos: idsAfectados.length },
  });

  res.status(201).json({
    message: `Listo: "${valorVariante}" ahora se unifica como "${valorCanonico}". Se actualizaron ${idsAfectados.length} caso(s).`,
    casosReescritos: idsAfectados.length,
  });
}

// ---------- DELETE /api/normalizacion/alias/:id ----------

export async function eliminarAlias(req: Request, res: Response) {
  const alias = await prisma.aliasNormalizacion.findUnique({ where: { id: req.params.id } });
  if (!alias) return res.status(404).json({ message: "No se encontró ese alias." });

  await prisma.aliasNormalizacion.delete({ where: { id: alias.id } });

  await auditar(req, {
    accion: ACCIONES.ALIAS_ELIMINADO,
    entidad: "AliasNormalizacion",
    entidadId: alias.id,
    detalles: { tipo: alias.tipo, claveOrigen: alias.claveOrigen, valorCanonico: alias.valorCanonico },
  });

  res.json({
    message: "Alias eliminado. Las importaciones futuras ya no lo aplican (los casos ya reescritos no se revierten).",
  });
}
