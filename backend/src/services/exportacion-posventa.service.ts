// Exportación del reporte de desempeño de Posventa: Excel y Word.
//
// Los dos salen del MISMO cálculo (reporteDesempenoPosventa), a propósito: si
// cada uno hiciera sus propias cuentas, el día que difieran nadie va a saber
// cuál creer, y un informe que se imprime y se presenta no puede decir algo
// distinto de lo que muestra la pantalla.
//
//   Excel -> para seguir trabajando los números.
//   Word  -> para presentar o imprimir.
import ExcelJS from "exceljs";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { marca } from "../config/marca";
import { DEFINICION_ITEMS } from "../config/posventa-vw";
import { FiltrosPosventa, ReporteDesempenoPosventa, reporteDesempenoPosventa } from "./reporte-posventa.service";
import { leerLogoMarca } from "./exportacion.service";

const COMENTARIOS_EN_EL_WORD = 15;

function textoPeriodo(f: FiltrosPosventa): string {
  const partes: string[] = [];
  if (f.fechaDesde || f.fechaHasta) {
    partes.push(`${f.fechaDesde || "inicio"} a ${f.fechaHasta || "hoy"}`);
  }
  if (f.sucursal) partes.push(f.sucursal);
  if (f.asesor) partes.push(`asesor ${f.asesor}`);
  return partes.length ? partes.join(" · ") : "Todo el período";
}

function num(v: number | null): string | number {
  return v === null ? "—" : v;
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

export async function excelDesempenoPosventa(f: FiltrosPosventa): Promise<Buffer> {
  const r = await reporteDesempenoPosventa(f);
  const libro = new ExcelJS.Workbook();
  libro.creator = `Sistema de Calidad ${marca.nombre}`;
  libro.created = new Date();

  const encabezar = (hoja: ExcelJS.Worksheet, fila: number) => {
    const f0 = hoja.getRow(fila);
    f0.font = { bold: true };
    f0.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
  };

  // --- Resumen ---
  const resumen = libro.addWorksheet("Resumen");
  resumen.addRow([`Desempeño de Posventa — ${marca.nombre}`]);
  resumen.getRow(1).font = { bold: true, size: 14 };
  resumen.addRow([textoPeriodo(f)]);
  resumen.addRow([`${r.clientesQueContestaron} cliente(s) contestaron la encuesta`]);
  resumen.addRow([]);
  resumen.addRow(["Ítem", "Promedio", "Respuestas", "% de 5", "% de 1 o 2", "1", "2", "3", "4", "5"]);
  encabezar(resumen, 5);
  for (const i of r.items) {
    resumen.addRow([
      i.etiqueta,
      num(i.promedio),
      i.respuestas,
      num(i.porcentajeCinco),
      num(i.porcentajeMalos),
      i.distribucion["1"],
      i.distribucion["2"],
      i.distribucion["3"],
      i.distribucion["4"],
      i.distribucion["5"],
    ]);
  }
  resumen.columns.forEach((c, idx) => (c.width = idx === 0 ? 28 : 12));

  // --- Por asesor y por sucursal ---
  for (const [titulo, datos] of [
    ["Por asesor", r.porAsesor],
    ["Por sucursal", r.porSucursal],
  ] as const) {
    const hoja = libro.addWorksheet(titulo);
    hoja.addRow([titulo === "Por asesor" ? "Asesor" : "Sucursal", "Clientes", "General", ...DEFINICION_ITEMS.map((d) => d.etiqueta)]);
    encabezar(hoja, 1);
    for (const g of datos) {
      hoja.addRow([g.nombre, g.respuestas, num(g.promedioGeneral), ...DEFINICION_ITEMS.map((d) => num(g.porItem[d.item]))]);
    }
    hoja.columns.forEach((c, idx) => (c.width = idx === 0 ? 26 : 14));
  }

  // --- Detalle caso por caso ---
  const detalle = libro.addWorksheet("Detalle");
  detalle.addRow(["Orden", "Cliente", "Sucursal", "Asesor", "Modelo", "Fecha", ...DEFINICION_ITEMS.map((d) => d.etiqueta)]);
  encabezar(detalle, 1);
  for (const d of r.detalle) {
    detalle.addRow([
      d.numeroOrden,
      d.cliente,
      d.sucursal,
      d.asesor,
      d.modelo,
      d.fecha,
      ...DEFINICION_ITEMS.map((x) => num(d.puntajes[x.item])),
    ]);
  }
  detalle.columns.forEach((c, idx) => (c.width = idx === 1 ? 30 : 16));

  // --- Comentarios ---
  const coment = libro.addWorksheet("Comentarios");
  coment.addRow(["Ítem", "Puntaje", "Comentario del cliente", "Cliente", "Sucursal", "Asesor", "Fecha"]);
  encabezar(coment, 1);
  for (const c of r.comentarios) {
    coment.addRow([c.etiqueta, num(c.estrellas), c.comentario, c.cliente, c.sucursal, c.asesor, c.fecha]);
  }
  coment.columns.forEach((c, idx) => (c.width = idx === 2 ? 60 : 18));

  return Buffer.from(await libro.xlsx.writeBuffer());
}

// ---------------------------------------------------------------------------
// Word
// ---------------------------------------------------------------------------

function celda(texto: string, opciones?: { negrita?: boolean; ancho?: number }): TableCell {
  return new TableCell({
    width: opciones?.ancho ? { size: opciones.ancho, type: WidthType.PERCENTAGE } : undefined,
    children: [new Paragraph({ children: [new TextRun({ text: texto, bold: opciones?.negrita })] })],
  });
}

export async function wordDesempenoPosventa(f: FiltrosPosventa): Promise<Buffer> {
  const r = await reporteDesempenoPosventa(f);
  const hijos: (Paragraph | Table)[] = [];

  // Logo (si está). Nunca hace fallar la descarga: un informe que Calidad
  // necesita presentar no puede romperse porque falte un archivo de imagen.
  const logo = leerLogoMarca();
  if (logo) {
    hijos.push(
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new ImageRun({
            data: logo.datos,
            transformation: { width: 128, height: 44 },
            type: logo.tipo === "jpg" ? "jpg" : "png",
          }),
        ],
      })
    );
  }

  hijos.push(
    new Paragraph({ text: "Desempeño de Posventa", heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ children: [new TextRun({ text: textoPeriodo(f), color: "666666" })] }),
    new Paragraph({
      children: [
        new TextRun({ text: `${r.clientesQueContestaron} cliente(s) contestaron la encuesta.`, size: 20 }),
      ],
    }),
    new Paragraph({ text: "" })
  );

  // Titular: el ítem más flojo. Es lo primero que quiere saber el área.
  if (r.itemMasFlojo) {
    hijos.push(
      new Paragraph({
        children: [
          new TextRun({ text: "Lo más flojo del período: ", bold: true }),
          new TextRun({ text: `${r.itemMasFlojo.etiqueta} (${r.itemMasFlojo.promedio} de 5)` }),
        ],
      }),
      new Paragraph({ text: "" })
    );
  }

  // --- Tabla por ítem ---
  hijos.push(new Paragraph({ text: "Puntaje por ítem", heading: HeadingLevel.HEADING_2 }));
  hijos.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            celda("Ítem", { negrita: true, ancho: 40 }),
            celda("Promedio", { negrita: true, ancho: 15 }),
            celda("Respuestas", { negrita: true, ancho: 15 }),
            celda("% de 5", { negrita: true, ancho: 15 }),
            celda("% de 1 o 2", { negrita: true, ancho: 15 }),
          ],
        }),
        ...r.items.map(
          (i) =>
            new TableRow({
              children: [
                celda(i.etiqueta),
                celda(i.promedio === null ? "—" : `${i.promedio} / 5`),
                celda(String(i.respuestas)),
                celda(i.porcentajeCinco === null ? "—" : `${i.porcentajeCinco}%`),
                celda(i.porcentajeMalos === null ? "—" : `${i.porcentajeMalos}%`),
              ],
            })
        ),
      ],
    })
  );
  hijos.push(new Paragraph({ text: "" }));

  // --- Por asesor ---
  if (r.porAsesor.length > 0) {
    hijos.push(new Paragraph({ text: "Por asesor", heading: HeadingLevel.HEADING_2 }));
    hijos.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              celda("Asesor", { negrita: true, ancho: 30 }),
              celda("Clientes", { negrita: true, ancho: 12 }),
              celda("General", { negrita: true, ancho: 12 }),
              ...DEFINICION_ITEMS.filter((d) => d.item !== "GENERAL").map((d) =>
                celda(d.etiqueta, { negrita: true, ancho: 11 })
              ),
            ],
          }),
          ...r.porAsesor.map(
            (g) =>
              new TableRow({
                children: [
                  celda(g.nombre),
                  celda(String(g.respuestas)),
                  celda(g.promedioGeneral === null ? "—" : String(g.promedioGeneral)),
                  ...DEFINICION_ITEMS.filter((d) => d.item !== "GENERAL").map((d) =>
                    celda(g.porItem[d.item] === null ? "—" : String(g.porItem[d.item]))
                  ),
                ],
              })
          ),
        ],
      })
    );
    hijos.push(new Paragraph({ text: "" }));
  }

  // --- Comentarios ---
  if (r.comentarios.length > 0) {
    hijos.push(
      new Paragraph({ text: "Lo que dijeron los clientes", heading: HeadingLevel.HEADING_2 }),
      new Paragraph({
        children: [
          new TextRun({
            text: "Ordenados del peor puntaje al mejor: son los que hay que leer primero.",
            color: "666666",
            size: 18,
          }),
        ],
      })
    );
    for (const c of r.comentarios.slice(0, COMENTARIOS_EN_EL_WORD)) {
      hijos.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${c.etiqueta} ${c.estrellas ?? "—"}/5 — `, bold: true }),
            new TextRun({ text: `“${c.comentario}”` }),
            new TextRun({ text: `  (${c.cliente}, ${c.sucursal}, ${c.fecha})`, color: "666666", size: 18 }),
          ],
        })
      );
    }
    if (r.comentarios.length > COMENTARIOS_EN_EL_WORD) {
      hijos.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `… y ${r.comentarios.length - COMENTARIOS_EN_EL_WORD} comentario(s) más. Están todos en la exportación a Excel.`,
              color: "666666",
              size: 18,
            }),
          ],
        })
      );
    }
  }

  const doc = new Document({ sections: [{ children: hijos }] });
  return Packer.toBuffer(doc);
}
