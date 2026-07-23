import * as XLSX from "xlsx";
import { AreaTrabajo, EncuestaFordEstado, TipoTareaRefuerzo } from "@prisma/client";
import { normalizarTexto, parsearFecha } from "./excel.service";

// ---------- Campos canónicos del export de Ford ----------
// El archivo real trae 21 columnas; acá mapeamos las que usamos para cruzar,
// clasificar y mostrar. El resto es informativo.

export const CAMPOS_FORD = [
  "idEncuesta",
  "nombreCliente", // "APELLIDO, NOMBRE"
  "vin",
  "email",
  "telefono", // formato local "261 6533700"
  "estadoInvitacion", // "Invited" | "Completed" | "Not sampled due to..." | "Delivery bounced (...)"
  "fechaRespuesta",
  "ordenReparacion",
  "fechaSalidaTaller",
  "asesorServicio",
  "tipoEncuesta", // "Servicio" | (ventas, cuando Ford exporte encuestas de venta)
  "vendedor", // señal secundaria de área: si viene completa, es de VENTAS
  "descartar",
] as const;

export type CampoFord = (typeof CAMPOS_FORD)[number];

// Alias precargados para los encabezados EXACTOS del export (con trim, algunos
// traen espacio al final como "Vendedor ").
const ALIAS_FORD: Array<{ patrones: string[]; campo: CampoFord }> = [
  { patrones: ["id encuesta"], campo: "idEncuesta" },
  { patrones: ["nombre cliente"], campo: "nombreCliente" },
  { patrones: ["vin"], campo: "vin" },
  { patrones: ["correo electronico", "correo", "email", "e-mail"], campo: "email" },
  { patrones: ["numero de telefono principal", "telefono principal", "telefono"], campo: "telefono" },
  // la PRIMera columna de estado ("Estado de la invitación") es la de muestreo/envío
  { patrones: ["estado de la invitacion"], campo: "estadoInvitacion" },
  { patrones: ["fecha respuesta"], campo: "fechaRespuesta" },
  { patrones: ["orden reparacion", "orden de reparacion"], campo: "ordenReparacion" },
  { patrones: ["fecha salida taller", "fecha de salida taller"], campo: "fechaSalidaTaller" },
  { patrones: ["asesor de servicio", "asesor servicio"], campo: "asesorServicio" },
  { patrones: ["tipo de encuesta"], campo: "tipoEncuesta" },
  { patrones: ["vendedor"], campo: "vendedor" },
];

// ---------- Detección de la fila de encabezados ----------
// Fila 1 = título ("Survey Export"), fila 2 vacía, fila 3 = encabezados reales.
// No se asume fila fija: se busca la que tenga "ID encuesta" y "Estado de la
// invitación" en las primeras 10 filas.

const MAX_FILAS_BUSQUEDA = 10;

export function detectarFilaEncabezadoFord(filas: unknown[][]): number {
  const limite = Math.min(filas.length, MAX_FILAS_BUSQUEDA);
  for (let i = 0; i < limite; i++) {
    const celdas = (filas[i] ?? []).map(normalizarTexto);
    const tieneId = celdas.some((c) => c === "id encuesta");
    const tieneEstado = celdas.some((c) => c === "estado de la invitacion");
    if (tieneId && tieneEstado) return i;
  }
  return -1;
}

export function sugerirMapeoFord(columnas: string[]): Record<string, CampoFord> {
  const mapeo: Record<string, CampoFord> = {};
  const usados = new Set<CampoFord>();
  for (const columna of columnas) {
    const norm = normalizarTexto(columna);
    for (const { patrones, campo } of ALIAS_FORD) {
      if (usados.has(campo)) continue;
      // "vin" y "email" son cortos → match exacto; el resto por inclusión
      const coincide = patrones.some((p) => (p.length <= 5 ? norm === p : norm.includes(p)));
      if (coincide) {
        mapeo[columna] = campo;
        usados.add(campo);
        break;
      }
    }
  }
  return mapeo;
}

// ---------- Parseo de la hoja ----------

export interface FilaFord {
  numeroFilaExcel: number;
  datos: Record<string, unknown>; // por nombre de columna original
}

export interface HojaFordParseada {
  nombre: string;
  filaEncabezado: number;
  columnas: string[];
  mappingSugerido: Record<string, CampoFord>;
  filas: FilaFord[];
}

export function parsearHojaFord(
  workbook: XLSX.WorkBook,
  nombreHoja: string
): HojaFordParseada | { error: string } {
  const hoja = workbook.Sheets[nombreHoja];
  if (!hoja) return { error: `La hoja "${nombreHoja}" no existe.` };

  const filasCrudas: unknown[][] = XLSX.utils.sheet_to_json(hoja, {
    header: 1,
    defval: null,
    blankrows: true,
  });

  const filaEncabezado = detectarFilaEncabezadoFord(filasCrudas);
  if (filaEncabezado === -1) {
    return {
      error:
        "No se encontró la fila de encabezados del export de Ford " +
        '(se buscan las columnas "ID encuesta" y "Estado de la invitación" en las primeras 10 filas). ' +
        "Verificá que sea el archivo de invitaciones exportado de la plataforma de Ford.",
    };
  }

  // Nombres de columna (trim; los del export traen espacios al final, ej "Vendedor ")
  const encabezados = filasCrudas[filaEncabezado] ?? [];
  const columnas: string[] = [];
  const indicePorColumna: Array<{ nombre: string; indice: number }> = [];
  for (let i = 0; i < encabezados.length; i++) {
    const crudo = String(encabezados[i] ?? "").trim();
    if (!crudo) continue;
    let nombre = crudo;
    let sufijo = 2;
    while (columnas.includes(nombre)) nombre = `${crudo} (${sufijo++})`;
    columnas.push(nombre);
    indicePorColumna.push({ nombre, indice: i });
  }

  const filas: FilaFord[] = [];
  for (let i = filaEncabezado + 1; i < filasCrudas.length; i++) {
    const cruda = filasCrudas[i] ?? [];
    const datos: Record<string, unknown> = {};
    let tieneDatos = false;
    for (const { nombre, indice } of indicePorColumna) {
      const valor = cruda[indice] ?? null;
      datos[nombre] = valor;
      if (valor !== null && String(valor).trim() !== "") tieneDatos = true;
    }
    if (tieneDatos) filas.push({ numeroFilaExcel: i + 1, datos });
  }

  return {
    nombre: nombreHoja,
    filaEncabezado,
    columnas,
    mappingSugerido: sugerirMapeoFord(columnas),
    filas,
  };
}

// ---------- Clasificación del estado de la invitación ----------

export interface ClasificacionEstado {
  categoria: EncuestaFordEstado | null; // null = no reconocido (revisión manual)
  creaTarea: boolean;
  tipoTarea: TipoTareaRefuerzo | null;
  revisionManual: boolean;
}

export function clasificarEstadoFord(estadoCrudo: unknown): ClasificacionEstado {
  const e = String(estadoCrudo ?? "").trim();
  const norm = normalizarTexto(e);

  if (norm === "completed") {
    return { categoria: EncuestaFordEstado.RESPONDIDA, creaTarea: false, tipoTarea: null, revisionManual: false };
  }
  if (norm === "invited" || norm === "reminded") {
    return {
      categoria: EncuestaFordEstado.PENDIENTE_RESPUESTA,
      creaTarea: true,
      tipoTarea: TipoTareaRefuerzo.RECORDAR_ENCUESTA,
      revisionManual: false,
    };
  }
  if (norm.startsWith("not sampled due to opt out")) {
    return { categoria: EncuestaFordEstado.NO_ELEGIBLE, creaTarea: false, tipoTarea: null, revisionManual: false };
  }
  if (norm.includes("quarantine")) {
    return { categoria: EncuestaFordEstado.NO_ELEGIBLE, creaTarea: false, tipoTarea: null, revisionManual: false };
  }
  if (norm.startsWith("delivery bounced")) {
    return {
      categoria: EncuestaFordEstado.EMAIL_INVALIDO,
      creaTarea: true,
      tipoTarea: TipoTareaRefuerzo.VERIFICAR_EMAIL,
      revisionManual: false,
    };
  }
  // Cualquier valor no reconocido: no crear tarea, listar para decisión humana
  return { categoria: null, creaTarea: false, tipoTarea: null, revisionManual: true };
}

// ---------- Clasificación del ÁREA de la fila (VENTAS / POSVENTA) ----------
// Mapeo confirmado sobre el export real (210/210 filas "Servicio", todas con
// "Asesor de servicio" completo y ninguna con "Vendedor"):
//   "Servicio"                  -> POSVENTA
//   "ventas" / "venta" / "sales"-> VENTAS
// Si el tipo no se reconoce, se usa la señal secundaria: qué columna viene
// completa (Vendedor = ventas, Asesor de servicio = posventa). Si tampoco
// resuelve, devuelve null y la fila va a revisión manual (nunca se adivina).

const TIPOS_POSVENTA = ["servicio"];
const TIPOS_VENTAS = ["ventas", "venta", "sales"];

export interface ClasificacionArea {
  area: AreaTrabajo | null;
  motivo: string;
}

export function clasificarAreaFord(campos: {
  tipoEncuesta?: string;
  vendedor?: string;
  asesorServicio?: string;
}): ClasificacionArea {
  const tipo = normalizarTexto(campos.tipoEncuesta);
  if (tipo && TIPOS_POSVENTA.includes(tipo)) {
    return { area: AreaTrabajo.POSVENTA, motivo: `tipo de encuesta "${campos.tipoEncuesta}"` };
  }
  if (tipo && TIPOS_VENTAS.includes(tipo)) {
    return { area: AreaTrabajo.VENTAS, motivo: `tipo de encuesta "${campos.tipoEncuesta}"` };
  }

  // Señal secundaria: qué columna de responsable viene completa
  const tieneVendedor = !!campos.vendedor?.trim();
  const tieneAsesor = !!campos.asesorServicio?.trim();
  if (tieneVendedor && !tieneAsesor) return { area: AreaTrabajo.VENTAS, motivo: "columna Vendedor completa" };
  if (tieneAsesor && !tieneVendedor) return { area: AreaTrabajo.POSVENTA, motivo: "columna Asesor de servicio completa" };

  return {
    area: null,
    motivo: tipo
      ? `tipo de encuesta no reconocido ("${campos.tipoEncuesta}") y sin señal clara de Vendedor/Asesor`
      : "sin tipo de encuesta ni columna de Vendedor/Asesor completa",
  };
}

export function parsearFechaFord(valor: unknown): Date | null {
  // El export trae fechas tipo "7/20/26 11:02" (M/D/YY) → interpretamos mes primero
  if (valor === null || valor === undefined || valor === "") return null;
  if (valor instanceof Date && !isNaN(valor.getTime())) return valor;
  const texto = String(valor).trim();
  const m = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const [, mes, dia, a] = m;
    const anio = a.length === 2 ? 2000 + Number(a) : Number(a);
    const fecha = new Date(anio, Number(mes) - 1, Number(dia));
    return isNaN(fecha.getTime()) ? null : fecha;
  }
  return parsearFecha(valor);
}
