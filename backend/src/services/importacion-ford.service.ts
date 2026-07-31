import {
  AreaTrabajo,
  EncuestaFordEstado,
  EstadoTareaRefuerzo,
  ResultadoTareaRefuerzo,
  TipoTareaRefuerzo,
} from "@prisma/client";
import { prisma } from "../config/prisma";
import { ACCIONES, DatosAuditoria } from "./audit.service";
import { abrirWorkbook } from "./excel.service";
import { normalizarTelefonoAR } from "./telefono.service";
import { tareaAbiertaDelCaso, usuariosDelPool } from "./refuerzo.service";
import { claveNormalizada } from "./normalizacion.service";
import {
  CampoFord,
  clasificarAreaFord,
  clasificarEstadoFord,
  parsearFechaFord,
  parsearHojaFord,
} from "./encuesta-ford.service";

type Auditar = (d: DatosAuditoria) => Promise<void>;

const SELECT_CASO = {
  id: true,
  numeroOrden: true,
  nombrePropietario: true,
  estadoContacto: true,
  whatsappOptOut: true,
  eliminadoEn: true,
  area: true,
  sucursal: true,
} as const;

type CasoMatch = {
  id: string;
  numeroOrden: string;
  nombrePropietario: string;
  area: AreaTrabajo;
  sucursal: string; // provincia, para repartir la tarea a alguien de esa sucursal
  criterio: "orden" | "vin" | "telefono" | "email";
};

// Cruce contra Casos existentes, por prioridad: orden → VIN → teléfono → email.
// Ante varios casos (visitas repetidas), el más reciente no eliminado.
async function buscarCaso(campos: Partial<Record<CampoFord, string>>): Promise<CasoMatch | null> {
  const orden = campos.ordenReparacion?.trim();
  const vin = campos.vin?.trim();
  const email = campos.email?.trim();
  const tel = normalizarTelefonoAR(campos.telefono);

  const buscar = (where: object) =>
    prisma.caso.findFirst({ where: { ...where, eliminadoEn: null }, orderBy: { createdAt: "desc" }, select: SELECT_CASO });

  const armar = (c: { id: string; numeroOrden: string; nombrePropietario: string; area: AreaTrabajo; sucursal: string }, criterio: CasoMatch["criterio"]): CasoMatch => ({
    id: c.id, numeroOrden: c.numeroOrden, nombrePropietario: c.nombrePropietario, area: c.area, sucursal: c.sucursal, criterio,
  });

  if (orden) {
    const c = await buscar({ numeroOrden: orden });
    if (c) return armar(c, "orden");
  }
  if (vin) {
    const c = await buscar({ chasisVIN: { equals: vin, mode: "insensitive" } });
    if (c) return armar(c, "vin");
  }
  if (tel) {
    const c = await buscar({ OR: [{ whatsapp: tel }, { celular: tel }] });
    if (c) return armar(c, "telefono");
  }
  if (email) {
    const c = await buscar({ emailPropietario: { equals: email, mode: "insensitive" } });
    if (c) return armar(c, "email");
  }
  return null;
}

export interface SinMatchear {
  numeroFilaExcel: number;
  nombreCliente: string;
  orden: string;
  vin: string;
  email: string;
  telefono: string;
  estado: string;
  area: string; // área detectada por tipo de encuesta (no se pierde el dato)
}

// La encuesta dice un área y el caso matcheado es de otra: probablemente el
// match es incorrecto, o es otra visita del mismo cliente. No se crea tarea.
export interface ConflictoArea {
  numeroFilaExcel: number;
  nombreCliente: string;
  orden: string;
  areaEncuesta: string;
  areaCaso: string;
  numeroOrdenCaso: string;
  detalle: string;
}

export interface AreaNoReconocida {
  numeroFilaExcel: number;
  tipoEncuesta: string;
  motivo: string;
}

export interface ResumenFord {
  uploadId: string;
  totalFilas: number;
  matcheados: number;
  respondidas: number;
  tareasNuevas: { RECORDAR_ENCUESTA: number; VERIFICAR_EMAIL: number };
  cerradasAuto: number;
  canceladasAuto: number;
  noElegibles: number;
  duplicados: number; // ya tenían una tarea abierta (idempotencia)
  sinAsignar: number; // tareas creadas sin usuario elegible
  porCriterio: Record<string, number>;
  sinMatchear: SinMatchear[];
  noReconocidos: { numeroFilaExcel: number; estado: string }[];
  hayUsuariosElegibles: boolean;
  // Área: cuántas filas quedaron en cada área, cómo se reparten las que no
  // cruzaron, y los conflictos encuesta-vs-caso que quedaron sin procesar.
  porArea: Record<string, number>;
  sinMatchearPorArea: Record<string, number>;
  conflictosArea: ConflictoArea[];
  areaNoReconocida: AreaNoReconocida[];
}

export async function importarEncuestaFord(params: {
  buffer: Buffer;
  filename: string;
  mapping: Record<string, CampoFord>;
  uploadedBy: string;
  auditar: Auditar;
}): Promise<ResumenFord> {
  const { buffer, filename, mapping, uploadedBy, auditar } = params;

  const workbook = abrirWorkbook(buffer);
  const hoja = parsearHojaFord(workbook, workbook.SheetNames[0]);
  if ("error" in hoja) throw new Error(hoja.error);

  const periodo = new Date().toISOString().slice(0, 7);
  const upload = await prisma.excelUpload.create({
    data: {
      tipo: "ENCUESTA_FORD",
      filename,
      sucursal: "Encuesta Ford",
      periodo,
      uploadedBy,
      columnMapping: mapping,
      totalRows: hoja.filas.length,
    },
  });

  // POOL COMPARTIDO: las tareas se crean SIN asignar (asignadoAId null); cada
  // empleado ve las de su área+provincia. Acá solo se lleva la cuenta de cuántas
  // tareas cae en cada combinación área+provincia, para después detectar los
  // "pools sin nadie" (tareas que NINGÚN empleado vería).
  const tareasPorPool = new Map<string, { area: AreaTrabajo; sucursal: string; count: number }>();
  // ¿Hay ALGÚN usuario que participe de refuerzos? (para el aviso general).
  const hayAlgunElegible = (await usuariosDelPool()).length > 0;

  const resumen: ResumenFord = {
    uploadId: upload.id,
    totalFilas: hoja.filas.length,
    matcheados: 0,
    respondidas: 0,
    tareasNuevas: { RECORDAR_ENCUESTA: 0, VERIFICAR_EMAIL: 0 },
    cerradasAuto: 0,
    canceladasAuto: 0,
    noElegibles: 0,
    duplicados: 0,
    sinAsignar: 0,
    porCriterio: {},
    sinMatchear: [],
    noReconocidos: [],
    hayUsuariosElegibles: hayAlgunElegible,
    porArea: { VENTAS: 0, POSVENTA: 0 },
    sinMatchearPorArea: { VENTAS: 0, POSVENTA: 0 },
    conflictosArea: [],
    areaNoReconocida: [],
  };

  const hoy = new Date().toLocaleDateString("es-AR");

  for (const fila of hoja.filas) {
    // Campos canónicos según el mapeo (columna original → campo Ford)
    const campos: Partial<Record<CampoFord, string>> = {};
    for (const [columna, campo] of Object.entries(mapping)) {
      const v = fila.datos[columna];
      if (v !== null && v !== undefined && String(v).trim() !== "") campos[campo] = String(v).trim();
    }

    const clasif = clasificarEstadoFord(campos.estadoInvitacion);
    if (clasif.revisionManual || clasif.categoria === null) {
      resumen.noReconocidos.push({ numeroFilaExcel: fila.numeroFilaExcel, estado: campos.estadoInvitacion ?? "(vacío)" });
      continue;
    }

    // Área de la fila según el tipo de encuesta (con señal secundaria de
    // Vendedor/Asesor). Si no se puede determinar, va a revisión manual.
    const clasifArea = clasificarAreaFord(campos);
    if (!clasifArea.area) {
      resumen.areaNoReconocida.push({
        numeroFilaExcel: fila.numeroFilaExcel,
        tipoEncuesta: campos.tipoEncuesta ?? "(vacío)",
        motivo: clasifArea.motivo,
      });
      continue;
    }
    const areaEncuesta = clasifArea.area;
    resumen.porArea[areaEncuesta] = (resumen.porArea[areaEncuesta] ?? 0) + 1;

    const match = await buscarCaso(campos);
    if (!match) {
      // Se guarda el área detectada: antes esta información se perdía entera.
      resumen.sinMatchear.push({
        numeroFilaExcel: fila.numeroFilaExcel,
        nombreCliente: campos.nombreCliente ?? "",
        orden: campos.ordenReparacion ?? "",
        vin: campos.vin ?? "",
        email: campos.email ?? "",
        telefono: campos.telefono ?? "",
        estado: campos.estadoInvitacion ?? "",
        area: areaEncuesta,
      });
      resumen.sinMatchearPorArea[areaEncuesta] = (resumen.sinMatchearPorArea[areaEncuesta] ?? 0) + 1;
      continue;
    }

    // CONFLICTO DE ÁREA: la encuesta dice un área y el caso matcheado es de otra.
    // Probablemente el match es incorrecto (mismo cliente, visita distinta), así
    // que no se toca el caso ni se crea la tarea: va a revisión manual.
    if (areaEncuesta !== match.area) {
      resumen.conflictosArea.push({
        numeroFilaExcel: fila.numeroFilaExcel,
        nombreCliente: campos.nombreCliente ?? "",
        orden: campos.ordenReparacion ?? "",
        areaEncuesta,
        areaCaso: match.area,
        numeroOrdenCaso: match.numeroOrden,
        detalle:
          `La encuesta es de ${areaEncuesta} pero el caso matcheado (orden ${match.numeroOrden}) es de ${match.area}. ` +
          `Puede ser un cruce incorrecto o una visita distinta del mismo cliente: revisalo a mano.`,
      });
      continue;
    }

    resumen.matcheados++;
    resumen.porCriterio[match.criterio] = (resumen.porCriterio[match.criterio] ?? 0) + 1;

    // No DEGRADAR un caso que ya respondió: si el caso está RESPONDIDA y este
    // export (posiblemente más viejo) trae otro estado, se ignora la fila (no se
    // pisa el estado ni se recrea un recordatorio). Un RESPONDIDA nuevo sí pisa.
    const casoActual = await prisma.caso.findUnique({
      where: { id: match.id },
      select: { encuestaFordEstado: true },
    });
    if (
      casoActual?.encuestaFordEstado === EncuestaFordEstado.RESPONDIDA &&
      clasif.categoria !== EncuestaFordEstado.RESPONDIDA
    ) {
      resumen.duplicados++;
      continue;
    }

    // Actualizar el estado de encuesta Ford del caso
    const fechaRespuesta = clasif.categoria === EncuestaFordEstado.RESPONDIDA ? parsearFechaFord(campos.fechaRespuesta) : null;
    await prisma.caso.update({
      where: { id: match.id },
      data: { encuestaFordEstado: clasif.categoria, ...(fechaRespuesta ? { encuestaFordFecha: fechaRespuesta } : {}) },
    });

    const abierta = await tareaAbiertaDelCaso(match.id);

    // RESPONDIDA → cerrar automáticamente la tarea abierta, si la hay
    if (clasif.categoria === EncuestaFordEstado.RESPONDIDA) {
      resumen.respondidas++;
      if (abierta) {
        await prisma.tareaRefuerzo.update({
          where: { id: abierta.id },
          data: {
            estado: EstadoTareaRefuerzo.COMPLETADA,
            resultado: ResultadoTareaRefuerzo.ENCUESTA_RESPONDIDA,
            completadaEn: new Date(),
            notas: `${abierta.notas ? abierta.notas + "\n" : ""}Cerrada automáticamente por importación del ${hoy} (el cliente respondió la encuesta).`,
          },
        });
        resumen.cerradasAuto++;
        await auditar({
          accion: ACCIONES.TAREA_CERRADA_AUTO,
          entidad: "TareaRefuerzo",
          entidadId: abierta.id,
          detalles: { casoId: match.id, numeroOrden: match.numeroOrden, motivo: "encuesta respondida" },
        });
      }
      continue;
    }

    // NO_ELEGIBLE (opt out / quarantine) → cancelar tarea abierta si la hay; nunca crear
    if (clasif.categoria === EncuestaFordEstado.NO_ELEGIBLE) {
      resumen.noElegibles++;
      if (abierta) {
        await prisma.tareaRefuerzo.update({
          where: { id: abierta.id },
          data: {
            estado: EstadoTareaRefuerzo.CANCELADA,
            completadaEn: new Date(),
            notas: `${abierta.notas ? abierta.notas + "\n" : ""}Cancelada automáticamente por importación del ${hoy} (el cliente quedó como no elegible: ${campos.estadoInvitacion}).`,
          },
        });
        resumen.canceladasAuto++;
        await auditar({
          accion: ACCIONES.TAREA_CANCELADA_AUTO,
          entidad: "TareaRefuerzo",
          entidadId: abierta.id,
          detalles: { casoId: match.id, numeroOrden: match.numeroOrden, motivo: campos.estadoInvitacion },
        });
      }
      continue;
    }

    // PENDIENTE_RESPUESTA / EMAIL_INVALIDO → crear tarea si corresponde
    if (clasif.creaTarea && clasif.tipoTarea) {
      // Idempotencia: si ya hay tarea abierta, no duplicar
      if (abierta) {
        resumen.duplicados++;
        continue;
      }
      // Condiciones: no opt-out, no INTERNO, no eliminado
      const caso = await prisma.caso.findUnique({
        where: { id: match.id },
        select: { whatsappOptOut: true, estadoContacto: true, eliminadoEn: true },
      });
      if (!caso || caso.eliminadoEn || caso.whatsappOptOut || caso.estadoContacto === "INTERNO") {
        continue;
      }

      // La tarea cae directo al POOL de su área+provincia (sin dueño).
      await prisma.tareaRefuerzo.create({
        data: {
          casoId: match.id,
          tipo: clasif.tipoTarea,
          asignadoAId: null,
          origenUploadId: upload.id,
        },
      });
      // Contar por pool (para el aviso de "pools sin empleados" al final).
      const clavePool = `${match.area}|${claveNormalizada(match.sucursal)}`;
      const p = tareasPorPool.get(clavePool) ?? { area: match.area, sucursal: match.sucursal, count: 0 };
      p.count++;
      tareasPorPool.set(clavePool, p);

      if (clasif.tipoTarea === TipoTareaRefuerzo.RECORDAR_ENCUESTA) resumen.tareasNuevas.RECORDAR_ENCUESTA++;
      else resumen.tareasNuevas.VERIFICAR_EMAIL++;
    }
  }

  // Pools (área+provincia) SIN ningún empleado que participe: sus tareas quedan
  // invisibles para todos. Se cuentan como "sinAsignar" para avisarlo.
  for (const p of tareasPorPool.values()) {
    const gente = await usuariosDelPool(p.area, p.sucursal);
    if (gente.length === 0) resumen.sinAsignar += p.count;
  }

  await auditar({
    accion: ACCIONES.EXCEL_ENCUESTA_FORD_IMPORTADO,
    entidad: "ExcelUpload",
    entidadId: upload.id,
    detalles: {
      archivo: filename,
      matcheados: resumen.matcheados,
      respondidas: resumen.respondidas,
      tareasNuevas: resumen.tareasNuevas,
      cerradasAuto: resumen.cerradasAuto,
      canceladasAuto: resumen.canceladasAuto,
      noElegibles: resumen.noElegibles,
      sinMatchear: resumen.sinMatchear.length,
      noReconocidos: resumen.noReconocidos.length,
      duplicados: resumen.duplicados,
      porArea: resumen.porArea,
      sinMatchearPorArea: resumen.sinMatchearPorArea,
      conflictosArea: resumen.conflictosArea.length,
      areaNoReconocida: resumen.areaNoReconocida.length,
    },
  });

  // La carga terminó: se marca COMPLETADO (si no, queda en PROCESANDO para
  // siempre en el historial de cargas).
  await prisma.excelUpload.update({
    where: { id: upload.id },
    data: { status: "COMPLETADO" },
  });

  return resumen;
}
