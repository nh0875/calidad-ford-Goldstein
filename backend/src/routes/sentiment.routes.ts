import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import {
  contarRevisionManual,
  listRevisionManual,
  listSentimentAnalysis,
  patchSentimentAnalysis,
} from "../controllers/sentiment.controller";

const router = Router();

// Solo el contador, para el badge del menú (antes que la ruta con parámetros)
router.get("/revision-manual/pendientes", asyncHandler(contarRevisionManual));

// Bandeja de casos que la IA no pudo clasificar (o marcó ambiguos)
router.get("/revision-manual", asyncHandler(listRevisionManual));

// Listado con filtros: semaforo, sucursal, asesor, categoriaCausaRaiz,
// requiereRevisionManual, fechaDesde/fechaHasta, paginación
router.get("/", asyncHandler(listSentimentAnalysis));

// Corrección manual de Calidad (semáforo / causa raíz)
router.patch("/:id", asyncHandler(patchSentimentAnalysis));

export default router;
