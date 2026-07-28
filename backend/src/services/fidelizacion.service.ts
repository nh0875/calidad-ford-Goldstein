// Fidelización (Parte C): a partir del Excel de agendamientos (mismo formato Ford
// que Contacto Posventa) se detecta, leyendo la columna "Comentario del Asesor",
// qué clientes tienen un service de mantenimiento PENDIENTE (1° a 5°) para
// mandarles UN recordatorio por WhatsApp. NO clasifica respuestas ni crea Casos.
import { EstadoFidelizacion } from "@prisma/client";
import * as XLSX from "xlsx";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { fidelizacionQueue } from "../jobs/queues";
import {
  CampoCaso,
  derivarPeriodoDeFilas,
  parsearHoja,
  sugerirMapeo,
} from "./excel.service";
import { normalizarTelefonoAR } from "./telefono.service";

// Services que se consideran "pendientes" para el recordatorio de fidelización.
// El programa de mantenimiento cubre del 1° al 5°; de ahí en más no se recuerda.
export const SERVICIO_MIN = 1;
export const SERVICIO_MAX = 5;

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

export interface FilaFidelizacion {
  numeroFilaExcel: number;
  nombre: string;
  whatsappNorm: string | null;
  celularNorm: string | null;
  telefonoCrudo: string | null; // el mejor teléfono tal cual vino (por si no normalizó)
  modelo: string | null;
  patente: string | null;
  asesor: string | null;
  numeroServicio: number; // 1..5
  comentarioAsesor: string;
}

export interface ResumenFidelizacion {
  totalFilas: number;
  conServicio1a5: number; // candidatos (con service en rango)
  servicioFueraDeRango: number; // 6° en adelante (se listan pero NO se envían)
  sinServicio: number; // el comentario no es un service de mantenimiento
  sinTelefono: number; // candidatos que no tienen teléfono contactable
}

export interface ResultadoParseoFidelizacion {
  candidatos: FilaFidelizacion[];
  columnas: string[];
  mapping: Record<string, CampoCaso>;
  periodoSugerido: string | null;
  resumen: ResumenFidelizacion;
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

  if (!colComentario) {
    return {
      error:
        'No se encontró la columna "Comentario del Asesor" en el Excel. ' +
        "Es la columna donde el asesor anota el service (ej. \"1° Servicio de Mantenimiento\").",
    };
  }
  if (!colWhatsapp && !colCelular) {
    return { error: 'No se encontró ninguna columna de teléfono ("Whatsapp" ni "Celular").' };
  }

  const colModelo = columnaDe("modelo");
  const colPatente = columnaDe("patente");
  const colAsesor = columnaDe("asesor");

  const candidatos: FilaFidelizacion[] = [];
  const resumen: ResumenFidelizacion = {
    totalFilas: hoja.filas.length,
    conServicio1a5: 0,
    servicioFueraDeRango: 0,
    sinServicio: 0,
    sinTelefono: 0,
  };

  for (const fila of hoja.filas) {
    const comentario = textoCelda(fila.datos[colComentario]);
    const numero = detectarNumeroServicio(comentario);

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

    if (!whatsappNorm && !celularNorm) resumen.sinTelefono++;

    candidatos.push({
      numeroFilaExcel: fila.numeroFilaExcel,
      nombre: (colNombre && textoCelda(fila.datos[colNombre])) || "(sin nombre)",
      whatsappNorm,
      celularNorm,
      telefonoCrudo: telefonoCrudo || null,
      modelo: (colModelo && textoCelda(fila.datos[colModelo])) || null,
      patente: (colPatente && textoCelda(fila.datos[colPatente])) || null,
      asesor: (colAsesor && textoCelda(fila.datos[colAsesor])) || null,
      numeroServicio: numero,
      comentarioAsesor: comentario,
    });
  }

  return {
    candidatos,
    columnas: hoja.columnas,
    mapping,
    periodoSugerido: derivarPeriodoDeFilas(hoja.filas, mapping),
    resumen,
  };
}

// ---------- Envío de recordatorios (cola) ----------

/**
 * Encola el recordatorio para los clientes PENDIENTE de una carga. Igual que las
 * campañas: jobId fijo por cliente (anti doble-click), espaciado por el delay de
 * envío. Devuelve cuántos se encolaron. NO se dispara solo: lo llama el botón
 * "Enviar recordatorios".
 */
export async function encolarEnviosFidelizacion(uploadId: string): Promise<number> {
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
