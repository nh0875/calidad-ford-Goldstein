import { EstadoEncuestaFabrica, TipoUpload, UploadStatus } from "@prisma/client";
import { prisma } from "../config/prisma";
import { abrirWorkbook } from "./excel.service";
import {
  convertirInternoAArchivo,
  esArchivoInternoVW,
  guardarMapeoVendedores,
  nombresDeVendedorDelLibro,
  resolverVendedores,
} from "./encuesta-interna-vw.service";
import { ACCIONES } from "./audit.service";
import { ArchivoEncuestaVW, parsearArchivoEncuestaVW } from "./encuesta-vw.service";

/**
 * Importa el Excel de encuestas pendientes de fábrica de Volkswagen.
 *
 * LA CARGA AGREGA CLIENTES. NO CAMBIA EL ESTADO DE NINGUNO.
 *
 * El estado de un cliente lo cambian solo dos cosas, y las dos son decisiones de
 * una persona:
 *   1. alguien lo cambia a mano desde la lista, o
 *   2. alguien aprieta "Avisar a los vendedores" (PENDIENTE → AVISADO).
 *
 * Hasta septiembre de 2026 la carga también cerraba: tomaba el archivo como una
 * foto de quién debe la encuesta HOY, y a todo cliente que ya no venía lo daba
 * por respondido. En la práctica eso le pasaba por arriba al trabajo de Calidad:
 * se subía un Excel con clientes nuevos y los pendientes que se estaban
 * gestionando aparecían como "Respondió" sin que nadie los hubiera tocado. Lo
 * pidió sacar el dueño (14-09-2026).
 *
 * LO QUE ESO IMPLICA, y conviene saberlo antes de volver a tocar esto: la tasa de
 * respuesta del tablero de Encuestas de fábrica ya no se completa sola. Cuenta
 * los clientes que alguien marcó como "Respondió" a mano, y nada más.
 */

export interface ResumenImportacionVW {
  uploadId: string;
  sucursales: string[];
  vendedoresNuevos: number;
  vendedoresActualizados: number;
  vendedoresSinMail: Array<{ codigo: string; nombre: string | null; sucursal: string; pendientes: number }>;
  pendientesNuevos: number;
  /** Clientes que ya estaban en la lista: se actualizan sus datos, NO su estado. */
  pendientesQueSiguen: number;
  filasRechazadas: Array<{ hoja: string; numeroFilaExcel: number; motivo: string }>;
  filasObservadasPorFabrica: number;
  /**
   * Vendedores que aparecieron con el prefijo de la OTRA sucursal y se
   * reconocieron como la misma persona (se les heredó nombre y correo).
   */
  vendedoresDeOtraSucursal: Array<{ codigo: string; nombre: string | null; vieneDe: string }>;
  avisos: string[];
}

export interface OpcionesImportacionVW {
  buffer: Buffer;
  filename: string;
  uploadedBy: string;
  /**
   * Solo para el formato INTERNO: nombre de vendedor tal como viene en el Excel
   * -> código de 7 dígitos, asignado por la persona en la vista previa. Se guarda
   * como alias para que la próxima carga lo reconozca sola.
   */
  mapeoVendedores?: Record<string, string>;
  usuarioId?: string | null;
  auditar?: (d: { accion: string; entidad: string; entidadId?: string; detalles?: unknown }) => void;
}

export async function importarEncuestaFabricaVW(
  opciones: OpcionesImportacionVW
): Promise<ResumenImportacionVW | { error: string }> {
  const workbook = abrirWorkbook(opciones.buffer);

  // Dos formatos alimentan la misma lista: el de FABRICA (una hoja por sucursal,
  // vendedor por código) y el INTERNO de la concesionaria (una sola hoja,
  // vendedor por nombre). El interno se traduce a la misma estructura y de ahí en
  // adelante el guardado es uno solo.
  if (esArchivoInternoVW(workbook)) {
    const { mapa } = await resolverVendedores(
      nombresDeVendedorDelLibro(workbook),
      opciones.mapeoVendedores ?? {}
    );
    const archivoInterno = convertirInternoAArchivo(workbook, mapa);
    if ("error" in archivoInterno) return { error: archivoInterno.error };
    if (archivoInterno.filas.length === 0) {
      const motivos = [...new Set(archivoInterno.rechazadas.map((r) => r.motivo))].slice(0, 3);
      return {
        error:
          "No se pudo importar ninguna fila. " +
          (motivos.length ? motivos.join(" ") : archivoInterno.avisos.join(" ")),
      };
    }
    if (opciones.mapeoVendedores && Object.keys(opciones.mapeoVendedores).length > 0) {
      await guardarMapeoVendedores(opciones.mapeoVendedores, opciones.usuarioId ?? null);
    }
    return guardar(archivoInterno, opciones, "INTERNO");
  }

  const archivo = parsearArchivoEncuestaVW(workbook);
  if ("error" in archivo) return { error: archivo.error };
  if (archivo.filas.length === 0) {
    return { error: "El archivo no tiene ninguna fila que se pueda importar. " + archivo.avisos.join(" ") };
  }

  return guardar(archivo, opciones, "FABRICA");
}

async function guardar(
  archivo: ArchivoEncuestaVW,
  opciones: OpcionesImportacionVW,
  origenFormato: "FABRICA" | "INTERNO"
): Promise<ResumenImportacionVW> {
  const nombresSucursal = [...new Set(archivo.hojas.map((h) => h.nombreSucursal))];

  // El período sale de la entrega más reciente: es lo que da el "de cuándo" es
  // esta foto. Si ninguna fila trae fecha, se usa el mes en curso.
  const fechas = archivo.filas.map((f) => f.fechaEntrega).filter((f): f is Date => !!f);
  const referencia = fechas.length ? new Date(Math.max(...fechas.map((f) => f.getTime()))) : new Date();
  const periodo = `${referencia.getFullYear()}-${String(referencia.getMonth() + 1).padStart(2, "0")}`;

  const upload = await prisma.excelUpload.create({
    data: {
      tipo: TipoUpload.ENCUESTA_FABRICA_VW,
      filename: opciones.filename,
      sucursal: nombresSucursal.join(" / ") || "—",
      periodo,
      uploadedBy: opciones.uploadedBy,
      columnMapping: {},
      totalRows: archivo.filas.length,
      status: UploadStatus.PROCESANDO,
    },
  });

  // ---- 1. Vendedores -------------------------------------------------------
  // Se crean los que falten y se completa el nombre si el archivo lo trae. NO se
  // pisa el mail ni un nombre cargado a mano: el Excel de fábrica no los tiene y
  // sobreescribirlos borraría el trabajo de Calidad en cada carga.
  const porCodigo = new Map<string, { sucursal: string; nombre: string | null }>();
  for (const f of archivo.filas) {
    const previo = porCodigo.get(f.codigoVendedor);
    porCodigo.set(f.codigoVendedor, {
      // Sucursal del CLIENTE = donde se hizo la venta, no de dónde es el vendedor.
      // En el archivo de fábrica eso lo dice la hoja; en el interno, la columna
      // Suc. Cpa. El código del vendedor queda como último recurso.
      sucursal:
        archivo.hojas.find((h) => h.nombre === f.hoja)?.nombreSucursal ??
        f.sucursalVenta ??
        f.codigoSucursal,
      nombre: f.nombreVendedor ?? previo?.nombre ?? null,
    });
  }

  // El 002 de cada sucursal es el MOSTRADOR (vende todos los planes de ahorro),
  // no una persona: el 1035002 y el 1036002 son dos mostradores distintos y no
  // hay que confundirlos. Cualquier otro número sí identifica a la persona.
  const NUMEROS_DE_MOSTRADOR = new Set([2]);

  let vendedoresNuevos = 0;
  let vendedoresActualizados = 0;
  const vendedoresDeOtraSucursal: ResumenImportacionVW["vendedoresDeOtraSucursal"] = [];
  const idPorCodigo = new Map<string, string>();

  for (const [codigo, datos] of porCodigo) {
    const existente = await prisma.vendedorVW.findUnique({ where: { codigo } });
    if (!existente) {
      // Un vendedor puede vender en la OTRA sucursal: entonces viene con el
      // prefijo de esa sucursal y el mismo número (el 078 de Mendoza vendiendo en
      // San Juan llega como 1036078). Es la misma persona.
      //
      // Sin esto el sistema daba de alta un vendedor nuevo, vacío: sin nombre y
      // SIN CORREO. Consecuencia concreta: a los clientes que esa persona vendió
      // en la otra sucursal no les avisaba nadie, porque el aviso sale por mail y
      // ese código no tenía ninguno. Ahora hereda nombre y correo del que ya está.
      const numero = Number(codigo.slice(4));
      const codigoSucursal = codigo.slice(0, 4);
      const gemelo = NUMEROS_DE_MOSTRADOR.has(numero)
        ? null
        : await prisma.vendedorVW.findFirst({
            where: { numero, codigoSucursal: { not: codigoSucursal } },
            orderBy: { creadoEn: "asc" },
          });

      const creado = await prisma.vendedorVW.create({
        data: {
          codigo,
          codigoSucursal,
          numero,
          sucursal: datos.sucursal,
          nombre: datos.nombre ?? gemelo?.nombre ?? null,
          email: gemelo?.email ?? null,
        },
      });
      if (gemelo) {
        vendedoresDeOtraSucursal.push({
          codigo,
          nombre: creado.nombre,
          vieneDe: gemelo.codigo,
        });
      }
      idPorCodigo.set(codigo, creado.id);
      vendedoresNuevos++;
      continue;
    }
    idPorCodigo.set(codigo, existente.id);
    // Solo se completa lo que falta; nunca se pisa lo que ya había.
    if (!existente.nombre && datos.nombre) {
      await prisma.vendedorVW.update({ where: { id: existente.id }, data: { nombre: datos.nombre } });
      vendedoresActualizados++;
    }
  }

  // ---- 2. Pendientes -------------------------------------------------------
  let pendientesNuevos = 0;
  let pendientesQueSiguen = 0;

  for (const f of archivo.filas) {
    const vendedorId = idPorCodigo.get(f.codigoVendedor)!;
    const datos = {
      dominio: f.dominio,
      nombreCliente: f.nombreCliente,
      email: f.email,
      fechaEntrega: f.fechaEntrega,
      canalVentas: f.canalVentas,
      area: f.area,
      vendedorId,
      sucursal: archivo.hojas.find((h) => h.nombre === f.hoja)?.nombreSucursal ?? f.codigoSucursal,
      observacionesFabrica: f.observacionesFabrica,
      vistaEnUploadId: upload.id,
    };
    const existente = await prisma.encuestaFabricaVW.findUnique({ where: { chasis: f.chasis } });
    if (existente) {
      // Se refrescan los DATOS (el correo corregido, el vendedor reasignado, lo
      // que observó fábrica) pero NO el estado ni sus fechas.
      //
      // Antes esta línea también lo volvía a PENDIENTE, y eso hacía dos daños: un
      // cliente ya avisado que seguía en el archivo volvía a Pendiente —y al
      // vendedor le llegaba otra vez en el próximo aviso—, y lo que Calidad había
      // cambiado a mano se perdía con la carga siguiente.
      await prisma.encuestaFabricaVW.update({ where: { chasis: f.chasis }, data: datos });
      pendientesQueSiguen++;
    } else {
      // Un cliente NUEVO entra siempre como Pendiente. Esto no es "cambiar un
      // estado": es el que tiene al nacer.
      await prisma.encuestaFabricaVW.create({
        data: {
          ...datos,
          estado: EstadoEncuestaFabrica.PENDIENTE,
          chasis: f.chasis,
          origenUploadId: upload.id,
          origenFormato,
        },
      });
      pendientesNuevos++;
    }
  }

  // Acá había un tercer paso que daba por respondidos a los que ya no venían en
  // el archivo. Se sacó a propósito: ver el comentario del principio.

  await prisma.excelUpload.update({ where: { id: upload.id }, data: { status: UploadStatus.COMPLETADO } });

  // ---- 3. Qué falta para poder avisar --------------------------------------
  const sinMail = await prisma.vendedorVW.findMany({
    where: { codigo: { in: [...porCodigo.keys()] }, OR: [{ email: null }, { email: "" }] },
    select: { codigo: true, nombre: true, sucursal: true, _count: { select: { pendientes: true } } },
  });

  opciones.auditar?.({
    accion: ACCIONES.EXCEL_ENCUESTA_VW_IMPORTADO,
    entidad: "ExcelUpload",
    entidadId: upload.id,
    detalles: {
      tipo: "ENCUESTA_FABRICA_VW",
      sucursales: nombresSucursal,
      filas: archivo.filas.length,
      pendientesNuevos,
      pendientesQueSiguen,
    },
  });

  return {
    uploadId: upload.id,
    sucursales: nombresSucursal,
    vendedoresNuevos,
    vendedoresActualizados,
    vendedoresSinMail: sinMail.map((v) => ({
      codigo: v.codigo,
      nombre: v.nombre,
      sucursal: v.sucursal,
      pendientes: v._count.pendientes,
    })),
    pendientesNuevos,
    pendientesQueSiguen,
    vendedoresDeOtraSucursal,
    filasRechazadas: archivo.rechazadas,
    filasObservadasPorFabrica: archivo.filas.filter((f) => f.observacionesFabrica.length > 0).length,
    avisos: archivo.avisos,
  };
}
