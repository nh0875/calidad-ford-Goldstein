import { TipoAlias } from "@prisma/client";
import { prisma } from "../config/prisma";
import { normalizarTelefonoAR } from "./telefono.service";

// ---------- Claves de agrupación (insensibles a acentos y mayúsculas) ----------

/** Clave para agrupar/comparar: sin tildes, minúsculas, espacios colapsados. */
export function claveNormalizada(texto: string): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita diacríticos (tildes)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Title Case preservando acentos: "CARLA CAMPORA" -> "Carla Campora". */
function tituloCase(texto: string): string {
  return texto
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

// ---------- Parseo de asesor ----------

export interface ValorNormalizado {
  nombre: string; // para mostrar/agrupar (Title Case, con acentos)
  codigo: string | null; // identificador numérico si venía en el texto
}

/**
 * Separa el nombre del asesor de su código numérico y normaliza el nombre.
 * "CARLA CAMPORA - 140445" -> { nombre: "Carla Campora", codigo: "140445" }
 * "Carla Campora"          -> { nombre: "Carla Campora", codigo: null }
 */
export function parsearAsesor(raw: unknown): ValorNormalizado {
  const original = String(raw ?? "").trim();
  if (!original) return { nombre: "", codigo: null };

  let nombre = original;
  let codigo: string | null = null;

  // Código numérico (3+ dígitos) al final, con separadores opcionales antes.
  const m = original.match(/^(.*?)[\s\-–—#:().]*(\d{3,})[\s).]*$/);
  if (m && m[1].trim()) {
    nombre = m[1];
    codigo = m[2];
  }

  nombre = nombre.replace(/[\s\-–—#:.]+$/g, "").replace(/\s+/g, " ").trim();
  nombre = tituloCase(nombre);

  return { nombre: nombre || tituloCase(original), codigo };
}

/** La sucursal no suele traer código; solo se normaliza la capitalización. */
export function parsearSucursal(raw: unknown): ValorNormalizado {
  const original = String(raw ?? "").trim();
  if (!original) return { nombre: "", codigo: null };
  return { nombre: tituloCase(original.replace(/\s+/g, " ")), codigo: null };
}

// ---------- Teléfonos normalizados (para cruzar con la supresión) ----------

export function telefonosNormalizados(...valores: unknown[]): string[] {
  const set = new Set<string>();
  for (const v of valores) {
    const n = normalizarTelefonoAR(v);
    if (n) set.add(n);
  }
  return [...set];
}

// ---------- Alias declarados por el ADMIN ----------

export interface AliasCanonico {
  valorCanonico: string;
  codigoCanonico: string | null;
}

/** Carga los alias de un tipo en un mapa clave→canónico (para importaciones en lote). */
export async function cargarAliasMap(tipo: TipoAlias): Promise<Map<string, AliasCanonico>> {
  const alias = await prisma.aliasNormalizacion.findMany({ where: { tipo } });
  const mapa = new Map<string, AliasCanonico>();
  for (const a of alias) {
    mapa.set(a.claveOrigen, { valorCanonico: a.valorCanonico, codigoCanonico: a.codigoCanonico });
  }
  return mapa;
}

/** Aplica un alias (si existe) sobre un valor ya parseado. */
export function aplicarAlias(base: ValorNormalizado, aliasMap: Map<string, AliasCanonico>): ValorNormalizado {
  const alias = aliasMap.get(claveNormalizada(base.nombre));
  if (!alias) return base;
  return { nombre: alias.valorCanonico, codigo: alias.codigoCanonico ?? base.codigo };
}

/**
 * Clave de agrupación DEFINITIVA de un asesor para reportes/rankings: si tiene
 * código, se usa el código (desambigua homónimos); si no, la clave del nombre.
 */
export function claveAgrupacionAsesor(nombre: string, codigo: string | null): string {
  return codigo ? `cod:${codigo}` : `nom:${claveNormalizada(nombre)}`;
}
