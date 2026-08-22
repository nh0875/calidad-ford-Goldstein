import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import {
  exportarDesempenoExcel,
  exportarDesempenoWord,
  getDesempenoPosventa,
} from "../controllers/posventa.controller";

const router = Router();

// Desempeño del área por ítem: el reporte de la pantalla.
router.get("/desempeno", asyncHandler(getDesempenoPosventa));

// La MISMA información, exportada. Sale del mismo cálculo que la pantalla, así
// que un informe impreso no puede decir algo distinto de lo que se ve.
router.get("/desempeno/excel", asyncHandler(exportarDesempenoExcel));
router.get("/desempeno/word", asyncHandler(exportarDesempenoWord));

export default router;
