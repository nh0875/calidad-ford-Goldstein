import { RequestHandler } from "express";

// Express 4 no captura errores de handlers async: sin esto, una excepción
// dentro de un controller dejaría la request colgada.
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
