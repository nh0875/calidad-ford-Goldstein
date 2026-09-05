// Importa el Excel de RQR del área (formato formulario: UNA HOJA POR RQR,
// con el layout del papel) y crea los RQR en el sistema. Si encuentra un
// Caso por patente/VIN o teléfono, lo vincula; si no, usa los campos manuales.
import { AreaTrabajo, EstadoRQR, Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { prisma } from "../config/prisma";
import { abrirWorkbook, leerFilasCrudas, normalizarTexto, parsearFecha } from "./excel.service";
import { normalizarTelefonoAR } from "./telefono.service";
import { generarNumeroRQR } from "./rqr.service";

interface FormularioRqr {
  fechaApertura: Date | null;
  canal: string | null;
  areaOrigen: string | null;
  areaAfectada: string | null;
  asesor: string | null;
  nombreCliente: string | null;
  telefono: string | null;
  email: string | null;
  modelo: string | null;
  patenteOVin: string | null;
  descripcionReclamo: string;
  tratamientoBitacora: string | null;
  solucionPropuesta: string | null;
  tratamientoDadoPor: string | null;
  fechaCierre: Date | null;
  observaciones: string | null;
  responsableCierre: string | null;
  causaRaiz: string | null;
}

export interface ResultadoImportRqr {
  hoja: string;
  ok: boolean;
  mensaje: string;
  numeroRQR?: string;
  rqrId?: string;
  vinculadoA?: string; // numeroOrden del caso vinculado, si se encontró
}

// ---------- Parser del formulario ----------

function celdaTexto(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor).trim();
}

/** Valor a la derecha de una celda cuyo texto matchea el patrón */
function valorDerecha(filas: unknown[][], patron: RegExp): string | null {
  for (const fila of filas) {
    for (let c = 0; c < fila.length; c++) {
      if (patron.test(normalizarTexto(fila[c]))) {
        for (let k = c + 1; k < fila.length; k++) {
          const v = celdaTexto(fila[k]);
          if (v) return v;
        }
        return null;
      }
    }
  }
  return null;
}

/** Texto después de los dos puntos dentro de la misma celda ("Canal: Posventa") */
function valorEnCelda(filas: unknown[][], patron: RegExp): string | null {
  for (const fila of filas) {
    for (const celda of fila) {
      const texto = celdaTexto(celda);
      if (patron.test(normalizarTexto(texto))) {
        const idx = texto.indexOf(":");
        const resto = idx >= 0 ? texto.slice(idx + 1).trim() : "";
        if (resto) return resto;
      }
    }
  }
  return null;
}

/** Bloque de texto libre: filas entre un título de sección y el siguiente */
function bloqueSeccion(filas: unknown[][], desde: RegExp, hasta: RegExp[]): string | null {
  let dentro = false;
  const partes: string[] = [];
  for (const fila of filas) {
    const primera = normalizarTexto(fila.find((c) => celdaTexto(c) !== ""));
    if (!dentro) {
      if (desde.test(primera)) dentro = true;
      continue;
    }
    if (primera && hasta.some((h) => h.test(primera))) break;
    const texto = fila.map(celdaTexto).filter(Boolean).join(" ").trim();
    if (texto) partes.push(texto);
  }
  const resultado = partes.join("\n").trim();
  return resultado || null;
}

export function parsearFormularioRqr(workbook: XLSX.WorkBook, nombreHoja: string): FormularioRqr | { error: string } {
  const hoja = workbook.Sheets[nombreHoja];
  if (!hoja) return { error: `La hoja "${nombreHoja}" no existe.` };

  const filas: unknown[][] = leerFilasCrudas(hoja);

  const esFormulario = filas.some((f) =>
    f.some((c) => /fecha apertura rqr/.test(normalizarTexto(c)))
  );
  if (!esFormulario) {
    return {
      error: `La hoja "${nombreHoja}" no parece un formulario RQR (no se encontró "Fecha Apertura RQR").`,
    };
  }

  const descripcion = bloqueSeccion(filas, /^descripcion del reclamo/, [
    /^tratamiento\/?bitacora/,
    /^solucion propuesta/,
    /^verificacion de eficacia/,
  ]);

  return {
    fechaApertura: parsearFecha(valorDerecha(filas, /^fecha apertura rqr/)),
    canal: valorEnCelda(filas, /^canal/),
    areaOrigen: valorDerecha(filas, /^area origen/) ?? valorEnCelda(filas, /^area origen/),
    areaAfectada: valorEnCelda(filas, /^area afectada/) ?? valorDerecha(filas, /^area afectada/),
    asesor: valorDerecha(filas, /^asesor/),
    nombreCliente: valorDerecha(filas, /^nombre y apellido/),
    telefono: valorDerecha(filas, /^telefono/),
    email: valorDerecha(filas, /^direccion de e-?mail/),
    modelo: valorDerecha(filas, /^vehiculo\s*-?\s*modelo/),
    patenteOVin: valorDerecha(filas, /^vin o dominio/),
    descripcionReclamo:
      descripcion ?? "(el formulario no tiene texto en la sección Descripción del reclamo)",
    tratamientoBitacora: bloqueSeccion(filas, /^tratamiento\/?bitacora/, [
      /^solucion propuesta/,
      /^tratamiento dado por/,
      /^verificacion de eficacia/,
    ]),
    solucionPropuesta: bloqueSeccion(filas, /^solucion propuesta/, [
      /^tratamiento dado por/,
      /^verificacion de eficacia/,
    ]),
    tratamientoDadoPor: valorEnCelda(filas, /^tratamiento dado por/),
    fechaCierre: parsearFecha(valorDerecha(filas, /^fecha de cierre rqr/)),
    observaciones: valorDerecha(filas, /^observaciones/),
    responsableCierre: valorDerecha(filas, /^responsable/),
    causaRaiz: valorDerecha(filas, /^causa raiz/) ?? valorEnCelda(filas, /^causa raiz/),
  };
}

// ---------- Importación ----------

async function buscarCasoVinculable(form: FormularioRqr) {
  // 1) por patente / VIN
  if (form.patenteOVin) {
    const caso = await prisma.caso.findFirst({
      where: {
        OR: [
          { patente: { equals: form.patenteOVin, mode: "insensitive" } },
          { chasisVIN: { equals: form.patenteOVin, mode: "insensitive" } },
        ],
      },
      orderBy: { fechaProgramacion: "desc" },
    });
    if (caso) return caso;
  }
  // 2) por teléfono normalizado
  const telefono = normalizarTelefonoAR(form.telefono);
  if (telefono) {
    const caso = await prisma.caso.findFirst({
      where: { OR: [{ whatsapp: telefono }, { celular: telefono }] },
      orderBy: { fechaProgramacion: "desc" },
    });
    if (caso) return caso;
  }
  return null;
}

export async function importarFormulariosRqr(buffer: Buffer): Promise<{
  resultados: ResultadoImportRqr[];
  creados: number;
  duplicados: number;
  conError: number;
}> {
  const workbook = abrirWorkbook(buffer);
  const resultados: ResultadoImportRqr[] = [];

  for (const nombreHoja of workbook.SheetNames) {
    const form = parsearFormularioRqr(workbook, nombreHoja);
    if ("error" in form) {
      resultados.push({ hoja: nombreHoja, ok: false, mensaje: form.error });
      continue;
    }
    if (!form.nombreCliente && !form.patenteOVin) {
      resultados.push({
        hoja: nombreHoja,
        ok: false,
        mensaje: `La hoja "${nombreHoja}" no tiene nombre de cliente ni patente/VIN; no se puede cargar.`,
      });
      continue;
    }

    const caso = await buscarCasoVinculable(form);
    const fechaApertura = form.fechaApertura ?? new Date();

    // Duplicado: mismo cliente (caso o nombre manual) con RQR abierto ese mismo día
    const yaExiste = await prisma.rQR.findFirst({
      where: {
        fechaApertura: {
          gte: new Date(fechaApertura.getTime() - 12 * 3600_000),
          lte: new Date(fechaApertura.getTime() + 36 * 3600_000),
        },
        OR: [
          ...(caso ? [{ casoId: caso.id }] : []),
          ...(form.nombreCliente
            ? [{ nombreClienteManual: { equals: form.nombreCliente, mode: "insensitive" as const } }]
            : []),
        ],
      },
    });
    if (yaExiste) {
      resultados.push({
        hoja: nombreHoja,
        ok: false,
        mensaje: `Ya existe el ${yaExiste.numeroRQR} para este cliente con la misma fecha de apertura; se omitió.`,
        numeroRQR: yaExiste.numeroRQR,
      });
      continue;
    }

    const telefono = normalizarTelefonoAR(form.telefono) ?? form.telefono;

    for (let intento = 1; intento <= 3; intento++) {
      try {
        const rqr = await prisma.$transaction(async (tx) => {
          const numeroRQR = await generarNumeroRQR(tx);
          const creado = await tx.rQR.create({
            data: {
              casoId: caso?.id ?? null,
              // El RQR hereda el área del caso vinculado (si no, cae en POSVENTA
              // por default aunque el caso sea de VENTAS y desaparece del filtro).
              area: caso?.area ?? AreaTrabajo.POSVENTA,
              nombreClienteManual: caso ? null : form.nombreCliente,
              telefonoManual: caso ? null : telefono,
              modeloManual: caso ? null : form.modelo,
              numeroRQR,
              fechaApertura,
              canal: form.canal ?? "Posventa",
              areaOrigen: form.areaOrigen ?? "Taller",
              areaAfectada: form.areaAfectada,
              asesor: form.asesor ?? caso?.asesor ?? "(sin asesor)",
              descripcionReclamo: `[Importado del Excel de RQR, hoja "${nombreHoja}"]\n\n${form.descripcionReclamo}`,
              tratamientoBitacora: form.tratamientoBitacora,
              solucionPropuesta: form.solucionPropuesta,
              tratamientoDadoPor: form.tratamientoDadoPor,
              observaciones: form.observaciones,
              responsableCierre: form.fechaCierre ? form.responsableCierre : null,
              causaRaiz: form.causaRaiz,
              fechaCierre: form.fechaCierre,
              estado: form.fechaCierre ? EstadoRQR.CERRADO : EstadoRQR.ABIERTO,
            },
          });
          if (caso && !form.fechaCierre) {
            await tx.caso.update({ where: { id: caso.id }, data: { tieneRqrAbierto: true } });
          }
          return creado;
        });

        resultados.push({
          hoja: nombreHoja,
          ok: true,
          mensaje: caso
            ? `${rqr.numeroRQR} creado y vinculado al caso ${caso.numeroOrden} (${caso.nombrePropietario}).`
            : `${rqr.numeroRQR} creado con los datos del formulario (no se encontró un caso para vincular).`,
          numeroRQR: rqr.numeroRQR,
          rqrId: rqr.id,
          vinculadoA: caso?.numeroOrden,
        });
        break;
      } catch (err) {
        const esConflicto =
          err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
        if (!esConflicto || intento === 3) {
          resultados.push({
            hoja: nombreHoja,
            ok: false,
            mensaje: `No se pudo crear el RQR de la hoja "${nombreHoja}": ${err instanceof Error ? err.message : String(err)}`,
          });
          break;
        }
      }
    }
  }

  return {
    resultados,
    creados: resultados.filter((r) => r.ok).length,
    duplicados: resultados.filter((r) => !r.ok && r.numeroRQR).length,
    conError: resultados.filter((r) => !r.ok && !r.numeroRQR).length,
  };
}
