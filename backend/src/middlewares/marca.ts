import { NextFunction, Request, Response } from "express";
import { marca } from "../config/marca";

// Apaga en el BACKEND los módulos que la marca no usa. Ocultar la pestaña en el
// frontend es cosmético: sin esto, la API sigue contestando y cualquiera con la
// URL (o un enlace viejo guardado) entra igual.
//
// Responde 404 y no 403 a propósito: para esta marca ese módulo no existe, no es
// que exista y no tengas permiso.

export function requireFidelizacion(_req: Request, res: Response, next: NextFunction) {
  if (!marca.fidelizacion) {
    return res.status(404).json({
      message: `El módulo de Fidelización no está disponible en ${marca.nombre}.`,
    });
  }
  next();
}

export function requireRefuerzo(_req: Request, res: Response, next: NextFunction) {
  // Solo la variante de Ford (tareas sobre Casos que se trabajan adentro del
  // sistema). VW refuerza la encuesta por su propia pantalla: ver
  // requireEncuestaVW. Sin este segundo chequeo, VW tendría las dos abiertas y
  // la de Ford solo podría mostrar una lista vacía.
  if (!marca.refuerzo.habilitado || marca.refuerzo.formatoExcel !== "FORD") {
    return res.status(404).json({
      message: `El refuerzo de la encuesta de ${marca.nombre} se gestiona desde la pantalla de Encuestas de fábrica.`,
    });
  }
  next();
}

/**
 * Encuestas de fábrica de Volkswagen. Ford tiene su propio circuito (cruza el
 * export contra los Casos que ya existen), así que este módulo no aplica y sus
 * endpoints no tienen que contestar.
 */
export function requireEncuestaVW(_req: Request, res: Response, next: NextFunction) {
  if (!marca.refuerzo.habilitado || marca.refuerzo.formatoExcel !== "VW") {
    return res.status(404).json({
      message: `Las encuestas de fábrica de ${marca.nombre} se cargan desde la pantalla de Refuerzo.`,
    });
  }
  next();
}

/**
 * Encuesta de Posventa medida por ítems. Solo en las marcas que la usan: en las
 * demás el área se clasifica con una nota sola y estas pantallas no existen.
 */
export function requirePosventaPorItems(_req: Request, res: Response, next: NextFunction) {
  if (!marca.posventaPorItems) {
    return res.status(404).json({
      message: `En ${marca.nombre} la encuesta de Posventa no se mide por ítems.`,
    });
  }
  next();
}
