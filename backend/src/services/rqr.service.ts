import { AreaTrabajo, Caso, EstadoRQR, Prisma, SentimentAnalysis } from "@prisma/client";
import { prisma } from "../config/prisma";
import { ACCIONES, auditar } from "./audit.service";

function fechaHora(d: Date): string {
  return d.toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
function fechaCorta(d: Date): string {
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// ---------- Correlativo por año: RQR-2026-0001, RQR-2026-0002, ... ----------

export async function generarNumeroRQR(tx: Prisma.TransactionClient = prisma): Promise<string> {
  const anio = new Date().getFullYear();
  const prefijo = `RQR-${anio}-`;

  const ultimo = await tx.rQR.findFirst({
    where: { numeroRQR: { startsWith: prefijo } },
    orderBy: { numeroRQR: "desc" },
    select: { numeroRQR: true },
  });

  const ultimoCorrelativo = ultimo ? parseInt(ultimo.numeroRQR.slice(prefijo.length), 10) : 0;
  const siguiente = (isNaN(ultimoCorrelativo) ? 0 : ultimoCorrelativo) + 1;
  return `${prefijo}${String(siguiente).padStart(4, "0")}`;
}

// ---------- Creación automática desde un análisis de sentimiento ----------

const ESTADOS_ABIERTOS_RQR: EstadoRQR[] = [EstadoRQR.ABIERTO, EstadoRQR.EN_TRATAMIENTO];

export interface ResultadoCrearRqr {
  rqr: { id: string; numeroRQR: string };
  // "creado" = RQR nuevo; "actualizado" = ya había uno abierto y se agregó a su bitácora
  accion: "creado" | "actualizado";
}

/**
 * Abre (o actualiza) el RQR automático a partir de un análisis ROJO/AMARILLO grave.
 * Guard de RQR único por caso (chequea la tabla RQR, no el flag):
 *  - Si el caso YA tiene un RQR ABIERTO/EN_TRATAMIENTO → no crea otro: agrega la
 *    nueva respuesta a su bitácora (es información de escalada, no ruido) y audita.
 *  - Si solo hay RQRs CERRADOS (o ninguno) → crea uno nuevo, referenciando el
 *    antecedente cerrado en la descripción (posible solución que no funcionó).
 * Usa un lock advisory por caso para que dos análisis simultáneos del mismo caso
 * no creen dos RQRs (la condición de carrera que vimos).
 */
export async function crearRqrAutomatico(params: {
  caso: Caso;
  analisis: SentimentAnalysis;
  textoCliente: string;
}): Promise<ResultadoCrearRqr> {
  const { caso, analisis, textoCliente } = params;

  for (let intento = 1; intento <= 3; intento++) {
    try {
      const resultado = await prisma.$transaction(async (tx) => {
        // Serializa por caso: dos respuestas simultáneas no abren dos RQR
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${caso.id}))`;

        const abierto = await tx.rQR.findFirst({
          where: { casoId: caso.id, estado: { in: ESTADOS_ABIERTOS_RQR }, eliminadoEn: null },
          orderBy: { createdAt: "desc" },
        });

        // Ya hay uno abierto → agregar a la bitácora, no crear otro
        if (abierto) {
          const linea =
            `[${fechaHora(new Date())}] Nueva respuesta del cliente que ameritaba RQR ` +
            `(semáforo ${analisis.semaforo ?? "s/d"}, severidad ${analisis.severidad ?? "s/d"}): ` +
            `"${textoCliente}"`;
          const actualizado = await tx.rQR.update({
            where: { id: abierto.id },
            data: {
              tratamientoBitacora: abierto.tratamientoBitacora
                ? `${abierto.tratamientoBitacora}\n${linea}`
                : linea,
            },
          });
          return { rqr: actualizado, accion: "actualizado" as const };
        }

        // Antecedente: RQR cerrado previo del mismo caso (para dar contexto)
        const cerrado = await tx.rQR.findFirst({
          where: { casoId: caso.id, estado: EstadoRQR.CERRADO, eliminadoEn: null },
          orderBy: { fechaCierre: "desc" },
        });

        let descripcionReclamo =
          `[Generado automáticamente, revisar y ajustar]\n\n` +
          `Resumen del análisis: ${analisis.resumenIA}\n` +
          `Causa raíz sugerida: ${analisis.categoriaCausaRaiz ?? "sin categoría"}\n\n` +
          `Respuesta original del cliente por WhatsApp:\n"${textoCliente}"`;
        if (cerrado) {
          descripcionReclamo +=
            `\n\nAntecedente: ${cerrado.numeroRQR} cerrado el ` +
            `${cerrado.fechaCierre ? fechaCorta(cerrado.fechaCierre) : "(fecha desconocida)"}. ` +
            `El cliente volvió a quejarse tras el cierre: revisar si la solución anterior no funcionó.`;
        }

        const numeroRQR = await generarNumeroRQR(tx);
        const rqr = await tx.rQR.create({
          data: {
            casoId: caso.id,
            area: caso.area, // el RQR hereda el área del caso
            sentimentAnalysisId: analisis.id,
            numeroRQR,
            canal: "Posventa",
            areaOrigen: "Taller",
            asesor: caso.asesor,
            descripcionReclamo,
            causaRaiz: analisis.categoriaCausaRaiz,
            estado: EstadoRQR.ABIERTO,
          },
        });
        await tx.caso.update({ where: { id: caso.id }, data: { tieneRqrAbierto: true } });
        return { rqr, accion: "creado" as const };
      });

      // Auditoría del caso "se agregó a un RQR existente" (acción del sistema, sin usuario)
      if (resultado.accion === "actualizado") {
        await auditar(null, {
          accion: ACCIONES.RQR_ACTUALIZADO_POR_NUEVA_RESPUESTA,
          entidad: "RQR",
          entidadId: resultado.rqr.id,
          detalles: {
            casoId: caso.id,
            numeroRQR: resultado.rqr.numeroRQR,
            semaforo: analisis.semaforo,
            severidad: analisis.severidad,
          },
        });
      }
      return resultado;
    } catch (err) {
      const esConflictoUnico =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!esConflictoUnico || intento === 3) throw err;
    }
  }
  throw new Error("No se pudo generar el correlativo del RQR");
}

// ---------- Creación manual (reclamo telefónico / presencial / otro canal) ----------

export interface DatosRqrManual {
  casoId?: string;
  nombreClienteManual?: string;
  telefonoManual?: string;
  modeloManual?: string;
  /** El cliente no quiso identificarse (ver nombreClienteRqr más abajo). */
  clienteAnonimo?: boolean;
  canal: string;
  areaOrigen: string;
  areaAfectada?: string;
  asesor: string;
  descripcionReclamo: string;
  causaRaiz?: string;
  tratamientoBitacora?: string;
  observaciones?: string;
  area: AreaTrabajo;
  // Quién lo cargó: se imprime en el documento del RQR.
  creadoPorId?: string;
  // --- Campos de Volkswagen (quedan null en Ford) ---
  // Aceptan null además de undefined: el formulario puede mandar un casillero
  // vacío a propósito, y las dos cosas terminan guardándose como null.
  tipoContacto?: string | null;
  areaPrincipal?: string | null;
  subarea?: string | null;
  origenRqr?: string | null;
  codigoSucursal?: string | null;
  razonSocial?: string | null;
  tratamientoDadoPor2?: string | null;
}

export async function crearRqrManual(datos: DatosRqrManual) {
  for (let intento = 1; intento <= 3; intento++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const numeroRQR = await generarNumeroRQR(tx);
        const rqr = await tx.rQR.create({
          data: {
            casoId: datos.casoId ?? null,
            area: datos.area,
            nombreClienteManual: datos.nombreClienteManual ?? null,
            telefonoManual: datos.telefonoManual ?? null,
            modeloManual: datos.modeloManual ?? null,
            clienteAnonimo: datos.clienteAnonimo ?? false,
            numeroRQR,
            canal: datos.canal,
            areaOrigen: datos.areaOrigen,
            areaAfectada: datos.areaAfectada ?? null,
            asesor: datos.asesor,
            descripcionReclamo: datos.descripcionReclamo,
            causaRaiz: datos.causaRaiz ?? null,
            tratamientoBitacora: datos.tratamientoBitacora ?? null,
            observaciones: datos.observaciones ?? null,
            creadoPorId: datos.creadoPorId ?? null,
            tipoContacto: datos.tipoContacto ?? null,
            areaPrincipal: datos.areaPrincipal ?? null,
            subarea: datos.subarea ?? null,
            origenRqr: datos.origenRqr ?? null,
            codigoSucursal: datos.codigoSucursal ?? null,
            razonSocial: datos.razonSocial ?? null,
            tratamientoDadoPor2: datos.tratamientoDadoPor2 ?? null,
            estado: EstadoRQR.ABIERTO,
          },
        });
        if (datos.casoId) {
          await tx.caso.update({
            where: { id: datos.casoId },
            data: { tieneRqrAbierto: true },
          });
        }
        return rqr;
      });
    } catch (err) {
      const esConflictoUnico =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!esConflictoUnico || intento === 3) throw err;
    }
  }
  throw new Error("No se pudo generar el correlativo del RQR");
}

// ---------- Recalcular la marca del caso al cerrar/reabrir un RQR ----------

export async function recalcularTieneRqrAbierto(casoId: string | null) {
  if (!casoId) return; // RQR manual sin caso vinculado: no hay marca que recalcular
  const abiertos = await prisma.rQR.count({
    where: {
      casoId,
      estado: { in: [EstadoRQR.ABIERTO, EstadoRQR.EN_TRATAMIENTO] },
      eliminadoEn: null,
    },
  });
  await prisma.caso.update({
    where: { id: casoId },
    data: { tieneRqrAbierto: abiertos > 0 },
  });
}

/**
 * El nombre del cliente que se muestra en un RQR, de una sola manera en todo el
 * sistema (listado, detalle, Word, tablero y reportes).
 *
 * El orden importa:
 *  1. Si hay Caso vinculado, manda el nombre del Caso.
 *  2. Si el cliente NO quiso identificarse, "Anónimo" — que es un dato, no una
 *     falta de dato.
 *  3. El nombre cargado a mano.
 *  4. "(sin datos)" solo cuando de verdad falta.
 *
 * Antes, un reclamo anónimo y uno al que se le olvidó cargar el nombre se veían
 * exactamente igual, y no había forma de distinguirlos.
 */
export function nombreClienteRqr(rqr: {
  clienteAnonimo?: boolean | null;
  nombreClienteManual?: string | null;
  caso?: { nombrePropietario?: string | null } | null;
}): string {
  const delCaso = rqr.caso?.nombrePropietario?.trim();
  if (delCaso) return delCaso;
  if (rqr.clienteAnonimo) return "Anónimo";
  const manual = rqr.nombreClienteManual?.trim();
  if (manual) return manual;
  return "(sin datos)";
}
