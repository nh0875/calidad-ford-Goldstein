import { Request, Response } from "express";
import { z } from "zod";
import { ListaCierre, OrigenCierre } from "@prisma/client";
import { prisma } from "../config/prisma";
import { marca, mensajeSucursalInvalida, SUCURSAL_GENERAL, sucursalCanonica } from "../config/marca";
import { ACCIONES, auditar } from "../services/audit.service";
import { provinciaPermitida } from "../services/area.service";
import { claveNormalizada } from "../services/normalizacion.service";
import {
  cerrarPeriodo,
  idsCerradosVentas,
  mesesDeLaLista,
  periodoActual,
  reabrirPeriodo,
} from "../services/cierre-periodo.service";
import { listarPromotoresCerradosPV } from "../services/encuesta-pv.service";

// Cierre de meses de las encuestas de fábrica (ver services/cierre-periodo.service.ts).
// Las mismas rutas para las dos listas: cada archivo de rutas las monta con la suya
// y, si hace falta, con su propio control de acceso (PV es solo de Posventa Mendoza).

type ControlDeAcceso = (req: Request) => string | null;

const NOMBRE_LISTA: Record<ListaCierre, string> = {
  ENCUESTA_VENTAS: "Encuestas de fábrica",
  ENCUESTA_PV: "Encuestas de fábrica PV",
};

const quien = (req: Request) => ({ id: req.usuario?.id ?? null, nombre: req.usuario?.nombre ?? null });

const mesSchema = z.object({
  periodo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "El mes tiene que tener el formato AAAA-MM."),
  sucursal: z.string().trim().min(1, "Falta indicar la provincia."),
});

/**
 * Valida el mes y la provincia del pedido. Devuelve la provincia como la escribe
 * la marca, o el mensaje de por qué no.
 */
function leerMes(lista: ListaCierre, datos: unknown): { periodo: string; sucursal: string } | { error: string } {
  const parsed = mesSchema.safeParse(datos ?? {});
  if (!parsed.success) return { error: parsed.error.errors.map((e) => e.message).join(" ") };
  const sucursal = sucursalCanonica(parsed.data.sucursal);
  if (!sucursal || sucursal === SUCURSAL_GENERAL) return { error: mensajeSucursalInvalida() };
  if (lista === ListaCierre.ENCUESTA_PV && claveNormalizada(sucursal) !== claveNormalizada(marca.encuestaFabricaPV.sucursal ?? "")) {
    return { error: `Esta lista es solo de ${marca.encuestaFabricaPV.sucursal}.` };
  }
  return { periodo: parsed.data.periodo, sucursal };
}

/** Un usuario con provincia asignada solo cierra o reabre la suya. */
function motivoProvincia(req: Request, sucursal: string): string | null {
  const provincia = provinciaPermitida(req.usuario!);
  if (provincia && claveNormalizada(provincia) !== claveNormalizada(sucursal)) {
    return `Tu usuario es de ${provincia}: solo puede cerrar los meses de esa provincia.`;
  }
  return null;
}

// ---------- GET .../cierres ----------
// Los meses de la lista: cuántos clientes quedan en la lista y cuántos están
// cerrados, y quién cerró o reabrió cada uno.
export function listarMeses(lista: ListaCierre, acceso?: ControlDeAcceso) {
  return async (req: Request, res: Response) => {
    const motivo = acceso?.(req);
    if (motivo) return res.status(403).json({ message: motivo });
    const provincia = provinciaPermitida(req.usuario!);
    res.json({
      data: await mesesDeLaLista(lista),
      periodoActual: periodoActual(new Date()),
      // Para que la pantalla no ofrezca botones que el backend va a rechazar.
      permisos: {
        cerrar: req.usuario?.rol !== "FIDELIZACION",
        reabrir: req.usuario?.rol === "ADMIN",
        provincia: provincia ? sucursalCanonica(provincia) ?? provincia : null,
      },
    });
  };
}

// ---------- POST .../cierres ----------
export function cerrarMes(lista: ListaCierre, acceso?: ControlDeAcceso) {
  return async (req: Request, res: Response) => {
    const motivo = acceso?.(req);
    if (motivo) return res.status(403).json({ message: motivo });
    if (req.usuario?.rol === "FIDELIZACION") {
      return res.status(403).json({ message: "Tu usuario no puede cerrar meses." });
    }
    const mes = leerMes(lista, req.body);
    if ("error" in mes) return res.status(400).json({ message: mes.error });
    const noSuya = motivoProvincia(req, mes.sucursal);
    if (noSuya) return res.status(403).json({ message: noSuya });
    if (mes.periodo > periodoActual(new Date())) {
      return res.status(400).json({ message: "Un mes que todavía no empezó no se puede cerrar." });
    }

    const r = await cerrarPeriodo({ ...mes, lista, origen: OrigenCierre.MANUAL, quien: quien(req) });
    auditar(req, {
      accion: ACCIONES.PERIODO_CERRADO,
      entidad: "CierrePeriodo",
      detalles: { lista, ...mes, cerrados: r.cerrados, totalCerrados: r.totalCerrados, origen: "MANUAL" },
    });
    res.json({
      message:
        r.cerrados === 0
          ? `El mes quedó cerrado. No había clientes en la lista para guardar.`
          : `Mes cerrado: ${r.cerrados} cliente(s) salieron de la lista. Se consultan desde el mes cerrado.`,
      ...r,
    });
  };
}

// ---------- POST .../cierres/reabrir ----------
// Solo administradores (lo exige el archivo de rutas con requireAdmin).
export function reabrirMes(lista: ListaCierre, acceso?: ControlDeAcceso) {
  return async (req: Request, res: Response) => {
    const motivo = acceso?.(req);
    if (motivo) return res.status(403).json({ message: motivo });
    const mes = leerMes(lista, req.body);
    if ("error" in mes) return res.status(400).json({ message: mes.error });
    const noSuya = motivoProvincia(req, mes.sucursal);
    if (noSuya) return res.status(403).json({ message: noSuya });

    const r = await reabrirPeriodo({ ...mes, lista, quien: quien(req) });
    if ("error" in r) return res.status(409).json({ message: r.error });
    auditar(req, {
      accion: ACCIONES.PERIODO_REABIERTO,
      entidad: "CierrePeriodo",
      detalles: { lista, ...mes, reabiertos: r.reabiertos },
    });
    res.json({
      message: `Mes reabierto: ${r.reabiertos} cliente(s) volvieron a la lista de ${NOMBRE_LISTA[lista]}. No se vuelve a cerrar solo; se cierra con el botón.`,
      ...r,
    });
  };
}

// ---------- GET .../cierres/clientes?periodo=&sucursal= ----------
// La consulta de un mes cerrado. Solo lectura: para tocar a esos clientes hay que
// reabrir el mes (decisión del 17-09-2026).
export function clientesDelMesCerrado(lista: ListaCierre, acceso?: ControlDeAcceso) {
  return async (req: Request, res: Response) => {
    const motivo = acceso?.(req);
    if (motivo) return res.status(403).json({ message: motivo });
    const mes = leerMes(lista, req.query);
    if ("error" in mes) return res.status(400).json({ message: mes.error });

    if (lista === ListaCierre.ENCUESTA_PV) {
      return res.json({ ...mes, data: await listarPromotoresCerradosPV(mes.periodo) });
    }
    const ids = await idsCerradosVentas(mes.periodo, mes.sucursal);
    const data = await prisma.encuestaFabricaVW.findMany({
      where: { id: { in: ids } },
      orderBy: [{ estado: "asc" }, { fechaEntrega: "asc" }],
      select: {
        id: true,
        chasis: true,
        dominio: true,
        nombreCliente: true,
        email: true,
        canalVentas: true,
        fechaEntrega: true,
        fechaDominio: true,
        periodo: true,
        sucursal: true,
        estado: true,
        avisadoEn: true,
        respondioEn: true,
        cerradoEn: true,
        esManual: true,
        vendedor: { select: { codigo: true, nombre: true } },
      },
    });
    res.json({ ...mes, data });
  };
}
