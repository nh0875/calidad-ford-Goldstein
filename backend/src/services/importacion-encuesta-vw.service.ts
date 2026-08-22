import { EstadoEncuestaFabrica, TipoUpload, UploadStatus } from "@prisma/client";
import { prisma } from "../config/prisma";
import { abrirWorkbook } from "./excel.service";
import { ACCIONES } from "./audit.service";
import { ArchivoEncuestaVW, parsearArchivoEncuestaVW } from "./encuesta-vw.service";

/**
 * Importa el Excel de encuestas pendientes de fábrica de Volkswagen.
 *
 * La regla de fondo: el archivo es una FOTO de quién debe la encuesta HOY. Si un
 * cliente estaba pendiente y el archivo nuevo no lo trae, es porque contestó.
 * Por eso la importación no solo agrega: también cierra.
 *
 * Cierra SOLO las sucursales que vienen en el archivo. Si algún día se sube una
 * sola hoja, los pendientes de la otra sucursal no se pueden dar por contestados
 * —el archivo no dice nada de ellos— y tienen que quedar como estaban.
 */

export interface ResumenImportacionVW {
  uploadId: string;
  sucursales: string[];
  vendedoresNuevos: number;
  vendedoresActualizados: number;
  vendedoresSinMail: Array<{ codigo: string; nombre: string | null; sucursal: string; pendientes: number }>;
  pendientesNuevos: number;
  pendientesQueSiguen: number;
  marcadosRespondio: number;
  filasRechazadas: Array<{ hoja: string; numeroFilaExcel: number; motivo: string }>;
  filasObservadasPorFabrica: number;
  avisos: string[];
}

export interface OpcionesImportacionVW {
  buffer: Buffer;
  filename: string;
  uploadedBy: string;
  auditar?: (d: { accion: string; entidad: string; entidadId?: string; detalles?: unknown }) => void;
}

export async function importarEncuestaFabricaVW(
  opciones: OpcionesImportacionVW
): Promise<ResumenImportacionVW | { error: string }> {
  const workbook = abrirWorkbook(opciones.buffer);
  const archivo = parsearArchivoEncuestaVW(workbook);
  if ("error" in archivo) return { error: archivo.error };
  if (archivo.filas.length === 0) {
    return { error: "El archivo no tiene ninguna fila que se pueda importar. " + archivo.avisos.join(" ") };
  }

  return guardar(archivo, opciones);
}

async function guardar(
  archivo: ArchivoEncuestaVW,
  opciones: OpcionesImportacionVW
): Promise<ResumenImportacionVW> {
  // Las sucursales que se van a cerrar salen de las HOJAS del archivo, no de las
  // filas. Con las filas, UNA sola fila mal cargada —un vendedor de otra
  // sucursal metido por error en la hoja equivocada— alcanzaba para que el
  // sistema diera por respondida a TODA esa otra sucursal, que ni siquiera vino
  // en el archivo. La hoja es lo que dice de qué sucursal habla la foto.
  const sucursales = archivo.hojas
    .map((h) => h.codigoSucursal)
    .filter((c): c is string => !!c);
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
      sucursal: archivo.hojas.find((h) => h.nombre === f.hoja)?.nombreSucursal ?? f.codigoSucursal,
      nombre: f.nombreVendedor ?? previo?.nombre ?? null,
    });
  }

  let vendedoresNuevos = 0;
  let vendedoresActualizados = 0;
  const idPorCodigo = new Map<string, string>();

  for (const [codigo, datos] of porCodigo) {
    const existente = await prisma.vendedorVW.findUnique({ where: { codigo } });
    if (!existente) {
      const creado = await prisma.vendedorVW.create({
        data: {
          codigo,
          codigoSucursal: codigo.slice(0, 4),
          numero: Number(codigo.slice(4)),
          sucursal: datos.sucursal,
          nombre: datos.nombre,
        },
      });
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
      estado: EstadoEncuestaFabrica.PENDIENTE,
      nombreCliente: f.nombreCliente,
      email: f.email,
      fechaEntrega: f.fechaEntrega,
      canalVentas: f.canalVentas,
      area: f.area,
      vendedorId,
      sucursal: archivo.hojas.find((h) => h.nombre === f.hoja)?.nombreSucursal ?? f.codigoSucursal,
      observacionesFabrica: f.observacionesFabrica,
      vistaEnUploadId: upload.id,
      // Si había vuelto a aparecer después de darla por respondida, se limpia la
      // fecha: fábrica la volvió a listar, así que sigue debiendo la encuesta.
      respondioEn: null,
    };
    const existente = await prisma.encuestaFabricaVW.findUnique({ where: { chasis: f.chasis } });
    if (existente) {
      await prisma.encuestaFabricaVW.update({ where: { chasis: f.chasis }, data: datos });
      pendientesQueSiguen++;
    } else {
      await prisma.encuestaFabricaVW.create({
        data: { ...datos, chasis: f.chasis, origenUploadId: upload.id },
      });
      pendientesNuevos++;
    }
  }

  // ---- 3. Los que ya no vienen: contestaron --------------------------------
  // Acotado a las sucursales del archivo, por lo dicho arriba.
  // Se excluyen TODOS los chasis que vinieron en el archivo, incluidos los que el
  // lector rechazó.
  //
  // Antes el corte era "no tiene el sello de esta carga", y ese sello solo lo
  // reciben las filas que pasaron las validaciones. Una fila con el mail mal
  // escrito, sin nombre o con el código de vendedor cortado ESTÁ en el archivo y
  // fábrica la sigue listando como pendiente, pero para el importador no existía:
  // se la daba por respondida, el cliente desaparecía de la lista de su vendedor,
  // nadie lo llamaba, y la tasa de respuesta subía por alguien que nunca contestó.
  const chasisDelArchivo = [
    ...archivo.filas.map((f) => f.chasis),
    ...archivo.rechazadas.map((r) => r.chasis),
  ].filter(Boolean);

  const { count: marcadosRespondio } = await prisma.encuestaFabricaVW.updateMany({
    where: {
      estado: EstadoEncuestaFabrica.PENDIENTE,
      vendedor: { codigoSucursal: { in: sucursales } },
      chasis: { notIn: chasisDelArchivo },
    },
    data: { estado: EstadoEncuestaFabrica.RESPONDIO, respondioEn: new Date() },
  });

  await prisma.excelUpload.update({ where: { id: upload.id }, data: { status: UploadStatus.COMPLETADO } });

  // ---- 4. Qué falta para poder avisar --------------------------------------
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
      marcadosRespondio,
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
    marcadosRespondio,
    filasRechazadas: archivo.rechazadas,
    filasObservadasPorFabrica: archivo.filas.filter((f) => f.observacionesFabrica.length > 0).length,
    avisos: archivo.avisos,
  };
}
