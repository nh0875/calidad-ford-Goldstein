import { Request, Response } from "express";
import { marca } from "../config/marca";
import { AREAS_VW, NOMBRE_AREA_VW, ORIGENES_RQR_VW, SUBAREAS_VW } from "../config/areas-vw";

// Qué marca es esta instancia y qué módulos tiene. Lo consulta el frontend al
// arrancar para saber qué pestañas mostrar y cómo mostrar la satisfacción
// (semáforo o estrellas).
//
// Va SIN autenticación a propósito: la pantalla de login ya necesita saber de
// qué marca es el sistema para mostrar el nombre correcto. No expone nada
// sensible: solo el nombre de la marca y qué módulos están prendidos.
export function infoMarca(_req: Request, res: Response) {
  res.json({
    codigo: marca.codigo,
    nombre: marca.nombre,
    escala: marca.escala,
    // Puntaje máximo que NO abre RQR (solo si la marca usa estrellas).
    estrellasSinRqr: marca.estrellasSinRqr,
    modulos: {
      fidelizacion: marca.fidelizacion,
      refuerzo: marca.refuerzo.habilitado,
    },
    // Catálogo de áreas/subáreas del RQR, solo en las marcas que lo usan. Va
    // acá para que el formulario lo tenga sin una consulta aparte: son datos
    // fijos y chicos, no cambian entre usuarios.
    rqr: marca.rqrConSubareas
      ? {
          porSubareas: true,
          areas: AREAS_VW.map((a) => ({
            valor: a,
            etiqueta: NOMBRE_AREA_VW[a],
            subareas: SUBAREAS_VW[a],
          })),
          // Por dónde llegó el reclamo (distinto del canal por el que el
          // sistema había contactado al cliente).
          origenes: ORIGENES_RQR_VW,
        }
      : { porSubareas: false, areas: [], origenes: [] },
  });
}
