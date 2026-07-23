import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import {
  exportarReporteCausaRaiz,
  exportarReporteSentimiento,
  getReporteCausaRaiz,
  getReporteSentimiento,
} from "../controllers/reporte.controller";

const router = Router();

// Reporte 1: sentimiento general (totales, evolución, desgloses, tasa de respuesta)
router.get("/sentimiento", asyncHandler(getReporteSentimiento));
router.get("/sentimiento/exportar", asyncHandler(exportarReporteSentimiento));

// Reporte 2: causa raíz (por categoría, detalle, tiempos de cierre)
router.get("/causa-raiz", asyncHandler(getReporteCausaRaiz));
router.get("/causa-raiz/exportar", asyncHandler(exportarReporteCausaRaiz));
// alias con el nombre de la ruta del frontend, por comodidad
router.get("/causas-raiz", asyncHandler(getReporteCausaRaiz));

export default router;
