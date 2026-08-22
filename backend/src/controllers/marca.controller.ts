import { Request, Response } from "express";
import { marca } from "../config/marca";
import { AREAS_VW, NOMBRE_AREA_VW, ORIGENES_RQR_VW, SUBAREAS_VW } from "../config/areas-vw";
import { DEFINICION_ITEMS } from "../config/posventa-vw";

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
      // Las DOS marcas refuerzan la encuesta de fábrica, pero con circuitos
      // distintos, y cada una tiene que ver UNA sola pantalla:
      //
      //  - "refuerzo" es la de Ford: tareas colgadas de un Caso, que los asesores
      //    trabajan adentro del sistema.
      //  - "encuestaFabrica" es la de VW: lista propia agrupada por vendedor, con
      //    aviso por correo, porque los vendedores de VW no entran al sistema.
      //
      // En VW la de Ford quedaría SIEMPRE vacía (nada crea esas tareas) y su
      // carga de Excel rechazaría el archivo real de VW, que tiene otro formato.
      refuerzo: marca.refuerzo.habilitado && marca.refuerzo.formatoExcel === "FORD",
      encuestaFabrica: marca.refuerzo.habilitado && marca.refuerzo.formatoExcel === "VW",
      // Pantalla de desempeño de Posventa por ítems.
      desempenoPosventa: marca.posventaPorItems,
    },
    // Los 5 ítems que se miden en Posventa. Van acá para que la pantalla arme
    // sus columnas y sus etiquetas sin una consulta aparte: son fijos y chicos.
    posventa: marca.posventaPorItems
      ? { porItems: true, items: DEFINICION_ITEMS }
      : { porItems: false, items: [] },
    // Catálogo de áreas/subáreas del RQR, solo en las marcas que lo usan. Va
    // acá para que el formulario lo tenga sin una consulta aparte: son datos
    // fijos y chicos, no cambian entre usuarios.
    rqr: marca.rqrConSubareas
      ? {
          porSubareas: true,
          // El formulario permite marcar que el cliente no quiso identificarse.
          clienteAnonimo: marca.rqrClienteAnonimo,
          areas: AREAS_VW.map((a) => ({
            valor: a,
            etiqueta: NOMBRE_AREA_VW[a],
            subareas: SUBAREAS_VW[a],
          })),
          // Por dónde llegó el reclamo (distinto del canal por el que el
          // sistema había contactado al cliente).
          origenes: ORIGENES_RQR_VW,
        }
      : { porSubareas: false, clienteAnonimo: marca.rqrClienteAnonimo, areas: [], origenes: [] },
  });
}
