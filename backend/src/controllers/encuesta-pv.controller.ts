import { Request, Response } from "express";
import { z } from "zod";
import { AreaTrabajo, EstadoEncuestaFabrica, ListaCierre } from "@prisma/client";
import { periodosCerrados } from "../services/cierre-periodo.service";
import { prisma } from "../config/prisma";
import { marca } from "../config/marca";
import { ACCIONES, auditar } from "../services/audit.service";
import { areaPermitida, provinciaPermitida } from "../services/area.service";
import { claveNormalizada } from "../services/normalizacion.service";
import {
  casoEsDeLaLista,
  contarPendientesPV,
  esPromotorPV,
  listarPromotoresPV,
  seguimientoEncuestasPV,
} from "../services/encuesta-pv.service";

// Encuestas de fábrica de Posventa (promotores de 5 estrellas). Ver
// services/encuesta-pv.service.ts.
//
// QUIÉN VE QUÉ:
//  - Los GRÁFICOS mes a mes los ve cualquier perfil (pedido de Calidad del
//    16-09-2026), incluido Fidelización (ver RUTAS_FIDELIZACION en auth.ts).
//  - La LISTA y el cambio de estado son el trabajo de Calidad de Posventa de esa
//    sucursal: quien está restringido a Ventas, o asignado a otra provincia, no la
//    trabaja. Las listas siguen separadas por provincia, igual que el resto de
//    Volkswagen.

/** Por qué este usuario no trabaja la lista, o null si puede. */
// Quién trabaja esta pantalla: Posventa de la provincia de la lista (hoy Mendoza)
// y los administradores. Desde el 23-09-2026 vale para TODO: la lista, los meses
// cerrados y también los gráficos. Antes los gráficos los veía cualquier perfil
// (16-09-2026) y un usuario de Calidad de VENTAS terminaba con una pestaña que no
// es de su trabajo; el dueño pidió sacársela.
export function motivoSinAccesoPV(req: Request): string | null {
  const sucursal = marca.encuestaFabricaPV.sucursal ?? "";
  if (req.usuario?.rol === "FIDELIZACION") {
    return "Esta pantalla es de Calidad de Posventa.";
  }
  if (areaPermitida(req.usuario!) === AreaTrabajo.VENTAS) {
    return `Esta pantalla es del área de Posventa${sucursal ? ` (${sucursal})` : ""}.`;
  }
  const provincia = provinciaPermitida(req.usuario!);
  if (provincia && claveNormalizada(provincia) !== claveNormalizada(sucursal)) {
    return `Esta pantalla es de Posventa ${sucursal} y tu usuario es de ${provincia}.`;
  }
  return null;
}

// ---------- GET /api/encuesta-pv ----------
export async function listarEncuestaPV(req: Request, res: Response) {
  const motivo = motivoSinAccesoPV(req);
  if (motivo) return res.status(403).json({ message: motivo });
  res.json({
    ...(await listarPromotoresPV()),
    sucursal: marca.encuestaFabricaPV.sucursal,
    // Los meses cerrados: un cliente de esos meses que está en la lista llegó
    // después del cierre, y la pantalla lo marca.
    periodosCerrados: await periodosCerrados(ListaCierre.ENCUESTA_PV),
  });
}

// ---------- GET /api/encuesta-pv/pendientes ----------
// Para el contador del menú. A quien no trabaja la lista le devuelve 0 en vez de
// un 403: el menú lo pide seguido y un error ahí solo ensucia.
export async function pendientesEncuestaPV(req: Request, res: Response) {
  if (motivoSinAccesoPV(req)) return res.json({ pendientes: 0 });
  res.json({ pendientes: await contarPendientesPV() });
}

// ---------- PATCH /api/encuesta-pv/clientes/:id ----------
//
// Cambio de estado a mano: Pendiente / Avisado (22-09-2026: se le avisó al cliente
// y todavía no contestó) / Primer contacto (ya se habló con él) / Respondió /
// Cerrado (19-09-2026: se dejó de trabajar sin respuesta). Las fechas las pone el
// sistema. Avisado y Primer contacto cuentan los dos como CONTACTADO en los
// gráficos, y la fecha de contacto es la del primero de los dos.
const estadoSchema = z.object({
  estado: z.nativeEnum(EstadoEncuestaFabrica),
});

export async function editarEstadoEncuestaPV(req: Request, res: Response) {
  const motivo = motivoSinAccesoPV(req);
  if (motivo) return res.status(403).json({ message: motivo });

  const parseo = estadoSchema.safeParse(req.body);
  if (!parseo.success) {
    return res.status(400).json({ message: "Elegí un estado válido: Pendiente, Avisado, Primer contacto, Respondió o Cerrado." });
  }
  const estadoNuevo = parseo.data.estado;
  const sucursalPV = marca.encuestaFabricaPV.sucursal ?? "";

  const fila = await prisma.encuestaFabricaPV.findUnique({
    where: { id: req.params.id },
    include: { caso: { select: { nombrePropietario: true, numeroOrden: true } } },
  });
  if (!fila) return res.status(404).json({ message: "No se encontró ese cliente. Actualizá la lista." });
  // Un cliente de un mes cerrado solo se consulta (decisión del 17-09-2026).
  if (fila.cerradoEn) {
    return res.status(409).json({ message: "Ese cliente es de un mes cerrado: solo se consulta. Para cambiarlo, un administrador tiene que reabrir el mes." });
  }
  // Un caso eliminado o corregido (ya no es de Posventa de la sucursal) no se lista:
  // tampoco se le cambia el estado desde una pantalla vieja.
  if (!(await casoEsDeLaLista(fila.casoId))) {
    return res.status(404).json({ message: `Ese cliente ya no es de Posventa ${sucursalPV}. Actualizá la lista.` });
  }
  // Volver a Pendiente a un cliente que ya no es promotor lo haría desaparecer en la
  // próxima sincronización, con todo lo trabajado. Se rechaza en vez de perderlo.
  if (
    estadoNuevo === EstadoEncuestaFabrica.PENDIENTE &&
    fila.estado !== EstadoEncuestaFabrica.PENDIENTE &&
    !(await esPromotorPV(fila.casoId))
  ) {
    return res.status(409).json({
      message:
        "Este cliente ya no tiene 5 estrellas: si lo pasás a Pendiente sale de la lista y se pierde lo trabajado. Dejalo en Avisado, Primer contacto, Respondió o Cerrado.",
    });
  }

  const data: { estado: EstadoEncuestaFabrica; animadoEn?: Date | null; respondioEn?: Date | null } = {
    estado: estadoNuevo,
  };
  // Igual que en las encuestas de Ventas: la fecha de animado es la que usa el
  // seguimiento para contar la efectividad, así que NO se borra al pasar a
  // Respondió. Volver a Pendiente sí la borra: significa "todavía no se lo animó".
  if (estadoNuevo === EstadoEncuestaFabrica.PENDIENTE) data.animadoEn = null;
  // La fecha de contacto es la del PRIMERO de los dos pasos: si ya estaba avisado,
  // pasar a Primer contacto no la pisa.
  if (
    (estadoNuevo === EstadoEncuestaFabrica.AVISADO || estadoNuevo === EstadoEncuestaFabrica.PRIMER_CONTACTO) &&
    !fila.animadoEn
  ) {
    data.animadoEn = new Date();
  }
  // Cerrado cuenta como CONTACTADO SIN RESPUESTA (decisión del dueño, 19-09-2026):
  // se lo trabajó y no respondió, así que suma en los contactados y baja la
  // efectividad. Si se lo cierra sin haber pasado por Primer contacto, la fecha se
  // pone ahora; si ya la tenía, se conserva.
  if (estadoNuevo === EstadoEncuestaFabrica.CERRADO && !fila.animadoEn) data.animadoEn = new Date();
  if (estadoNuevo === EstadoEncuestaFabrica.RESPONDIO && !fila.respondioEn) data.respondioEn = new Date();
  if (estadoNuevo !== EstadoEncuestaFabrica.RESPONDIO) data.respondioEn = null;

  // updateMany y no update: si una sincronización borró la fila entre la lectura y
  // acá, responde 404 en vez de un 500.
  const { count } = await prisma.encuestaFabricaPV.updateMany({ where: { id: fila.id }, data });
  if (count === 0) return res.status(404).json({ message: "No se encontró ese cliente. Actualizá la lista." });
  const actualizada = await prisma.encuestaFabricaPV.findUnique({ where: { id: fila.id } });

  auditar(req, {
    accion: ACCIONES.ENCUESTA_PV_ESTADO_CAMBIADO,
    entidad: "EncuestaFabricaPV",
    entidadId: fila.id,
    detalles: {
      casoId: fila.casoId,
      cliente: fila.caso.nombrePropietario,
      orden: fila.caso.numeroOrden,
      estadoAnterior: fila.estado,
      estadoNuevo,
    },
  });

  res.json({ data: actualizada });
}

// ---------- GET /api/encuesta-pv/seguimiento ----------
// Los gráficos mes a mes. Sin restricción de perfil ni de provincia: los ve todo
// el que entra al sistema.
const seguimientoSchema = z.object({
  periodo: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "El mes tiene que tener el formato AAAA-MM.")
    .optional(),
});

export async function seguimientoEncuestaPV(req: Request, res: Response) {
  const motivo = motivoSinAccesoPV(req);
  if (motivo) return res.status(403).json({ message: motivo });
  const parsed = seguimientoSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors.map((e) => e.message).join(" ") });
  }
  res.json({
    ...(await seguimientoEncuestasPV({ periodo: parsed.data.periodo ?? null })),
    sucursal: marca.encuestaFabricaPV.sucursal,
  });
}
