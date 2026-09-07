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
  FilaEncuestaVWListaParaImportar,
  esHojaFormatoInterno,
  parsearFechaVW,
  parsearHojaInternaVW,
  partirCodigoVendedor,
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
    select: { codigo: true, nombre: true },
  });
  const porNombre = new Map<string, string[]>();
  for (const v of vendedores) {
    const k = claveNormalizada(v.nombre ?? "");
    if (!k) continue;
    porNombre.set(k, [...(porNombre.get(k) ?? []), v.codigo]);
  }
  for (const nombre of nombres) {
    const k = claveNormalizada(nombre);
    if (mapa.has(k)) continue;
    const candidatos = porNombre.get(k);
    // Si hay DOS vendedores con el mismo nombre no se elige ninguno: que lo
    // decida una persona, no la suerte del orden de la consulta.
    if (candidatos && candidatos.length === 1) mapa.set(k, candidatos[0]);
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
      const partido = partirCodigoVendedor(codigo);
      if (!partido) {
        rechazar(`El código asignado a "${nombreVendedor}" ("${codigo}") no tiene 7 dígitos.`);
        continue;
      }
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
