import * as XLSX from "xlsx";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

// ---------- Campos de Caso mapeables desde el Excel ----------

export const CAMPOS_CASO = [
  "numeroOrden",
  "fechaProgramacion",
  "hora",
  "origenAgendamiento",
  "asesor",
  "modelo",
  "patente",
  "chasisVIN",
  "nombrePropietario",
  "emailPropietario",
  "celular",
  "whatsapp",
  "comentarioAsesor",
  "fechaSalida",
  "diasEnServicio",
  "estado",
  "satisfaccionConcesionario",
  "satisfaccionServicio",
  "satisfaccionFord",
  "comentarioCliente",
  "descartar",
] as const;

export type CampoCaso = (typeof CAMPOS_CASO)[number];

// ---------- Almacenamiento temporal del archivo entre preview y confirmación ----------

const TEMP_DIR = path.join(os.tmpdir(), "calidad-uploads");

function asegurarTempDir() {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

export function guardarArchivoTemporal(buffer: Buffer, filenameOriginal: string): string {
  asegurarTempDir();
  limpiarArchivosViejos();
  const token = crypto.randomUUID();
  fs.writeFileSync(path.join(TEMP_DIR, `${token}.xlsx`), buffer);
  fs.writeFileSync(
    path.join(TEMP_DIR, `${token}.json`),
    JSON.stringify({ filename: filenameOriginal, guardadoEn: new Date().toISOString() })
  );
  return token;
}

export function leerArchivoTemporal(token: string): { buffer: Buffer; filename: string } | null {
  // El token es un UUID generado por nosotros; validarlo evita path traversal
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) return null;
  const rutaXlsx = path.join(TEMP_DIR, `${token}.xlsx`);
  const rutaMeta = path.join(TEMP_DIR, `${token}.json`);
  if (!fs.existsSync(rutaXlsx)) return null;
  const filename = fs.existsSync(rutaMeta)
    ? (JSON.parse(fs.readFileSync(rutaMeta, "utf-8")).filename as string)
    : "archivo.xlsx";
  return { buffer: fs.readFileSync(rutaXlsx), filename };
}

export function borrarArchivoTemporal(token: string) {
  for (const ext of [".xlsx", ".json"]) {
    const ruta = path.join(TEMP_DIR, `${token}${ext}`);
    if (fs.existsSync(ruta)) fs.unlinkSync(ruta);
  }
}

function limpiarArchivosViejos() {
  const UN_DIA_MS = 24 * 60 * 60 * 1000;
  try {
    for (const nombre of fs.readdirSync(TEMP_DIR)) {
      const ruta = path.join(TEMP_DIR, nombre);
      if (Date.now() - fs.statSync(ruta).mtimeMs > UN_DIA_MS) fs.unlinkSync(ruta);
    }
  } catch {
    // la limpieza es best-effort
  }
}

// ---------- Normalización de texto ----------

export function normalizarTexto(valor: unknown): string {
  return String(valor ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos
    .replace(/[¿?¡!():]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- Detección de la fila de encabezados ----------

// La tabla real no arranca en la fila 1: arriba hay filas de resumen/KPIs.
// Palabras que delatan una fila de títulos. La lista es a propósito GENÉRICA y no
// del export de una marca puntual: cada marca nombra sus columnas distinto y el
// operador igual mapea a mano en la pantalla siguiente. Lo único que se necesita
// acá es ENCONTRAR la fila de títulos; qué significa cada columna se decide después.
const KEYWORDS_ENCABEZADO = [
  // Del export de Ford (las que ya se venían usando)
  "fecha de programacion",
  "asesor",
  "modelo",
  "orden",
  "placa / patente",
  "patente",
  "nombre propietario",
  "celular",
  "whatsapp",
  // Genéricas: cualquier planilla de clientes de cualquier marca trae varias
  "cliente",
  "nombre",
  "apellido",
  "telefono",
  "email",
  "e-mail",
  "correo",
  "dominio",
  "chasis",
  "vin",
  "fecha",
  "vehiculo",
  "sucursal",
  "vendedor",
  "servicio",
  "documento",
  "dni",
  "cuit",
];

const MAX_FILAS_BUSQUEDA_ENCABEZADO = 10;

export function detectarFilaEncabezado(filas: unknown[][]): number {
  const limite = Math.min(filas.length, MAX_FILAS_BUSQUEDA_ENCABEZADO);
  for (let i = 0; i < limite; i++) {
    const celdas = (filas[i] ?? []).map(normalizarTexto).filter(Boolean);
    const coincidencias = celdas.filter((c) =>
      KEYWORDS_ENCABEZADO.some((k) => c === k || c.includes(k))
    ).length;

    // Regla 1 (la de siempre): 2 coincidencias + una columna con "programacion"
    // o "asesor". Es la que reconoce el export de Ford.
    const tieneAncla = celdas.some((c) => c.includes("programacion") || c.includes("asesor"));
    if (coincidencias >= 2 && tieneAncla) return i;

    // Regla 2: para las planillas de OTRAS marcas, que no tienen por qué llamar
    // a sus columnas "asesor" ni "fecha de programación". Sin esto, la carga
    // fallaba ANTES de mostrar la pantalla de mapeo y el operador no llegaba
    // nunca a poder asignar las columnas a mano.
    //
    // Se pide más evidencia para compensar la falta del ancla:
    //  - al menos 3 palabras conocidas, y
    //  - al menos 4 celdas con texto.
    // Lo segundo es lo que descarta las filas de resumen/KPI de arriba de la
    // tabla, que son angostas (una etiqueta y un número) mientras que una fila
    // de títulos es ancha.
    if (coincidencias >= 3 && celdas.length >= 4) return i;
  }
  return -1;
}

// ---------- Extracción de KPIs de resumen (filas previas al encabezado) ----------

const KEYWORDS_KPI = [
  "ordenes",
  "satisfechos",
  "rqr",
  "nc",
  "internos",
  "tasa",
  "onlinebooking",
];

function esNumerico(valor: unknown): boolean {
  if (typeof valor === "number") return true;
  if (typeof valor === "string") {
    const limpio = valor.replace("%", "").replace(",", ".").trim();
    return limpio !== "" && !isNaN(Number(limpio));
  }
  return false;
}

function aNumero(valor: unknown): number | string {
  if (typeof valor === "number") return valor;
  const texto = String(valor).trim();
  const limpio = texto.replace("%", "").replace(",", ".").trim();
  const num = Number(limpio);
  // Los porcentajes se conservan como texto para no perder el símbolo
  return texto.includes("%") ? texto : num;
}

export function extraerKpisResumen(
  filas: unknown[][],
  filaEncabezado: number
): Record<string, number | string> {
  const kpis: Record<string, number | string> = {};
  for (let i = 0; i < filaEncabezado; i++) {
    const fila = filas[i] ?? [];
    for (let col = 0; col < fila.length; col++) {
      const celda = fila[col];
      const etiqueta = normalizarTexto(celda);
      if (!etiqueta || esNumerico(celda)) continue;
      if (!KEYWORDS_KPI.some((k) => etiqueta.includes(k))) continue;

      // El valor puede estar en la celda de abajo (layout etiquetas/valores)
      // o en la celda de al lado (layout etiqueta: valor)
      const abajo = i + 1 < filaEncabezado ? (filas[i + 1] ?? [])[col] : undefined;
      const derecha = fila[col + 1];
      let valor: number | string | undefined;
      if (esNumerico(abajo)) valor = aNumero(abajo);
      else if (esNumerico(derecha) && normalizarTexto(derecha) === "") valor = aNumero(derecha);
      else if (esNumerico(derecha)) valor = aNumero(derecha);
      if (valor === undefined) continue;

      let clave = String(celda).trim();
      let sufijo = 2;
      while (clave in kpis) clave = `${String(celda).trim()} (${sufijo++})`;
      kpis[clave] = valor;
    }
  }
  return kpis;
}

// ---------- Sugerencia de mapeo de columnas ----------

const ALIAS_CAMPOS: Array<{ patrones: string[]; campo: CampoCaso }> = [
  { patrones: ["fecha de programacion"], campo: "fechaProgramacion" },
  { patrones: ["hora"], campo: "hora" },
  // "agendamento" (sin la i) es como viene en el Excel real de San Juan
  { patrones: ["origen del agendamiento", "origen del agendamento", "origen agendamiento"], campo: "origenAgendamiento" },
  { patrones: ["asesor"], campo: "asesor" },
  { patrones: ["modelo"], campo: "modelo" },
  { patrones: ["placa / patente", "patente", "placa"], campo: "patente" },
  { patrones: ["chasis"], campo: "chasisVIN" },
  { patrones: ["nombre propietario"], campo: "nombrePropietario" },
  { patrones: ["e-mail propietario", "email propietario", "e-mail", "email"], campo: "emailPropietario" },
  { patrones: ["celular"], campo: "celular" },
  { patrones: ["whatsapp"], campo: "whatsapp" },
  { patrones: ["comentario del asesor"], campo: "comentarioAsesor" },
  { patrones: ["fecha salida", "fecha de salida"], campo: "fechaSalida" },
  { patrones: ["dias en servicio"], campo: "diasEnServicio" },
  { patrones: ["estado"], campo: "estado" },
  { patrones: ["satisfaccion con el concesionario"], campo: "satisfaccionConcesionario" },
  { patrones: ["servicio fue realizado"], campo: "satisfaccionServicio" },
  { patrones: ["satisfaccion con ford"], campo: "satisfaccionFord" },
  { patrones: ["dejanos tu comentario"], campo: "comentarioCliente" },
  // "orden de servicio" es como viene la columna en el reporte real; "orden"
  // suelto va al final porque es genérico (match exacto para no pisar "origen").
  { patrones: ["orden de servicio", "orden de servi", "nro de orden", "n° de orden", "orden"], campo: "numeroOrden" },
];

export function sugerirMapeo(columnas: string[]): Record<string, CampoCaso> {
  const mapeo: Record<string, CampoCaso> = {};
  const camposUsados = new Set<CampoCaso>();
  for (const columna of columnas) {
    const norm = normalizarTexto(columna);
    for (const { patrones, campo } of ALIAS_CAMPOS) {
      if (camposUsados.has(campo)) continue;
      const coincide = patrones.some((p) => (p.length <= 6 ? norm === p : norm.includes(p)));
      if (coincide) {
        mapeo[columna] = campo;
        camposUsados.add(campo);
        break;
      }
    }
  }
  return mapeo;
}

// ---------- Derivación de período desde el nombre de la hoja ----------

const MESES: Record<string, string> = {
  enero: "01", febrero: "02", marzo: "03", abril: "04",
  mayo: "05", junio: "06", julio: "07", agosto: "08",
  septiembre: "09", setiembre: "09", octubre: "10",
  noviembre: "11", diciembre: "12",
  // abreviaturas comunes
  ene: "01", feb: "02", mar: "03", abr: "04", jun: "06",
  jul: "07", ago: "08", sep: "09", set: "09", oct: "10", nov: "11", dic: "12",
};

/**
 * Deriva el período (AAAA-MM) a partir de las FECHAS de los datos, cuando el
 * nombre de la hoja no dice el mes (ej. el reporte real trae una única hoja
 * "Normal"). Toma la columna mapeada a fechaProgramacion y devuelve el mes MÁS
 * FRECUENTE. Así la usuaria no tiene que tipear el período a mano.
 */
export function derivarPeriodoDeFilas(
  filas: FilaDatos[],
  mapping: Record<string, CampoCaso>
): string | null {
  const columnaFecha = Object.entries(mapping).find(([, campo]) => campo === "fechaProgramacion")?.[0];
  if (!columnaFecha) return null;

  const conteo = new Map<string, number>();
  for (const { datos } of filas) {
    const fecha = parsearFecha(datos[columnaFecha]);
    if (!fecha) continue;
    const clave = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`;
    conteo.set(clave, (conteo.get(clave) ?? 0) + 1);
  }
  if (conteo.size === 0) return null;
  // El mes con más filas (desempate: el más reciente).
  return [...conteo.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0][0];
}

export function derivarPeriodo(nombreHoja: string, anio: number): string | null {
  const norm = normalizarTexto(nombreHoja);
  // primero nombres completos (para que "junio" no matchee la abreviatura "jun" de otro mes)
  const entradas = Object.entries(MESES).sort((a, b) => b[0].length - a[0].length);
  for (const [nombre, numero] of entradas) {
    if (norm === nombre || norm.split(" ").includes(nombre) || norm.includes(nombre)) {
      return `${anio}-${numero}`;
    }
  }
  return null;
}

// ---------- Lectura de una hoja ----------

export interface FilaDatos {
  numeroFilaExcel: number; // 1-based, tal como se ve en Excel (para mensajes de error)
  datos: Record<string, unknown>;
}

export interface HojaParseada {
  nombre: string;
  filaEncabezado: number; // índice 0-based dentro de la hoja
  columnas: string[]; // nombres únicos, en orden
  kpisResumen: Record<string, number | string>;
  filas: FilaDatos[]; // filas de datos (sin resumen ni encabezado)
}

export function parsearHoja(workbook: XLSX.WorkBook, nombreHoja: string): HojaParseada | { error: string } {
  const hoja = workbook.Sheets[nombreHoja];
  if (!hoja) return { error: `La hoja "${nombreHoja}" no existe en el archivo.` };

  // Algunas hojas reales declaran miles de columnas de puro formato
  // (ej: ref A1:XEV267); se acota el rango para no procesar celdas vacías.
  const MAX_COLUMNAS = 60;
  let rango: XLSX.Range | undefined;
  if (hoja["!ref"]) {
    const original = XLSX.utils.decode_range(hoja["!ref"]);
    // Siempre desde A1 para que los índices coincidan con lo que se ve en Excel
    rango = {
      s: { r: 0, c: 0 },
      e: { r: original.e.r, c: Math.min(original.e.c, MAX_COLUMNAS - 1) },
    };
  }

  // blankrows: true conserva las filas vacías para que los índices coincidan
  // con los números de fila que el usuario ve en Excel
  const filasCrudas: unknown[][] = XLSX.utils.sheet_to_json(hoja, {
    header: 1,
    defval: null,
    blankrows: true,
    ...(rango ? { range: rango } : {}),
  });

  const filaEncabezado = detectarFilaEncabezado(filasCrudas);
  if (filaEncabezado === -1) {
    return {
      error:
        `En la hoja "${nombreHoja}" no se encontró la fila de títulos de la tabla ` +
        `(se buscan columnas como "Fecha de Programación" y "Asesor" en las primeras ${MAX_FILAS_BUSQUEDA_ENCABEZADO} filas). ` +
        `Verificá que la hoja tenga el formato habitual de Contacto Posterior.`,
    };
  }

  const kpisResumen = extraerKpisResumen(filasCrudas, filaEncabezado);

  // Nombres de columna únicos (si un título se repite, se le agrega un sufijo)
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

  const filas: FilaDatos[] = [];
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

  return { nombre: nombreHoja, filaEncabezado, columnas, kpisResumen, filas };
}

export function abrirWorkbook(buffer: Buffer): XLSX.WorkBook {
  return XLSX.read(buffer, { type: "buffer", cellDates: true });
}

// ---------- Parseo de valores de celda ----------

export function parsearFecha(valor: unknown): Date | null {
  if (valor === null || valor === undefined || valor === "") return null;
  if (valor instanceof Date && !isNaN(valor.getTime())) return valor;
  if (typeof valor === "number") {
    // número de serie de Excel (días desde 1900)
    const ms = Math.round((valor - 25569) * 86400 * 1000);
    const fecha = new Date(ms);
    return isNaN(fecha.getTime()) ? null : fecha;
  }
  const texto = String(valor).trim();
  // dd/mm/yyyy o dd-mm-yyyy (formato argentino)
  const ddmmyyyy = texto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (ddmmyyyy) {
    const [, d, m, a] = ddmmyyyy;
    const anio = a.length === 2 ? 2000 + Number(a) : Number(a);
    const fecha = new Date(anio, Number(m) - 1, Number(d));
    return isNaN(fecha.getTime()) ? null : fecha;
  }
  // yyyy-mm-dd
  const iso = texto.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const [, a, m, d] = iso;
    const fecha = new Date(Number(a), Number(m) - 1, Number(d));
    return isNaN(fecha.getTime()) ? null : fecha;
  }
  return null;
}

export function parsearNota(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  // El Excel real mezcla escalas: algunas respuestas son "Si"/"No" en vez de 1-5
  const texto = normalizarTexto(valor);
  if (texto === "si") return 5;
  if (texto === "no") return 1;
  const num = Number(String(valor).replace(",", "."));
  if (isNaN(num)) return null;
  return num;
}

export function parsearEntero(valor: unknown): number | null {
  const num = parsearNota(valor);
  return num === null ? null : Math.trunc(num);
}
