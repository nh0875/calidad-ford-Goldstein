import { Request, Response } from "express";
import { marca } from "../config/marca";

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
  });
}
