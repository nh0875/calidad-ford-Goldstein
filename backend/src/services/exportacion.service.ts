import ExcelJS from "exceljs";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { Prisma } from "@prisma/client";
import { reporteCausaRaiz, reporteSentimiento, FiltrosCausaRaiz, FiltrosReporte } from "./reporte.service";

function fechaCorta(fecha: Date | null | undefined): string {
  if (!fecha) return "-";
  const d = String(fecha.getDate()).padStart(2, "0");
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  return `${d}/${m}/${fecha.getFullYear()}`;
}

function hojaConEncabezado(wb: ExcelJS.Workbook, nombre: string, columnas: Array<{ header: string; key: string; width?: number }>) {
  const hoja = wb.addWorksheet(nombre);
  hoja.columns = columnas.map((c) => ({ ...c, width: c.width ?? 18 }));
  hoja.getRow(1).font = { bold: true };
  hoja.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EDF5" } };
  return hoja;
}

// ---------- Excel: reporte de sentimiento ----------

export async function excelReporteSentimiento(f: FiltrosReporte): Promise<Buffer> {
  const r = await reporteSentimiento(f);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Sistema de Calidad Ford";

  const resumen = hojaConEncabezado(wb, "Resumen", [
    { header: "Indicador", key: "k", width: 40 },
    { header: "Valor", key: "v", width: 16 },
  ]);
  resumen.addRows([
    { k: "Verdes", v: `${r.totales.VERDE} (${r.porcentajes.VERDE}%)` },
    { k: "Amarillos", v: `${r.totales.AMARILLO} (${r.porcentajes.AMARILLO}%)` },
    { k: "Rojos", v: `${r.totales.ROJO} (${r.porcentajes.ROJO}%)` },
    { k: "Sin clasificar", v: r.totales.sinClasificar },
    { k: "Pendientes de revisión manual", v: r.totales.revisionManual },
    { k: "Casos contactados", v: r.tasaRespuesta.contactados },
    { k: "Respondieron", v: `${r.tasaRespuesta.respondidos} (${r.tasaRespuesta.pctRespondidos}%)` },
    { k: "No respondieron", v: `${r.tasaRespuesta.noRespondieron} (${r.tasaRespuesta.pctNoRespondieron}%)` },
    { k: "Enviados sin respuesta aún", v: r.tasaRespuesta.enviadosSinRespuestaAun },
    { k: "Con error de envío", v: r.tasaRespuesta.conErrorDeEnvio },
    { k: "Internos (excluidos)", v: r.tasaRespuesta.internosExcluidos },
    { k: "Pendientes sin contactar", v: r.tasaRespuesta.pendientesSinContactar },
  ]);

  const evolucion = hojaConEncabezado(wb, "Evolución", [
    { header: r.evolucion.agrupacion === "semana" ? "Semana (lunes)" : "Día", key: "fecha" },
    { header: "Verdes", key: "VERDE", width: 12 },
    { header: "Amarillos", key: "AMARILLO", width: 12 },
    { header: "Rojos", key: "ROJO", width: 12 },
  ]);
  evolucion.addRows(r.evolucion.puntos);

  for (const [nombre, filas] of [
    ["Por Sucursal", r.porSucursal],
    ["Por Asesor", r.porAsesor],
  ] as const) {
    const hoja = hojaConEncabezado(wb, nombre, [
      { header: nombre === "Por Sucursal" ? "Sucursal" : "Asesor", key: "nombre", width: 28 },
      { header: "Verdes", key: "VERDE", width: 12 },
      { header: "Amarillos", key: "AMARILLO", width: 12 },
      { header: "Rojos", key: "ROJO", width: 12 },
      { header: "Total", key: "total", width: 12 },
      { header: "% Rojos", key: "pctRojos", width: 12 },
    ]);
    hoja.addRows(filas);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------- Excel: reporte de causa raíz ----------

export async function excelReporteCausaRaiz(f: FiltrosCausaRaiz): Promise<Buffer> {
  const r = await reporteCausaRaiz(f);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Sistema de Calidad Ford";

  const categorias = hojaConEncabezado(wb, "Por Categoría", [
    { header: "Categoría", key: "categoria", width: 28 },
    { header: "Total", key: "total", width: 12 },
    { header: "Con RQR", key: "conRqr", width: 12 },
    { header: "Amarillos sin RQR", key: "sinRqr", width: 18 },
  ]);
  categorias.addRows(r.porCategoria);

  const detalle = hojaConEncabezado(wb, "Detalle", [
    { header: "Fecha", key: "fecha", width: 12 },
    { header: "Orden", key: "orden", width: 12 },
    { header: "Cliente", key: "cliente", width: 26 },
    { header: "Teléfono", key: "telefono", width: 18 },
    { header: "Modelo", key: "modelo", width: 14 },
    { header: "Sucursal", key: "sucursal", width: 14 },
    { header: "Asesor", key: "asesor", width: 16 },
    { header: "Fecha servicio", key: "fechaServicio", width: 14 },
    { header: "Semáforo", key: "semaforo", width: 12 },
    { header: "Categoría", key: "categoria", width: 22 },
    { header: "RQR", key: "rqr", width: 16 },
    { header: "Estado RQR", key: "estadoRqr", width: 16 },
    { header: "Resumen IA", key: "resumen", width: 50 },
    { header: "Respuesta del cliente", key: "texto", width: 60 },
  ]);
  detalle.addRows(
    r.detalle.map((d) => ({
      fecha: fechaCorta(d.fecha),
      orden: d.caso.numeroOrden,
      cliente: d.caso.nombrePropietario,
      telefono: d.caso.whatsapp || d.caso.celular || "-",
      modelo: d.caso.modelo,
      sucursal: d.caso.sucursal,
      asesor: d.caso.asesor,
      fechaServicio: fechaCorta(d.caso.fechaSalida),
      semaforo: d.semaforo ?? "-",
      categoria: d.categoria,
      rqr: d.rqr?.numeroRQR ?? "-",
      estadoRqr: d.rqr?.estado ?? "-",
      resumen: d.resumenIA ?? "-",
      texto: d.textoCliente ?? "-",
    }))
  );

  const cierres = hojaConEncabezado(wb, "Tiempos de cierre", [
    { header: "Categoría", key: "categoria", width: 28 },
    { header: "RQR cerrados", key: "cantidad", width: 14 },
    { header: "Promedio de días", key: "promedioDias", width: 18 },
  ]);
  cierres.addRows(r.tiempoCierre.porCategoria);
  cierres.addRow({});
  cierres.addRow({
    categoria: "GENERAL",
    cantidad: r.tiempoCierre.rqrCerrados,
    promedioDias: r.tiempoCierre.promedioDias ?? "-",
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------- Word: RQR individual (formato del formulario en papel) ----------

type RqrCompleto = Prisma.RQRGetPayload<{
  include: {
    caso: true;
    sentimentAnalysis: { include: { message: { select: { content: true } } } };
  };
}>;

function tituloSeccion(texto: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 120 },
    children: [new TextRun({ text: texto, bold: true, color: "003478" })],
  });
}

function parrafo(texto: string): Paragraph {
  return new Paragraph({ spacing: { after: 80 }, children: [new TextRun(texto)] });
}

function filaDato(etiqueta: string, valor: string): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        width: { size: 35, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [new TextRun({ text: etiqueta, bold: true })] })],
      }),
      new TableCell({
        width: { size: 65, type: WidthType.PERCENTAGE },
        children: [new Paragraph(valor)],
      }),
    ],
  });
}

export async function wordRqr(rqr: RqrCompleto): Promise<Buffer> {
  // Los RQR manuales pueden no tener Caso vinculado: se usan los datos manuales
  const caso = rqr.caso;
  const cliente = caso?.nombrePropietario ?? rqr.nombreClienteManual ?? "(sin datos)";
  const telefono = caso?.whatsapp || caso?.celular || rqr.telefonoManual || "-";
  const vehiculo = caso
    ? `${caso.modelo} — Patente ${caso.patente}${caso.chasisVIN ? ` — VIN ${caso.chasisVIN}` : ""}`
    : (rqr.modeloManual ?? "-");
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: `Formulario RQR — ${rqr.numeroRQR}`, bold: true, color: "003478" }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 300 },
            children: [
              new TextRun({
                text: `Canal: ${rqr.canal}  |  Área de origen: ${rqr.areaOrigen}  |  Estado: ${rqr.estado}  |  Apertura: ${fechaCorta(rqr.fechaApertura)}`,
                size: 20,
              }),
            ],
          }),

          tituloSeccion("1. Datos del cliente"),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              filaDato("Cliente", cliente),
              filaDato("Teléfono", telefono),
              filaDato("Vehículo", vehiculo),
              filaDato("N° de orden", caso?.numeroOrden ?? "- (reclamo sin caso en el sistema)"),
              filaDato("Sucursal", caso?.sucursal ?? "-"),
              filaDato("Asesor de servicio", rqr.asesor),
              filaDato("Fecha del servicio", fechaCorta(caso?.fechaSalida ?? caso?.fechaProgramacion)),
            ],
          }),

          tituloSeccion("2. Descripción del reclamo"),
          parrafo(rqr.descripcionReclamo),
          ...(rqr.causaRaiz ? [parrafo(`Causa raíz: ${rqr.causaRaiz}`)] : []),
          ...(rqr.sentimentAnalysis?.message?.content
            ? [parrafo(`Respuesta original del cliente: "${rqr.sentimentAnalysis.message.content}"`)]
            : []),

          tituloSeccion("3. Tratamiento / Bitácora"),
          parrafo(rqr.tratamientoBitacora || "(pendiente de completar)"),
          ...(rqr.tratamientoDadoPor ? [parrafo(`Tratamiento dado por: ${rqr.tratamientoDadoPor}`)] : []),

          tituloSeccion("4. Solución propuesta"),
          parrafo(rqr.solucionPropuesta || "(pendiente de completar)"),

          tituloSeccion("5. Verificación de eficacia de la acción"),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              filaDato("Observaciones", rqr.observaciones || "(pendiente)"),
              filaDato("Responsable del cierre", rqr.responsableCierre || "(pendiente)"),
              filaDato("Fecha de cierre", fechaCorta(rqr.fechaCierre)),
            ],
          }),
        ],
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
