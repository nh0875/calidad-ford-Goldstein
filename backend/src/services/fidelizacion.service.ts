// Fidelización (Parte C): mandarle a un cliente UN recordatorio por WhatsApp
// para que vuelva al taller. NO clasifica respuestas ni crea Casos.
//
// Entran DOS planillas distintas, con reglas distintas, a la misma pantalla:
//
//  1. TURNOS — el export de agendamientos de Ford (mismo formato que Contacto
//     Posventa). Trae el service en "Comentario del Asesor" y/o "Servicio", y
//     SOLO se contacta a los que tienen pendiente del 1° al 5°: del 6° en
//     adelante el plan de mantenimiento ya no aplica.
//
//  2. VENTAS — la planilla de ventas de la agencia. NO trae ningún dato de
//     service (no hay con qué deducir cuál le toca), así que ahí no hay regla de
//     rango: se contacta a todos los Ford 0km de la planilla. La regla del 1° al
//     5° es exclusiva del formato TURNOS.
//
// El formato se detecta solo por las columnas del archivo; el usuario sube el
// Excel y listo.
import { EstadoFidelizacion, OrigenFidelizacion } from "@prisma/client";
import * as XLSX from "xlsx";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { fidelizacionQueue } from "../jobs/queues";
import {
  CampoCaso,
  derivarPeriodoDeFilas,
  parsearFecha,
  parsearHoja,
  sugerirMapeo,
} from "./excel.service";
import { normalizarTelefonoAR, normalizarTelefonoARFlexible } from "./telefono.service";

// Services que se consideran "pendientes" para el recordatorio de fidelización.
// El programa de mantenimiento cubre del 1° al 5°; de ahí en más no se recuerda.
// OJO: esta regla aplica SOLO al formato TURNOS (es el único que trae el dato).
export const SERVICIO_MIN = 1;
export const SERVICIO_MAX = 5;

/** El formato del archivo determina el origen del destinatario: son lo mismo. */
export type FormatoFidelizacion = OrigenFidelizacion;

// ---------- Detección del formato del archivo ----------

/** Encabezado comparable: sin acentos, sin puntos, en minúsculas. */
function claveEncabezado(valor: unknown): string {
  return String(valor ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Firma de la planilla de VENTAS: si están estas tres columnas, es esa y no otra
// (el export de turnos de Ford no tiene ninguna de las tres).
const COLUMNAS_FIRMA_VENTAS = ["cliente", "telef", "venta_1"];
// Hasta dónde buscar la fila de títulos (algunas planillas traen filas de adorno).
const MAX_FILAS_BUSQUEDA_ENCABEZADO_VENTAS = 20;

/**
 * Ubica la fila de títulos de la planilla de VENTAS. Devuelve -1 si el archivo
 * no es de ese formato.
 *
 * Va aparte del `detectarFilaEncabezado` de excel.service porque aquel exige una
 * columna con "programación" o "asesor" —ancla del export de Ford— y la planilla
 * de ventas no tiene ninguna de las dos: pasarla por ahí falla antes de leer nada.
 */
function buscarEncabezadoVentas(filas: unknown[][]): number {
  const limite = Math.min(filas.length, MAX_FILAS_BUSQUEDA_ENCABEZADO_VENTAS);
  for (let i = 0; i < limite; i++) {
    const celdas = (filas[i] ?? []).map(claveEncabezado);
    if (COLUMNAS_FIRMA_VENTAS.every((requerida) => celdas.includes(requerida))) return i;
  }
  return -1;
}

/**
 * Qué planilla es la que subieron. Se mira primero VENTAS porque tiene una firma
 * de columnas inconfundible; cualquier otra cosa se intenta leer como el export
 * de turnos de Ford (que ya valida sus propias columnas y avisa si no lo es).
 */
export function detectarFormatoFidelizacion(
  workbook: XLSX.WorkBook,
  nombreHoja: string
): FormatoFidelizacion {
  const hoja = workbook.Sheets[nombreHoja];
  if (!hoja) return OrigenFidelizacion.TURNOS;
  const filas: unknown[][] = XLSX.utils.sheet_to_json(hoja, {
    header: 1,
    defval: null,
    blankrows: true,
  });
  return buscarEncabezadoVentas(filas) >= 0 ? OrigenFidelizacion.VENTAS : OrigenFidelizacion.TURNOS;
}

/**
 * Lee un "Comentario del Asesor" y devuelve el número de service de
 * mantenimiento que menciona (1, 2, 3, ...), o null si el comentario no habla de
 * un service de mantenimiento (reparaciones, campañas, diagnósticos, etc.).
 *
 * Formatos reales soportados (mayúsc/minúsc, con prefijos tipo "SSD:", "ssd:",
 * "SCD:", con "°" o con "º", con o sin espacios, y tolerando abreviaturas y
 * errores de tipeo en "mantenimiento"):
 *   "4° Servicio de Mantenimiento", "SSD:3° Servicio de Mantenimiento+...",
 *   "ssd:1° servicio de mantenimiento.", "5º Servicio de Mantenimiento+...",
 *   "SSD:1° SERVICIO + CC:...", "ssd: 10 servicio de mantenimiento.",
 *   "SSD:3Servicio de mantenimiento", "ssd:5servicio...", "MANTENIMINETO" (typo).
 * NO matchean: "PW: VARILLA DE ACEITE.", "SSD 130000kms", "CC:24S59.",
 *   "DIAGNOSTICO: $170.000 ...", "pw: bujía n° 3." (el número va DESPUÉS del "n°").
 *
 * La clave es "número + (° opcional) + servicio": no se exige "de mantenimiento"
 * (aparece abreviado o mal tipeado), pero sí que "servicio" venga justo después
 * del número, lo que evita falsos positivos con códigos tipo "24C24".
 */
export function detectarNumeroServicio(comentario: unknown): number | null {
  if (comentario === null || comentario === undefined) return null;
  const texto = String(comentario)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // quita acentos (no afecta a "mantenimiento")
  const m = texto.match(/(\d{1,2})\s*[°º]?\s*servicio/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** true si ese número de service entra en el recordatorio de fidelización (1..5). */
export function esServicioFidelizable(n: number | null): boolean {
  return n !== null && n >= SERVICIO_MIN && n <= SERVICIO_MAX;
}

/**
 * Cómo se nombra al destinatario en el chat de Seguimiento y en los logs. Los de
 * turnos se identifican por el service que tienen pendiente ("3° service"); los
 * de la planilla de ventas no tienen service, así que se los nombra por lo que
 * son: clientes que compraron un 0km.
 */
export function etiquetaFidelizacion(cliente: { numeroServicio: number | null }): string {
  return cliente.numeroServicio ? `${cliente.numeroServicio}° service` : "Cliente 0km";
}

export interface FilaFidelizacion {
  numeroFilaExcel: number;
  origen: OrigenFidelizacion;
  nombre: string;
  whatsappNorm: string | null;
  celularNorm: string | null;
  telefonoCrudo: string | null; // el mejor teléfono tal cual vino (por si no normalizó)
  modelo: string | null;
  patente: string | null;
  asesor: string | null; // asesor de servicio (TURNOS) o vendedor (VENTAS)
  numeroServicio: number | null; // 1..5 en TURNOS; null en VENTAS (no viene el dato)
  comentarioAsesor: string | null;
  provincia: string | null; // solo VENTAS (la planilla la trae por fila)
  fechaEntrega: Date | null; // solo VENTAS
  // Motivo por el que esta fila NO recibe el mensaje aunque sea candidata (sin
  // teléfono usable, teléfono repetido dentro de la misma carga). null = se envía.
  motivoOmision: string | null;
}

export interface ResumenFidelizacion {
  formato: FormatoFidelizacion;
  totalFilas: number;
  candidatos: number; // filas que quedaron como destinatarios (se listan)
  destinatarios: number; // de esas, las que realmente reciben el mensaje
  sinTelefono: number; // candidatos sin teléfono contactable
  // --- solo TURNOS ---
  conServicio1a5: number; // candidatos (con service en rango)
  servicioFueraDeRango: number; // 6° en adelante (NO se envían)
  sinServicio: number; // el comentario no es un service de mantenimiento
  // --- solo VENTAS ---
  noElegibles: number; // usados, venta directa y otras marcas (NO se envían)
  duplicados: number; // el mismo teléfono ya apareció en la carga
}

export interface ResultadoParseoFidelizacion {
  candidatos: FilaFidelizacion[];
  columnas: string[];
  mapping: Record<string, CampoCaso>;
  periodoSugerido: string | null;
  resumen: ResumenFidelizacion;
}

/** Resumen vacío, para que cada parser complete solo lo que le corresponde. */
function resumenVacio(formato: FormatoFidelizacion, totalFilas: number): ResumenFidelizacion {
  return {
    formato,
    totalFilas,
    candidatos: 0,
    destinatarios: 0,
    sinTelefono: 0,
    conServicio1a5: 0,
    servicioFueraDeRango: 0,
    sinServicio: 0,
    noElegibles: 0,
    duplicados: 0,
  };
}

function textoCelda(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  return String(valor).trim();
}

/**
 * Parsea el Excel de fidelización (una hoja) y arma la lista de candidatos:
 * clientes cuyo "Comentario del Asesor" indica un service de mantenimiento 1°-5°.
 */
export function parsearFidelizacion(
  workbook: XLSX.WorkBook,
  nombreHoja: string
): ResultadoParseoFidelizacion | { error: string } {
  const hoja = parsearHoja(workbook, nombreHoja);
  if ("error" in hoja) return { error: hoja.error };

  const mapping = sugerirMapeo(hoja.columnas);
  // campo -> nombre de columna (para leer cada fila por campo)
  const columnaDe = (campo: CampoCaso): string | null =>
    Object.entries(mapping).find(([, c]) => c === campo)?.[0] ?? null;

  const colComentario = columnaDe("comentarioAsesor");
  const colNombre = columnaDe("nombrePropietario");
  const colWhatsapp = columnaDe("whatsapp");
  const colCelular = columnaDe("celular");

  // El service puede venir en "Comentario del Asesor" (ej. "1° Servicio de
  // Mantenimiento") Y/O en la columna "Servicio" (ej. "1°ServiciodeMantenimiento").
  // Los dos exports de Ford lo traen; algunos turnos lo tienen SOLO en una de las
  // dos columnas, así que se detecta de AMBAS (se toma el número de la que lo tenga).
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  const colServicio = hoja.columnas.find((c) => norm(c) === "servicio") ?? null;

  if (!colComentario && !colServicio) {
    return {
      error:
        'No se encontró la columna "Comentario del Asesor" ni "Servicio" en el Excel. ' +
        'Es donde figura el service (ej. "1° Servicio de Mantenimiento").',
    };
  }
  if (!colWhatsapp && !colCelular) {
    return { error: 'No se encontró ninguna columna de teléfono ("Whatsapp" ni "Celular").' };
  }

  const colModelo = columnaDe("modelo");
  const colPatente = columnaDe("patente");
  const colAsesor = columnaDe("asesor");

  const candidatos: FilaFidelizacion[] = [];
  const resumen = resumenVacio(OrigenFidelizacion.TURNOS, hoja.filas.length);

  for (const fila of hoja.filas) {
    const comentario = colComentario ? textoCelda(fila.datos[colComentario]) : "";
    const servicioTxt = colServicio ? textoCelda(fila.datos[colServicio]) : "";
    // Número del service tomado de cualquiera de las dos columnas.
    const numero = detectarNumeroServicio(comentario) ?? detectarNumeroServicio(servicioTxt);

    if (numero === null) {
      resumen.sinServicio++;
      continue;
    }
    if (!esServicioFidelizable(numero)) {
      resumen.servicioFueraDeRango++;
      continue;
    }

    resumen.conServicio1a5++;

    const whatsappNorm = colWhatsapp ? normalizarTelefonoAR(fila.datos[colWhatsapp]) : null;
    const celularNorm = colCelular ? normalizarTelefonoAR(fila.datos[colCelular]) : null;
    const telefonoCrudo =
      (colWhatsapp && textoCelda(fila.datos[colWhatsapp])) ||
      (colCelular && textoCelda(fila.datos[colCelular])) ||
      null;

    const sinTelefono = !whatsappNorm && !celularNorm;
    if (sinTelefono) resumen.sinTelefono++;

    candidatos.push({
      numeroFilaExcel: fila.numeroFilaExcel,
      origen: OrigenFidelizacion.TURNOS,
      nombre: (colNombre && textoCelda(fila.datos[colNombre])) || "(sin nombre)",
      whatsappNorm,
      celularNorm,
      telefonoCrudo: telefonoCrudo || null,
      modelo: (colModelo && textoCelda(fila.datos[colModelo])) || null,
      patente: (colPatente && textoCelda(fila.datos[colPatente])) || null,
      asesor: (colAsesor && textoCelda(fila.datos[colAsesor])) || null,
      numeroServicio: numero,
      comentarioAsesor: comentario || servicioTxt,
      provincia: null,
      fechaEntrega: null,
      motivoOmision: sinTelefono ? MOTIVO_SIN_TELEFONO : null,
    });
  }

  resumen.candidatos = candidatos.length;
  resumen.destinatarios = candidatos.filter((c) => c.motivoOmision === null).length;

  return {
    candidatos,
    columnas: hoja.columnas,
    mapping,
    periodoSugerido: derivarPeriodoDeFilas(hoja.filas, mapping),
    resumen,
  };
}

// ---------- Formato VENTAS (planilla de ventas de la agencia) ----------

// Los únicos que reciben el recordatorio: Ford 0km. Los usados no entran (la
// fecha de entrega no dice nada de la antigüedad real del vehículo) ni tampoco
// las ventas directas (las maneja otro circuito) ni las otras marcas.
const TIPOS_VENTA_ELEGIBLES = new Set(["nuevos", "nuevo aa ford"]);

export const MOTIVO_SIN_TELEFONO = "Sin teléfono válido para WhatsApp.";
export const MOTIVO_TELEFONO_DUPLICADO =
  "Teléfono repetido en esta carga (el cliente ya recibe el mensaje en otra fila).";

// Columnas de la planilla de ventas, por su clave normalizada.
const COL_VENTAS = {
  cliente: "cliente",
  telefono: "telef",
  tipoVenta: "venta_1",
  modelo: "modelo",
  dominio: "dominio",
  vendedor: "vendedor",
  provincia: "provincia",
  fechaEntrega: "fec entrega",
  marca: "marca",
} as const;

/**
 * Parsea la planilla de VENTAS y arma la lista de destinatarios: los Ford 0km.
 *
 * Acá NO hay regla de service (la planilla no trae el dato), así que entran
 * todos los elegibles. Sí se descarta lo que no se puede contactar: filas sin
 * teléfono usable, y las repetidas —un mismo cliente que compró dos vehículos
 * aparece dos veces y no tiene que recibir el mensaje duplicado—.
 */
export function parsearFidelizacionVentas(
  workbook: XLSX.WorkBook,
  nombreHoja: string
): ResultadoParseoFidelizacion | { error: string } {
  const hoja = workbook.Sheets[nombreHoja];
  if (!hoja) return { error: `La hoja "${nombreHoja}" no existe en el archivo.` };

  const filas: unknown[][] = XLSX.utils.sheet_to_json(hoja, {
    header: 1,
    defval: null,
    blankrows: true,
  });

  const filaEncabezado = buscarEncabezadoVentas(filas);
  if (filaEncabezado === -1) {
    return {
      error:
        'No se reconoció la planilla de ventas: faltan las columnas "Cliente", "Teléf." y/o "VENTA_1".',
    };
  }

  // Nombre visible de cada columna, indexado por su clave normalizada.
  const encabezado = (filas[filaEncabezado] ?? []).map((c) => String(c ?? "").trim());
  const indicePorClave = new Map<string, number>();
  encabezado.forEach((nombre, i) => {
    const clave = claveEncabezado(nombre);
    if (clave && !indicePorClave.has(clave)) indicePorClave.set(clave, i);
  });

  const leer = (fila: unknown[], clave: string): string => {
    const i = indicePorClave.get(clave);
    if (i === undefined) return "";
    return textoCelda(fila[i]);
  };

  const filasDatos = filas.slice(filaEncabezado + 1);
  const candidatos: FilaFidelizacion[] = [];
  const resumen = resumenVacio(OrigenFidelizacion.VENTAS, 0);

  // Para no mandarle dos veces el mismo mensaje al mismo número dentro de la carga.
  const telefonosVistos = new Set<string>();

  filasDatos.forEach((fila, i) => {
    const numeroFilaExcel = filaEncabezado + 2 + i; // 1-based, como lo ve el usuario
    const nombre = leer(fila, COL_VENTAS.cliente);
    const tipoVenta = leer(fila, COL_VENTAS.tipoVenta);
    // Fila de relleno / totales al pie: sin cliente ni tipo de venta no es un dato.
    if (!nombre && !tipoVenta) return;

    resumen.totalFilas++;

    if (!TIPOS_VENTA_ELEGIBLES.has(claveEncabezado(tipoVenta))) {
      resumen.noElegibles++;
      return;
    }

    const telefonoCrudo = leer(fila, COL_VENTAS.telefono);
    // La celda mezcla número y nombre ("2615600368 - DANIEL") y a veces dos
    // números: el normalizador flexible se queda con el primero que sirva.
    const telefonoNorm = normalizarTelefonoARFlexible(telefonoCrudo);

    let motivoOmision: string | null = null;
    if (!telefonoNorm) {
      resumen.sinTelefono++;
      motivoOmision = MOTIVO_SIN_TELEFONO;
    } else if (telefonosVistos.has(telefonoNorm)) {
      resumen.duplicados++;
      motivoOmision = MOTIVO_TELEFONO_DUPLICADO;
    } else {
      telefonosVistos.add(telefonoNorm);
    }

    candidatos.push({
      numeroFilaExcel,
      origen: OrigenFidelizacion.VENTAS,
      nombre: nombre || "(sin nombre)",
      whatsappNorm: telefonoNorm,
      celularNorm: null,
      telefonoCrudo: telefonoCrudo || null,
      modelo: leer(fila, COL_VENTAS.modelo) || null,
      patente: leer(fila, COL_VENTAS.dominio) || null,
      asesor: leer(fila, COL_VENTAS.vendedor) || null,
      numeroServicio: null, // la planilla de ventas no dice qué service le toca
      comentarioAsesor: null,
      provincia: leer(fila, COL_VENTAS.provincia) || null,
      fechaEntrega: parsearFecha(fila[indicePorClave.get(COL_VENTAS.fechaEntrega) ?? -1]),
      motivoOmision,
    });
  });

  resumen.candidatos = candidatos.length;
  resumen.destinatarios = candidatos.filter((c) => c.motivoOmision === null).length;

  return {
    candidatos,
    columnas: encabezado.filter(Boolean),
    mapping: {},
    // El período de la carga sale de la entrega más reciente (aaaa-mm).
    periodoSugerido: periodoDeEntregas(candidatos),
    resumen,
  };
}

/** Período (aaaa-mm) de la carga de ventas: el mes de la entrega más reciente. */
function periodoDeEntregas(candidatos: FilaFidelizacion[]): string | null {
  const fechas = candidatos
    .map((c) => c.fechaEntrega)
    .filter((f): f is Date => f instanceof Date && !isNaN(f.getTime()));
  if (fechas.length === 0) return null;
  const masReciente = fechas.reduce((a, b) => (a > b ? a : b));
  return `${masReciente.getFullYear()}-${String(masReciente.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Punto de entrada único: detecta el formato del archivo y lo manda al parser
 * que corresponde. Es lo que usa el controller al recibir la subida.
 */
export function parsearPlanillaFidelizacion(
  workbook: XLSX.WorkBook,
  nombreHoja: string
): ResultadoParseoFidelizacion | { error: string } {
  return detectarFormatoFidelizacion(workbook, nombreHoja) === OrigenFidelizacion.VENTAS
    ? parsearFidelizacionVentas(workbook, nombreHoja)
    : parsearFidelizacion(workbook, nombreHoja);
}

// ---------- Envío de recordatorios (cola) ----------

/**
 * Encola el recordatorio para los clientes PENDIENTE de una carga. Igual que las
 * campañas: jobId fijo por cliente (anti doble-click), espaciado por el delay de
 * envío. Devuelve cuántos se encolaron. NO se dispara solo: lo llama el botón
 * "Enviar recordatorios".
 */
export async function encolarEnviosFidelizacion(uploadId: string): Promise<number> {
  // Reintento: los que quedaron en ERROR (típico si se envió ANTES de que Meta
  // aprobara la plantilla) vuelven a PENDIENTE para poder reenviarlos. Los
  // OMITIDO (sin teléfono / suprimidos) NO se tocan: son descartes a propósito.
  await prisma.clienteFidelizacion.updateMany({
    where: { uploadId, estado: EstadoFidelizacion.ERROR },
    data: { estado: EstadoFidelizacion.PENDIENTE, error: null },
  });

  const clientes = await prisma.clienteFidelizacion.findMany({
    where: { uploadId, estado: EstadoFidelizacion.PENDIENTE },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  const delayMs = env.whatsappEnvioDelayMs;

  // Se limpian los jobs YA TERMINADOS (fallidos/completados) de esos clientes,
  // para poder reintentar un envío; los que siguen en cola/activos no se tocan.
  await Promise.all(
    clientes.map(async (c) => {
      try {
        const job = await fidelizacionQueue.getJob(`fidel-${c.id}`);
        if (!job) return;
        const estado = await job.getState();
        if (estado === "failed" || estado === "completed") await job.remove();
      } catch {
        // best-effort
      }
    })
  );

  await fidelizacionQueue.addBulk(
    clientes.map((c, i) => ({
      name: "enviar-fidelizacion",
      data: { clienteId: c.id },
      opts: {
        jobId: `fidel-${c.id}`,
        delay: i * delayMs,
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { age: 3600, count: 5000 },
        removeOnFail: { age: 24 * 3600 },
      },
    }))
  );

  return clientes.length;
}

export async function progresoColaFidelizacion() {
  const c = await fidelizacionQueue.getJobCounts("waiting", "delayed", "active", "completed", "failed");
  return {
    enCola: (c.waiting ?? 0) + (c.delayed ?? 0),
    enviando: c.active ?? 0,
    completados: c.completed ?? 0,
    fallidos: c.failed ?? 0,
  };
}
