import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import {
  editarEstadoEncuestaPV,
  listarEncuestaPV,
  pendientesEncuestaPV,
  seguimientoEncuestaPV,
} from "../controllers/encuesta-pv.controller";

// Encuestas de fábrica de Posventa: los promotores de 5 estrellas que Calidad anima
// a responder la encuesta de fábrica. Ninguna ruta pide administrador: es el
// trabajo diario de Calidad (el controlador acota la lista por área y provincia).

const router = Router();

// La lista para trabajar. Sincroniza con los análisis antes de responder.
router.get("/", asyncHandler(listarEncuestaPV));

// Cuántos pendientes hay, para el contador del menú.
router.get("/pendientes", asyncHandler(pendientesEncuestaPV));

// Gráficos mes a mes: los ve cualquier perfil.
router.get("/seguimiento", asyncHandler(seguimientoEncuestaPV));

// Pendiente / Animado / Respondió.
router.patch("/clientes/:id", asyncHandler(editarEstadoEncuestaPV));

export default router;
