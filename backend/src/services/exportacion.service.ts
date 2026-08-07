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
import { prisma } from "../config/prisma";
import { reporteCausaRaiz, reporteSentimiento, FiltrosCausaRaiz, FiltrosReporte } from "./reporte.service";

// Enums -> texto que lee gerencia (no las MAYUSCULAS_CON_GUION del código)
const AREA_LABEL: Record<string, string> = { POSVENTA: "Posventa", VENTAS: "Ventas" };
const ESTADO_CONTACTO_LABEL: Record<string, string> = {
  PENDIENTE: "Pendiente",
  ENVIADO: "Enviado",
  RESPONDIDO: "Respondió",
  NO_RESPONDIO: "No respondió",
  INTERNO: "Interno (no cuenta)",
  ERROR: "Error de envío",
};
// El semáforo, dicho como lo pide gerencia: quién es promotor y quién detractor.
const CLASIFICACION_LABEL: Record<string, string> = {
  VERDE: "Promotor",
  AMARILLO: "Neutro",
  ROJO: "Detractor",
};
const ENCUESTA_FORD_LABEL: Record<string, string> = {
  SIN_DATO: "Sin dato",
  RESPONDIDA: "Respondida",
  PENDIENTE_RESPUESTA: "Pendiente de respuesta",
  NO_ELEGIBLE: "No elegible",
  EMAIL_INVALIDO: "Email inválido",
};

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

// ---------- Excel: listado completo de casos ----------
// Vuelca TODOS los casos que matcheen el filtro (sin paginar) con sus variables,
// para que administración/gerencia trabajen la lista afuera del sistema. El
// `where` lo arma el controller (incluye la restricción por área del usuario).

export async function excelCasos(where: Prisma.CasoWhereInput): Promise<Buffer> {
  const casos = await prisma.caso.findMany({
    where,
    orderBy: { fechaProgramacion: "desc" },
    include: {
      upload: { select: { periodo: true } },
      analisis: {
        // La clasificación que cuenta es la de la respuesta al contacto, no un
        // "gracias" posterior (esSeguimiento): mismo criterio que el listado.
        where: { esSeguimiento: false },
        orderBy: { analyzedAt: "desc" },
        take: 1,
        select: { semaforo: true, resumenIA: true },
      },
    },
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Sistema de Calidad Ford";

  const columnas = [
    { header: "Fecha visita", key: "fecha", width: 12 },
    { header: "Orden", key: "orden", width: 12 },
    { header: "Área", key: "area", width: 10 },
    { header: "Origen", key: "origen", width: 14 },
    { header: "Cliente", key: "cliente", width: 26 },
    { header: "WhatsApp", key: "whatsapp", width: 16 },
    { header: "Celular", key: "celular", width: 16 },
    { header: "Email", key: "email", width: 24 },
    { header: "Modelo", key: "modelo", width: 16 },
    { header: "Patente", key: "patente", width: 12 },
    { header: "Chasis (VIN)", key: "vin", width: 20 },
    { header: "Asesor", key: "asesor", width: 20 },
    { header: "Cód. asesor", key: "asesorCodigo", width: 12 },
    { header: "Sucursal", key: "sucursal", width: 14 },
    { header: "Período", key: "periodo", width: 10 },
    { header: "Fecha salida", key: "fechaSalida", width: 12 },
    { header: "Días en servicio", key: "diasEnServicio", width: 14 },
    { header: "Estado de contacto", key: "estado", width: 18 },
    { header: "Clasificación", key: "clasificacion", width: 14 },
    { header: "Resumen IA", key: "resumen", width: 55 },
    { header: "Encuesta Ford", key: "encuestaFord", width: 20 },
    { header: "Fecha encuesta Ford", key: "encuestaFordFecha", width: 16 },
    { header: "Pidió baja", key: "optOut", width: 10 },
    { header: "Último error de envío", key: "error", width: 30 },
    { header: "Comentario del asesor", key: "comentario", width: 40 },
    { header: "Cargado el", key: "createdAt", width: 12 },
  ];

  const hoja = hojaConEncabezado(wb, "Casos", columnas);
  hoja.addRows(
    casos.map((c) => {
      const semaforo = c.analisis[0]?.semaforo;
      return {
        fecha: fechaCorta(c.fechaProgramacion),
        orden: c.numeroOrden,
        area: AREA_LABEL[c.area] ?? c.area,
        origen: c.origenAgendamiento,
        cliente: c.nombrePropietario,
        whatsapp: c.whatsapp || "-",
        celular: c.celular || "-",
        email: c.emailPropietario ?? "-",
        modelo: c.modelo,
        patente: c.patente || "-",
        vin: c.chasisVIN ?? "-",
        asesor: c.asesor,
        asesorCodigo: c.asesorCodigo ?? "-",
        sucursal: c.sucursal,
        periodo: c.upload.periodo,
        fechaSalida: fechaCorta(c.fechaSalida),
        diasEnServicio: c.diasEnServicio ?? "-",
        estado: ESTADO_CONTACTO_LABEL[c.estadoContacto] ?? c.estadoContacto,
        clasificacion: semaforo ? (CLASIFICACION_LABEL[semaforo] ?? semaforo) : "-",
        resumen: c.analisis[0]?.resumenIA ?? "-",
        encuestaFord: ENCUESTA_FORD_LABEL[c.encuestaFordEstado] ?? c.encuestaFordEstado,
        encuestaFordFecha: fechaCorta(c.encuestaFordFecha),
        optOut: c.whatsappOptOut ? "Sí" : "",
        error: c.ultimoErrorEnvio ?? "",
        comentario: c.comentarioAsesor ?? "",
        createdAt: fechaCorta(c.createdAt),
      };
    })
  );

  // Encabezado fijo + autofiltro: gerencia ordena y filtra en el propio Excel.
  hoja.views = [{ state: "frozen", ySplit: 1 }];
  hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } };

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
