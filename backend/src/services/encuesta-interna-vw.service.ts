// ---------------------------------------------------------------------------
// El Excel INTERNO de encuestas (Volkswagen)
// ---------------------------------------------------------------------------
//
// La pantalla de Encuestas de fábrica acepta dos archivos distintos:
//
//   FABRICA  — el que baja de la plataforma de Volkswagen. Una hoja por sucursal,
//              el vendedor como CÓDIGO de 7 dígitos, el cliente partido en Nombre
//              y Apellido, más una hoja con los nombres de los vendedores.
//   INTERNO  — el export de la concesionaria ("Carga encuestas internas"). Una
//              sola hoja, el cliente completo en una columna y el vendedor por
//              NOMBRE. No trae el código por ningún lado.
//
// Los dos alimentan la MISMA lista de pendientes, así que este módulo traduce el
// interno a la misma estructura que ya produce el lector de fábrica y el resto de
// la importación sigue igual, sin duplicar la lógica de guardado.
//
// EL PROBLEMA A RESOLVER ES EL VENDEDOR. Todo el modelo se apoya en el código de
// 7 dígitos: los primeros 4 son la sucursal (de ahí sale a qué sucursal pertenece
// el cliente) y los 3 últimos el vendedor (a quién avisarle). El archivo interno
// trae "RUGGERI HORACIO GUSTAVO" y nada más. Emparejar a ojo es jugar a la ruleta
// con a quién se le manda el mail, así que:
//
//   1. Si ya hay un alias guardado para ese nombre, se usa (se resolvió una vez y
//      queda resuelto para siempre).
//   2. Si no, se busca un vendedor cargado cuyo nombre coincida EXACTAMENTE
//      (normalizado: sin acentos, sin mayúsculas, sin espacios de más). Exacto y
//      no parecido: dos vendedores con apellido igual no se pueden confundir.
//   3. Lo que no se resuelve solo, se le muestra a la persona en la vista previa
//      para que lo asigne, y esa asignación se guarda como alias.

import { TipoAlias } from "@prisma/client";
import * as XLSX from "xlsx";
import { prisma } from "../config/prisma";
import { claveNormalizada } from "./normalizacion.service";
import {
  ArchivoEncuestaVW,
  clavePersonaVendedor,
  FilaEncuestaVWListaParaImportar,
  esHojaFormatoInterno,
  parsearFechaVW,
  parsearHojaInternaVW,
  partirCodigoVendedor,
  prefijoDeSucursal,
} from "./encuesta-vw.service";
import { leerFilasCrudas } from "./excel.service";

/** ¿Este libro es del formato interno? Alcanza con que UNA hoja lo sea. */
export function esArchivoInternoVW(workbook: XLSX.WorkBook): boolean {
  return workbook.SheetNames.some((n) => {
    const hoja = workbook.Sheets[n];
    if (!hoja) return false;
    const encabezados = leerFilasCrudas(hoja)[0] ?? [];
    return esHojaFormatoInterno(encabezados);
  });
}

/** Todos los nombres de vendedor que aparecen en el libro, con repeticiones. */
export function nombresDeVendedorDelLibro(workbook: XLSX.WorkBook): string[] {
  const nombres: string[] = [];
  for (const nombreHoja of workbook.SheetNames) {
    const hoja = workbook.Sheets[nombreHoja];
    if (!hoja) continue;
    if (!esHojaFormatoInterno(leerFilasCrudas(hoja)[0] ?? [])) continue;
    const r = parsearHojaInternaVW(workbook, nombreHoja);
    if ("error" in r) continue;
    for (const f of r.filas) if (f.campos.vendedorNombre) nombres.push(f.campos.vendedorNombre);
  }
  return nombres;
}

export interface VendedorSinResolver {
  /** El nombre tal cual viene en el Excel, para mostrárselo a la persona. */
  nombre: string;
  /** Cuántas filas del archivo dependen de resolverlo. */
  filas: number;
}

export interface ResolucionVendedores {
  /** clave normalizada del nombre -> código de 7 dígitos */
  mapa: Map<string, string>;
  sinResolver: VendedorSinResolver[];
}

/**
 * Resuelve los nombres de vendedor del archivo contra los códigos conocidos.
 * `extra` son las asignaciones que la persona acaba de hacer en la pantalla
 * (nombre tal cual viene -> código), que pisan a lo que se dedujo solo.
 */
export async function resolverVendedores(
  nombres: string[],
  extra: Record<string, string> = {}
): Promise<ResolucionVendedores> {
  const mapa = new Map<string, string>();

  // 1. Alias ya guardados.
  const alias = await prisma.aliasNormalizacion.findMany({
    where: { tipo: TipoAlias.VENDEDOR_VW },
    select: { claveOrigen: true, codigoCanonico: true },
  });
  for (const a of alias) {
    if (a.codigoCanonico) mapa.set(a.claveOrigen, a.codigoCanonico);
  }

  // 2. Coincidencia EXACTA con el nombre de un vendedor ya cargado.
  const vendedores = await prisma.vendedorVW.findMany({
    where: { nombre: { not: null } },
    select: { codigo: true, numero: true, nombre: true },
    orderBy: { codigo: "asc" },
  });
  const porNombre = new Map<string, Array<{ codigo: string; numero: number }>>();
  for (const v of vendedores) {
    const k = claveNormalizada(v.nombre ?? "");
    if (!k) continue;
    porNombre.set(k, [...(porNombre.get(k) ?? []), v]);
  }
  for (const nombre of nombres) {
    const k = claveNormalizada(nombre);
    if (mapa.has(k)) continue;
    const candidatos = porNombre.get(k) ?? [];
    // Si hay DOS vendedores con el mismo nombre no se elige ninguno: que lo
    // decida una persona, no la suerte del orden de la consulta.
    //
    // Salvo que sean la MISMA persona: el 1035078 y el 1036078 llevan el mismo
    // nombre a propósito (se guarda en todos sus códigos). Ahí da igual cuál se
    // tome, porque convertirInternoAArchivo le pone el prefijo de la sucursal de
    // la venta; sin Suc. Cpa. queda el primero (el de código más bajo).
    const personas = new Set(candidatos.map((c) => clavePersonaVendedor(c)));
    if (candidatos.length > 0 && personas.size === 1) mapa.set(k, candidatos[0].codigo);
  }

  // 3. Lo que la persona asignó recién, que manda sobre todo lo anterior.
  for (const [nombre, codigo] of Object.entries(extra)) {
    const k = claveNormalizada(nombre);
    if (k && codigo) mapa.set(k, codigo);
  }

  const sinResolver: VendedorSinResolver[] = [];
  const contados = new Map<string, number>();
  for (const n of nombres) contados.set(n, (contados.get(n) ?? 0) + 1);
  for (const nombre of [...new Set(nombres)]) {
    if (!mapa.has(claveNormalizada(nombre))) {
      sinResolver.push({ nombre, filas: contados.get(nombre) ?? 0 });
    }
  }

  return { mapa, sinResolver };
}

/** Deja guardadas las asignaciones para que la próxima carga las reconozca sola. */
export async function guardarMapeoVendedores(
  asignaciones: Record<string, string>,
  usuarioId: string | null
): Promise<number> {
  let guardadas = 0;
  for (const [nombre, codigo] of Object.entries(asignaciones)) {
    const claveOrigen = claveNormalizada(nombre);
    if (!claveOrigen || !codigo) continue;
    await prisma.aliasNormalizacion.upsert({
      where: { tipo_claveOrigen: { tipo: TipoAlias.VENDEDOR_VW, claveOrigen } },
      create: {
        tipo: TipoAlias.VENDEDOR_VW,
        claveOrigen,
        valorCanonico: nombre,
        codigoCanonico: codigo,
        creadoPorId: usuarioId,
      },
      update: { valorCanonico: nombre, codigoCanonico: codigo },
    });
    guardadas++;
  }
  return guardadas;
}

const MAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "M.G. MZA." -> "MENDOZA". La columna Suc. Cpa. dice dónde se hizo la venta, y
 * ESA es la sucursal del cliente: un vendedor de Mendoza puede vender en San Juan
 * y el cliente pertenece a San Juan, no a la sucursal del vendedor.
 *
 * Si aparece una sucursal que no se reconoce se devuelve el texto tal cual, sin
 * inventar: es preferible una sucursal con un nombre raro a una equivocada.
 */
export function normalizarSucursalVenta(texto: string | null | undefined): string | null {
  const t = claveNormalizada(texto ?? "");
  if (!t) return null;
  if (t.includes("mza") || t.includes("mendoza")) return "MENDOZA";
  if (t.includes("s.j") || t.includes("sj") || t.includes("san juan")) return "SAN JUAN";
  return (texto ?? "").trim() || null;
}

/**
 * Traduce el libro interno a la MISMA estructura que produce el lector de
 * fábrica, para que el guardado sea uno solo.
 */
export function convertirInternoAArchivo(
  workbook: XLSX.WorkBook,
  mapa: Map<string, string>
): ArchivoEncuestaVW | { error: string } {
  const filas: FilaEncuestaVWListaParaImportar[] = [];
  const rechazadas: ArchivoEncuestaVW["rechazadas"] = [];
  const avisos: string[] = [];
  const hojas: ArchivoEncuestaVW["hojas"] = [];

  let algunaHoja = false;

  for (const nombreHoja of workbook.SheetNames) {
    const hoja = workbook.Sheets[nombreHoja];
    if (!hoja) continue;
    const encabezados = leerFilasCrudas(hoja)[0] ?? [];
    if (!esHojaFormatoInterno(encabezados)) continue;

    const parseada = parsearHojaInternaVW(workbook, nombreHoja);
    if ("error" in parseada) {
      avisos.push(parseada.error);
      continue;
    }
    algunaHoja = true;

    for (const fila of parseada.filas) {
      const c = fila.campos;
      const chasis = (c.chasis ?? "").toUpperCase();
      const nombreVendedor = c.vendedorNombre ?? "";
      const codigo = mapa.get(claveNormalizada(nombreVendedor));

      // El chasis va SIEMPRE en el rechazo, aunque la fila no sirva: el archivo
      // la sigue listando como pendiente, y sin el chasis la barrida la daría
      // por respondida por un dato mal cargado.
      const rechazar = (motivo: string) =>
        rechazadas.push({ hoja: nombreHoja, numeroFilaExcel: fila.numeroFilaExcel, motivo, chasis });

      if (!chasis) {
        rechazar("La fila no tiene número de chasis, que es lo que identifica la unidad.");
        continue;
      }
      if (!nombreVendedor) {
        rechazar("La fila no dice qué vendedor la atendió.");
        continue;
      }
      if (!codigo) {
        rechazar(`El vendedor "${nombreVendedor}" todavía no está asignado a ningún código.`);
        continue;
      }
      const asignado = partirCodigoVendedor(codigo);
      if (!asignado) {
        rechazar(`El código asignado a "${nombreVendedor}" ("${codigo}") no tiene 7 dígitos.`);
        continue;
      }
      // La venta manda sobre el vendedor. Al nombre le toca UN código (el de su
      // sucursal), pero si vendió en la otra se carga con el prefijo de esa: un
      // mendocino 1035078 que vendió en San Juan entra como 1036078. Así el
      // cliente es de San Juan por la regla estricta del código, y en "Todas las
      // provincias" se junta con su 1035078 (decisión de Calidad de VW,
      // 16-09-2026). Sin Suc. Cpa., o con una que no se reconoce, queda el asignado.
      const sucursalVenta = normalizarSucursalVenta(c.sucursalTexto);
      const prefijoVenta = prefijoDeSucursal(sucursalVenta);
      const partido =
        prefijoVenta && prefijoVenta !== asignado.sucursal
          ? partirCodigoVendedor(`${prefijoVenta}${String(asignado.numero).padStart(3, "0")}`) ?? asignado
          : asignado;
      const cliente = (c.cliente ?? "").trim();
      if (!cliente) {
        rechazar("La fila no tiene nombre del cliente.");
        continue;
      }
      const email = (c.email ?? "").trim();
      if (!email || !MAIL_VALIDO.test(email)) {
        rechazar(email ? `El mail "${email}" no parece válido.` : "La fila no tiene mail del cliente.");
        continue;
      }

      filas.push({
        numeroFilaExcel: fila.numeroFilaExcel,
        hoja: nombreHoja,
        codigoVendedor: partido.completo,
        codigoSucursal: partido.sucursal,
        numeroVendedor: partido.numero,
        nombreVendedor,
        nombreCliente: cliente,
        email,
        chasis,
        dominio: c.dominio ?? null,
        // El archivo interno no trae el canal de ventas de fábrica
        // (TRADICIONAL / AUTOAHORRO), así que el área queda sin determinar.
        canalVentas: null,
        area: null,
        fechaEntrega: parsearFechaVW(c.fechaEntrega),
        observacionesFabrica: [],
        sucursalVenta,
      });
    }
  }

  if (!algunaHoja) {
    return { error: "El archivo no tiene ninguna hoja con el formato interno (se busca una columna Cliente)." };
  }

  return {
    hojas,
    vendedores: [],
    filas,
    rechazadas,
    // El archivo interno no trae una hoja de nombres: el nombre ES el dato.
    vendedoresSinNombre: [],
    avisos,
  };
}
