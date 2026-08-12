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
  if (!marca.refuerzo.habilitado) {
    return res.status(404).json({
      message: `El módulo de Refuerzo de encuesta no está disponible en ${marca.nombre}.`,
    });
  }
  next();
}
